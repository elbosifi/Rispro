from __future__ import annotations

import base64
import json
import os
import threading
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest

from pydicom.dataset import Dataset
from pynetdicom import AE, evt
from pynetdicom.sop_class import ModalityPerformedProcedureStep, Verification

MPPS_BRIDGE_PORT = int(os.environ.get("MPPS_BRIDGE_PORT", "11113"))
MPPS_BRIDGE_AE_TITLE = os.environ.get("MPPS_BRIDGE_AE_TITLE", "RISPRO_MPPS").strip() or "RISPRO_MPPS"
MPPS_STORAGE_DIR = Path(os.environ.get("MPPS_STORAGE_DIR", "/data/dicom/mpps-bridge"))
MPPS_AUTH_ENABLED = os.environ.get("MPPS_AUTH_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
MPPS_USERNAME = os.environ.get("MPPS_USERNAME", "")
MPPS_PASSWORD = os.environ.get("MPPS_PASSWORD", "")
MPPS_ADMIN_PORT = int(os.environ.get("MPPS_ADMIN_PORT", "18080"))
RISPRO_BASE_URL = os.environ.get("RISPRO_BASE_URL", "http://app:3000").rstrip("/")
RISPRO_MPPS_SECRET = os.environ.get("RISPRO_INTERNAL_SECRET", os.environ.get("JWT_SECRET", ""))

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


def normalize_ae_title(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("ascii", errors="ignore").strip()
    return str(value).strip()


def dataset_value(dataset: Dataset | None, keyword: str, default: str = "") -> str:
    if dataset is None:
        return default
    value = dataset.get(keyword, default)
    if value is None:
        return default
    if hasattr(value, "value"):
        value = value.value
    return str(value).strip()


def sequence_dataset_value(dataset: Dataset | None, sequence_keyword: str, item_keyword: str, default: str = "") -> str:
    if dataset is None:
        return default
    sequence = dataset.get(sequence_keyword)
    if not sequence:
        return default
    try:
        for item in sequence:
            value = dataset_value(item, item_keyword)
            if value:
                return value
    except Exception:
        return default
    return default


def normalize_mpps_event(event_type: str, sop_instance_uid: str, dataset: Dataset | None, calling_ae_title: str) -> dict[str, Any]:
    scheduled_study_instance_uid = sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "StudyInstanceUID")
    scheduled_accession_number = sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "AccessionNumber")
    discontinuation = ""
    discontinuation_sequence = dataset.get("PerformedProcedureStepDiscontinuationReasonCodeSequence") if dataset is not None else None
    if discontinuation_sequence:
        try:
            discontinuation_item = discontinuation_sequence[0]
            discontinuation = dataset_value(discontinuation_item, "CodeMeaning") or dataset_value(discontinuation_item, "CodeValue")
        except Exception:
            discontinuation = ""

    return {
        "eventType": event_type,
        "sourceAeTitle": calling_ae_title,
        "patientId": dataset_value(dataset, "PatientID"),
        "accessionNumber": scheduled_accession_number or dataset_value(dataset, "AccessionNumber"),
        "studyInstanceUid": scheduled_study_instance_uid or dataset_value(dataset, "StudyInstanceUID"),
        "mppsInstanceUid": sop_instance_uid,
        "performedStepStatus": dataset_value(dataset, "PerformedProcedureStepStatus"),
        "requestedProcedureId": sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "RequestedProcedureID"),
        "scheduledProcedureStepId": sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "ScheduledProcedureStepID"),
        "modality": dataset_value(dataset, "Modality") or sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "Modality"),
        "scheduledStartDate": sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "ScheduledProcedureStepStartDate")
            or dataset_value(dataset, "ScheduledProcedureStepStartDate"),
        "scheduledStartTime": sequence_dataset_value(dataset, "ScheduledStepAttributesSequence", "ScheduledProcedureStepStartTime")
            or dataset_value(dataset, "ScheduledProcedureStepStartTime"),
        "performedStartDate": dataset_value(dataset, "PerformedProcedureStepStartDate"),
        "performedStartTime": dataset_value(dataset, "PerformedProcedureStepStartTime"),
        "performedEndDate": dataset_value(dataset, "PerformedProcedureStepEndDate"),
        "performedEndTime": dataset_value(dataset, "PerformedProcedureStepEndTime"),
        "discontinuationReason": discontinuation,
        "rawDatasetJson": dataset_to_json(dataset) or {},
    }


def deliver_to_rispro(payload: dict[str, Any]) -> dict[str, Any]:
    if not RISPRO_MPPS_SECRET:
        raise RuntimeError("RISPRO_INTERNAL_SECRET or JWT_SECRET is required for MPPS bridge delivery.")

    body = json.dumps(payload).encode("utf-8")
    request = urlrequest.Request(
        f"{RISPRO_BASE_URL}/api/dicom/mpps/events",
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-RISPRO-MPPS-SECRET": RISPRO_MPPS_SECRET,
        },
        method="POST",
    )

    try:
        with urlrequest.urlopen(request, timeout=10) as response:
            raw = response.read().decode("utf-8")
    except urlerror.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"RISpro MPPS intake returned HTTP {exc.code}: {raw or exc.reason}") from exc
    except urlerror.URLError as exc:
        raise RuntimeError(f"RISpro MPPS intake request failed: {exc.reason}") from exc

    return json.loads(raw or "{}")


def record_event(event_type: str, sop_instance_uid: str, dataset: Dataset | None, calling_ae_title: str) -> dict[str, Any]:
    MPPS_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    normalized_payload = normalize_mpps_event(event_type, sop_instance_uid, dataset, calling_ae_title)
    payload = {
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "sop_instance_uid": sop_instance_uid,
        "calling_ae_title": calling_ae_title,
        "dataset": dataset_to_json(dataset),
        "normalized_payload": normalized_payload,
    }

    delivery_error = None
    try:
        payload["rispro_delivery"] = deliver_to_rispro(normalized_payload)
    except Exception as exc:
        delivery_error = str(exc)
        payload["rispro_delivery_error"] = delivery_error

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
                "delivery_error": delivery_error,
            }
        )
        STATE["events"] = STATE["events"][-25:]

    if delivery_error:
        raise RuntimeError(delivery_error)

    result = payload.get("rispro_delivery", {}).get("result")
    if not isinstance(result, dict):
        raise RuntimeError("RISpro MPPS intake returned an invalid response.")
    return result


def dicom_status_from_delivery(result: dict[str, Any]) -> int:
    status = result.get("dicomStatus", 0x0110)
    if isinstance(status, bool):
        return 0x0110
    try:
        status = int(status)
    except (TypeError, ValueError):
        return 0x0110
    return status if 0 <= status <= 0xFFFF else 0x0110


def handle_c_echo(_: evt.Event) -> int:
    return 0x0000


def handle_n_create(event: evt.Event):
    sop_instance_uid = normalize_ae_title(getattr(event.request, "AffectedSOPInstanceUID", ""))
    dataset = event.attribute_list if hasattr(event, "attribute_list") else None
    if not sop_instance_uid:
        return 0x0106, None
    performed_step_status = dataset_value(dataset, "PerformedProcedureStepStatus")
    if not performed_step_status:
        return 0x0120, None
    if performed_step_status != "IN PROGRESS":
        return 0x0106, None
    calling_ae_title = normalize_ae_title(getattr(event.assoc.requestor, "ae_title", b""))
    try:
        result = record_event("n-create", sop_instance_uid, dataset, calling_ae_title)
    except Exception as exc:
        print(f"MPPS bridge N-CREATE failed: {exc}", flush=True)
        return 0x0110, None
    status = dicom_status_from_delivery(result)
    return status, dataset if status == 0x0000 else None


def handle_n_set(event: evt.Event):
    sop_instance_uid = normalize_ae_title(getattr(event.request, "RequestedSOPInstanceUID", ""))
    dataset = event.modification_list if hasattr(event, "modification_list") else None
    calling_ae_title = normalize_ae_title(getattr(event.assoc.requestor, "ae_title", b""))
    try:
        result = record_event("n-set", sop_instance_uid, dataset, calling_ae_title)
    except Exception as exc:
        print(f"MPPS bridge N-SET failed: {exc}", flush=True)
        return 0x0110, None
    status = dicom_status_from_delivery(result)
    return status, dataset if status == 0x0000 else None


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
        (evt.EVT_C_ECHO, handle_c_echo),
        (evt.EVT_N_CREATE, handle_n_create),
        (evt.EVT_N_SET, handle_n_set),
    ]

    ae = AE(ae_title=MPPS_BRIDGE_AE_TITLE)
    ae.add_supported_context(ModalityPerformedProcedureStep)
    ae.add_supported_context(Verification)

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
