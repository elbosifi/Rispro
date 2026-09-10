#!/usr/bin/env python3

from __future__ import annotations

import argparse
import sys

from pydicom.dataset import Dataset
from pydicom.uid import generate_uid
from pynetdicom import AE
from pynetdicom.sop_class import ModalityPerformedProcedureStep, Verification


def dicom_date(value: str) -> str:
    return str(value).replace("-", "").strip()


def dicom_time(value: str) -> str:
    return str(value).replace(":", "").replace(".", "").strip()


def build_n_create_dataset(args: argparse.Namespace) -> Dataset:
    ds = Dataset()
    ds.PatientID = args.patient_id
    ds.Modality = args.modality
    ds.PerformedProcedureStepStatus = args.create_status
    ds.PerformedProcedureStepStartDate = dicom_date(args.performed_start_date)
    ds.PerformedProcedureStepStartTime = dicom_time(args.performed_start_time)
    ds.PerformedProcedureStepEndDate = ""
    ds.PerformedProcedureStepEndTime = ""

    scheduled = Dataset()
    scheduled.StudyInstanceUID = args.study_instance_uid
    scheduled.AccessionNumber = args.accession_number
    scheduled.RequestedProcedureID = args.requested_procedure_id
    scheduled.ScheduledProcedureStepID = args.scheduled_step_id
    scheduled.ScheduledProcedureStepStartDate = dicom_date(args.scheduled_date)
    scheduled.ScheduledProcedureStepStartTime = dicom_time(args.scheduled_time)
    ds.ScheduledStepAttributesSequence = [scheduled]
    return ds


def build_n_set_dataset(args: argparse.Namespace) -> Dataset:
    ds = Dataset()
    ds.PerformedProcedureStepStatus = args.set_status
    if args.set_status in {"COMPLETED", "DISCONTINUED"}:
        ds.PerformedProcedureStepEndDate = dicom_date(args.performed_end_date)
        ds.PerformedProcedureStepEndTime = dicom_time(args.performed_end_time)

    if args.set_status == "DISCONTINUED" and args.discontinuation_reason:
        reason = Dataset()
        reason.CodeMeaning = args.discontinuation_reason
        ds.PerformedProcedureStepDiscontinuationReasonCodeSequence = [reason]

    series = Dataset()
    series.SeriesInstanceUID = generate_uid()
    series.ReferencedImageSequence = []
    ds.PerformedSeriesSequence = [series]
    return ds


def require_status(status: Dataset | None, action: str, expected: int = 0x0000) -> None:
    if status is None:
        raise RuntimeError(f"{action} returned no status from bridge")
    status_code = int(getattr(status, "Status", 0xFFFF))
    if status_code != expected:
        raise RuntimeError(f"{action} failed with DICOM status 0x{status_code:04x}")


def validate_event_arguments(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    required = [
        "patient_id", "accession_number", "study_instance_uid", "mpps_instance_uid",
        "requested_procedure_id", "scheduled_step_id", "scheduled_date", "scheduled_time",
        "performed_start_date", "performed_start_time", "performed_end_date", "performed_end_time",
    ]
    missing = [f"--{name.replace('_', '-')}" for name in required if not getattr(args, name)]
    if missing:
        parser.error(f"the following arguments are required unless --echo-only is used: {', '.join(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Send MPPS N-CREATE/N-SET fixture traffic to RISpro bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11113)
    parser.add_argument("--called-ae", default="RISPRO_MPPS")
    parser.add_argument("--calling-ae", default="MPPS_FIXTURE")
    parser.add_argument("--patient-id")
    parser.add_argument("--accession-number")
    parser.add_argument("--study-instance-uid")
    parser.add_argument("--mpps-instance-uid")
    parser.add_argument("--requested-procedure-id")
    parser.add_argument("--scheduled-step-id")
    parser.add_argument("--modality", default="CT")
    parser.add_argument("--scheduled-date")
    parser.add_argument("--scheduled-time")
    parser.add_argument("--performed-start-date")
    parser.add_argument("--performed-start-time")
    parser.add_argument("--performed-end-date")
    parser.add_argument("--performed-end-time")
    parser.add_argument("--discontinuation-reason", default="")
    parser.add_argument("--skip-create", action="store_true")
    parser.add_argument("--skip-set", action="store_true")
    parser.add_argument("--create-status", default="IN PROGRESS")
    parser.add_argument("--set-status", default="COMPLETED")
    parser.add_argument("--echo-only", action="store_true")
    args = parser.parse_args()

    ae = AE(ae_title=args.calling_ae)
    if args.echo_only:
        ae.add_requested_context(Verification)
    else:
        validate_event_arguments(parser, args)
        ae.add_requested_context(ModalityPerformedProcedureStep)

    assoc = ae.associate(args.host, args.port, ae_title=args.called_ae)
    if not assoc.is_established:
        raise RuntimeError("Could not establish association with MPPS bridge")

    try:
        if args.echo_only:
            require_status(assoc.send_c_echo(), "C-ECHO")
            return 0

        if not args.skip_create:
            create_status, _ = assoc.send_n_create(
                build_n_create_dataset(args),
                ModalityPerformedProcedureStep,
                args.mpps_instance_uid,
            )
            require_status(create_status, "N-CREATE")

        if not args.skip_set:
            set_status, _ = assoc.send_n_set(
                build_n_set_dataset(args),
                ModalityPerformedProcedureStep,
                args.mpps_instance_uid,
            )
            require_status(set_status, "N-SET")
    finally:
        assoc.release()

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
