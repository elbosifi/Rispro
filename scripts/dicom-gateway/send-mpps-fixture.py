#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys

from pydicom.dataset import Dataset
from pynetdicom import AE
from pynetdicom.sop_class import ModalityPerformedProcedureStep


def build_dataset(args: argparse.Namespace, status: str) -> Dataset:
    scheduled_date = str(args.scheduled_date).replace("-", "").strip()
    scheduled_time = str(args.scheduled_time).replace(":", "").replace(".", "").strip()

    ds = Dataset()
    ds.PatientID = args.patient_id
    ds.AccessionNumber = args.accession_number
    ds.StudyInstanceUID = args.study_instance_uid
    ds.PerformedProcedureStepStatus = status
    ds.PerformedProcedureStepStartDate = scheduled_date
    ds.PerformedProcedureStepStartTime = scheduled_time

    scheduled = Dataset()
    scheduled.RequestedProcedureID = args.requested_procedure_id
    scheduled.ScheduledProcedureStepID = args.scheduled_step_id
    scheduled.Modality = args.modality
    scheduled.ScheduledProcedureStepStartDate = scheduled_date
    scheduled.ScheduledProcedureStepStartTime = scheduled_time
    ds.ScheduledStepAttributesSequence = [scheduled]
    return ds


def require_success(status: Dataset | None, action: str) -> None:
    if status is None:
        raise RuntimeError(f"{action} returned no status from bridge")
    status_code = int(getattr(status, "Status", 0xFFFF))
    if status_code != 0x0000:
        raise RuntimeError(f"{action} failed with DICOM status 0x{status_code:04x}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Send MPPS N-CREATE/N-SET fixture traffic to RISpro bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--called-ae", required=True)
    parser.add_argument("--calling-ae", default="MPPS_FIXTURE")
    parser.add_argument("--patient-id", required=True)
    parser.add_argument("--accession-number", required=True)
    parser.add_argument("--study-instance-uid", required=True)
    parser.add_argument("--mpps-instance-uid", required=True)
    parser.add_argument("--requested-procedure-id", required=True)
    parser.add_argument("--scheduled-step-id", required=True)
    parser.add_argument("--modality", default="CT")
    parser.add_argument("--scheduled-date", required=True)
    parser.add_argument("--scheduled-time", required=True)
    parser.add_argument("--skip-create", action="store_true")
    parser.add_argument("--skip-set", action="store_true")
    parser.add_argument("--create-status", default="IN PROGRESS")
    parser.add_argument("--set-status", default="COMPLETED")
    args = parser.parse_args()

    ae = AE(ae_title=args.calling_ae)
    ae.add_requested_context(ModalityPerformedProcedureStep)
    assoc = ae.associate(args.host, args.port, ae_title=args.called_ae)

    if not assoc.is_established:
        raise RuntimeError("Could not establish association with MPPS bridge")

    try:
        if not args.skip_create:
            create_dataset = build_dataset(args, args.create_status)
            create_status, _ = assoc.send_n_create(
                create_dataset,
                ModalityPerformedProcedureStep,
                args.mpps_instance_uid,
            )
            require_success(create_status, "N-CREATE")

        if not args.skip_set:
            set_dataset = build_dataset(args, args.set_status)
            set_status, _ = assoc.send_n_set(
                set_dataset,
                ModalityPerformedProcedureStep,
                args.mpps_instance_uid,
            )
            require_success(set_status, "N-SET")
    finally:
        assoc.release()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
