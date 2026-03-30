#!/bin/sh
set -eu

: "${DICOM_BIND_HOST:=0.0.0.0}"
: "${DICOM_MWL_AE_TITLE:=RISPRO_MWL}"
: "${DICOM_MWL_PORT:=11112}"
: "${DICOM_MPPS_AE_TITLE:=RISPRO_MPPS}"
: "${DICOM_MPPS_PORT:=11113}"
: "${DICOM_WORKLIST_SOURCE_DIR:=/app/storage/dicom/worklist-source}"
: "${DICOM_WORKLIST_OUTPUT_DIR:=/app/storage/dicom/worklists}"
: "${DICOM_MPPS_INBOX_DIR:=/app/storage/dicom/mpps/inbox}"

mkdir -p "$DICOM_WORKLIST_SOURCE_DIR" "$DICOM_WORKLIST_OUTPUT_DIR" "$DICOM_MPPS_INBOX_DIR"

node /app/scripts/dicom-gateway/build-worklists.mjs &
WORKLIST_BUILDER_PID=$!

node /app/scripts/dicom-gateway/process-mpps-inbox.mjs &
MPPS_PROCESSOR_PID=$!

cleanup() {
  kill "$WORKLIST_BUILDER_PID" "$MPPS_PROCESSOR_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

wlmscpfs \
  -aet "$DICOM_MWL_AE_TITLE" \
  --data-file-path "$DICOM_WORKLIST_OUTPUT_DIR" \
  "$DICOM_MWL_PORT" &
WLM_PID=$!

ppsscpfs \
  -aet "$DICOM_MPPS_AE_TITLE" \
  --output-directory "$DICOM_MPPS_INBOX_DIR" \
  "$DICOM_MPPS_PORT" &
MPPS_PID=$!

wait "$WLM_PID" "$MPPS_PID"
