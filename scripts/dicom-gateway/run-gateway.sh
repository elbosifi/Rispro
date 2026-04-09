#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)

if [ -f "$APP_DIR/.env" ]; then
  set -a
  . "$APP_DIR/.env"
  set +a
fi

: "${RISPRO_BASE_URL:=http://127.0.0.1:3000}"
: "${DICOM_BIND_HOST:=0.0.0.0}"
: "${DICOM_MWL_AE_TITLE:=RISPRO_MWL}"
: "${DICOM_MWL_PORT:=11112}"
: "${DICOM_WORKLIST_SOURCE_DIR:=$APP_DIR/storage/dicom/worklist-source}"
: "${DICOM_WORKLIST_OUTPUT_DIR:=$APP_DIR/storage/dicom/worklists}"

MWL_OUTPUT_DIR="$DICOM_WORKLIST_OUTPUT_DIR/$DICOM_MWL_AE_TITLE"

mkdir -p \
  "$DICOM_WORKLIST_SOURCE_DIR" \
  "$DICOM_WORKLIST_OUTPUT_DIR" \
  "$MWL_OUTPUT_DIR"

: > "$MWL_OUTPUT_DIR/lockfile"

node "$APP_DIR/scripts/dicom-gateway/build-worklists.mjs" &
WORKLIST_BUILDER_PID=$!

cleanup() {
  kill "$WORKLIST_BUILDER_PID" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

echo "[DICOM Gateway] MPPS SCP: disabled_by_design"
echo "[DICOM Gateway] MPPS Processor: disabled_by_design"

cd "$MWL_OUTPUT_DIR"
exec wlmscpfs "$DICOM_MWL_PORT"
