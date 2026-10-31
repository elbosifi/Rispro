#!/usr/bin/env bash
set -euo pipefail
# Run locally on the trusted RISpro server console; no Docker socket is mounted
# into the application and the generated code is printed only to this console.
exec docker exec rispro-app node --import tsx src/modules/automatic-https/https-bootstrap-console.ts
