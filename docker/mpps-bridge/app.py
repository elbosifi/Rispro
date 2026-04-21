import base64
import json
import os
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from pydicom.dataset import Dataset
from pynetdicom import AE, evt
from pynetdicom.sop_class import ModalityPerformedProcedureStep

MPPS_BRIDGE_PORT = int(os.environ.get("MPPS_BRIDGE_PORT", "11113"))
MPPS_BRIDGE_AE_TITLE = os.environ.get("MPPS_BRIDGE_AE_TITLE", "RISPRO_MPPS").strip() or "RISPRO_MPPS"
MPPS_STORAGE_DIR = Path(os.environ.get("MPPS_STORAGE_DIR", "/data/dicom/mpps-bridge"))
MPPS_AUTH_ENABLED = os.environ.get("MPPS_AUTH_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
MPPS_USERNAME = os.environ.get("MPPS_USERNAME", "")
MPPS_PASSWORD = os.environ.get("MPPS_PASSWORD", "")
MPPS_ADMIN_PORT = int(os.environ.get("MPPS_ADMIN_PORT", "18080"))

STATE = {
    "started_at": datetime.now(timezone.utc).isoformat(),
    "last_event_at": None,
    "events": [],
}
STATE_LOCK = threading.Lock()


def dataset_to_json(dataset: Dataset | None) -> Any:
    if dataset is None:
        return None
    return dataset.to_json_dict()


def record_event(event_type: str, sop_instance_uid: str, dataset: Dataset | None, calling_ae_title: str) -> None:
    MPPS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sop_instance_uid": sop_instance_uid,
        "calling_ae_title": calling_ae_title,
        "dataset": dataset_to_json(dataset),
    }
    filename = f"{payload['timestamp'].replace(':', '-')}-{event_type}-{sop_instance_uid}.json"
    (MPPS_STORAGE_DIR / filename).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    with STATE_LOCK:
        STATE["last_event_at"] = payload["timestamp"]
        STATE["events"].append(
            {
                "event_type": event_type,
                "timestamp": payload["timestamp"],
                "sop_instance_uid": sop_instance_uid,
                "calling_ae_title": calling_ae_title,
            }
        )
        STATE["events"] = STATE["events"][-25:]


def handle_n_create(event: evt.Event):
    sop_instance_uid = getattr(event.request, "AffectedSOPInstanceUID", "unknown")
    dataset = event.attribute_list if hasattr(event, "attribute_list") else None
    calling_ae_title = getattr(event.assoc.requestor, "ae_title", b"").decode("ascii", errors="ignore").strip()
    record_event("n-create", sop_instance_uid, dataset, calling_ae_title)
    return 0x0000, dataset


def handle_n_set(event: evt.Event):
    sop_instance_uid = getattr(event.request, "RequestedSOPInstanceUID", "unknown")
    dataset = event.modification_list if hasattr(event, "modification_list") else None
    calling_ae_title = getattr(event.assoc.requestor, "ae_title", b"").decode("ascii", errors="ignore").strip()
    record_event("n-set", sop_instance_uid, dataset, calling_ae_title)
    return 0x0000, dataset


class AdminHandler(BaseHTTPRequestHandler):
    def _is_authorized(self) -> bool:
        if not MPPS_AUTH_ENABLED:
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        expected = base64.b64encode(f"{MPPS_USERNAME}:{MPPS_PASSWORD}".encode("utf-8")).decode("ascii")
        return header == f"Basic {expected}"

    def _write_json(self, status: HTTPStatus, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._write_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "ae_title": MPPS_BRIDGE_AE_TITLE,
                    "port": MPPS_BRIDGE_PORT,
                    "last_event_at": STATE["last_event_at"],
                },
            )
            return

        if self.path == "/events":
            if not self._is_authorized():
                self.send_response(HTTPStatus.UNAUTHORIZED)
                self.send_header("WWW-Authenticate", 'Basic realm="mpps-bridge"')
                self.end_headers()
                return
            with STATE_LOCK:
                self._write_json(HTTPStatus.OK, STATE)
            return

        self._write_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def run_admin_server() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", MPPS_ADMIN_PORT), AdminHandler)
    server.serve_forever()


def main() -> None:
    MPPS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    admin_thread = threading.Thread(target=run_admin_server, daemon=True)
    admin_thread.start()

    handlers = [
        (evt.EVT_N_CREATE, handle_n_create),
        (evt.EVT_N_SET, handle_n_set),
    ]

    ae = AE(ae_title=MPPS_BRIDGE_AE_TITLE)
    ae.add_supported_context(ModalityPerformedProcedureStep)

    print(
        json.dumps(
            {
                "message": "Starting RISpro MPPS bridge",
                "ae_title": MPPS_BRIDGE_AE_TITLE,
                "port": MPPS_BRIDGE_PORT,
                "admin_port": MPPS_ADMIN_PORT,
                "auth_enabled": MPPS_AUTH_ENABLED,
            }
        ),
        flush=True,
    )

    ae.start_server(("0.0.0.0", MPPS_BRIDGE_PORT), evt_handlers=handlers, block=True)


if __name__ == "__main__":
    main()
