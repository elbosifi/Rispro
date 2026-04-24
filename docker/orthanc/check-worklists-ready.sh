#!/usr/bin/env bash

set -Eeuo pipefail

CONFIG_PATH="${ORTHANC_CONFIG_PATH:-/etc/orthanc/orthanc.json}"
PLUGIN_DIR="${ORTHANC_PLUGIN_DIR:-/usr/share/orthanc/plugins}"
PLUGIN_BINARY="${ORTHANC_WORKLISTS_PLUGIN_BINARY:-${PLUGIN_DIR}/libOrthancWorklists.so}"
PLUGINS_URL="${ORTHANC_PLUGINS_URL:-http://127.0.0.1:8042/plugins}"
WORKLISTS_URL="${ORTHANC_WORKLISTS_URL:-http://127.0.0.1:8042/worklists}"

log() {
  printf '[orthanc-worklists] %s\n' "$*"
}

fail() {
  printf '[orthanc-worklists] ERROR: %s\n' "$*" >&2
  exit 1
}

require_file() {
  local path="$1"
  local label="$2"
  [ -f "$path" ] || fail "${label} is missing at ${path}."
}

require_dir() {
  local path="$1"
  local label="$2"
  [ -d "$path" ] || fail "${label} is missing at ${path}."
}

json_value() {
  local path="$1"
  python3 - "$CONFIG_PATH" "$path" <<'PY'
import json
import sys

config_path = sys.argv[1]
path = sys.argv[2].split(".")

with open(config_path, "r", encoding="utf-8") as f:
    data = json.load(f)

current = data
for part in path:
    if not isinstance(current, dict) or part not in current:
        raise SystemExit(1)
    current = current[part]

if isinstance(current, bool):
    print("true" if current else "false")
elif current is None:
    print("")
else:
    print(current)
PY
}

http_status() {
  python3 - "$1" <<'PY'
import base64
import os
import sys
import urllib.error
import urllib.request

url = sys.argv[1]
request = urllib.request.Request(url, method="GET")
if os.environ.get("ORTHANC_AUTH_ENABLED", "false").lower() == "true":
    user = os.environ.get("ORTHANC_USERNAME", "")
    password = os.environ.get("ORTHANC_PASSWORD", "")
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {token}")

try:
    with urllib.request.urlopen(request, timeout=5) as response:
        print(response.status)
except urllib.error.HTTPError as exc:
    print(exc.code)
except Exception:
    print("000")
PY
}

plugins_include_worklists() {
  python3 - "$PLUGINS_URL" <<'PY'
import base64
import json
import os
import sys
import urllib.error
import urllib.request

url = sys.argv[1]
request = urllib.request.Request(url, method="GET")
if os.environ.get("ORTHANC_AUTH_ENABLED", "false").lower() == "true":
    user = os.environ.get("ORTHANC_USERNAME", "")
    password = os.environ.get("ORTHANC_PASSWORD", "")
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {token}")

try:
    with urllib.request.urlopen(request, timeout=5) as response:
        payload = json.load(response)
except Exception:
    raise SystemExit(2)

text = json.dumps(payload).lower()
if "worklists" in text:
    raise SystemExit(0)
raise SystemExit(1)
PY
}

verify_plugin_binary() {
  require_dir "$PLUGIN_DIR" "Orthanc plugin directory"
  require_file "$PLUGIN_BINARY" "Orthanc Worklists plugin binary"
}

verify_config() {
  require_file "$CONFIG_PATH" "Orthanc config"

  local enabled
  enabled="$(json_value "Worklists.Enable" || true)"
  [ "$enabled" = "true" ] || fail "Worklists.Enable must be true in ${CONFIG_PATH}."

  local directory
  directory="$(json_value "Worklists.Directory" || true)"
  [ -n "$directory" ] || fail "Worklists.Directory is missing from ${CONFIG_PATH}."

  require_dir "$directory" "Configured Worklists directory"
}

verify_runtime_route() {
  local status
  status="$(http_status "$WORKLISTS_URL")"

  case "$status" in
    200|401|403)
      log "Worklists REST route is reachable (HTTP ${status})."
      ;;
    000)
      fail "Orthanc HTTP API is not reachable at ${WORKLISTS_URL}."
      ;;
    *)
      fail "Worklists REST route is not ready at ${WORKLISTS_URL} (HTTP ${status})."
      ;;
  esac
}

verify_plugin_loaded() {
  local listing_status=0
  plugins_include_worklists || listing_status=$?

  if [ "$listing_status" -eq 0 ]; then
    log "Worklists plugin is listed by Orthanc at ${PLUGINS_URL}."
    return 0
  fi

  if [ "$listing_status" -eq 1 ]; then
    fail "Orthanc runtime plugin listing does not include the Worklists plugin."
  fi

  log "Orthanc runtime plugin listing is unavailable; falling back to /worklists route verification."
}

main() {
  verify_plugin_binary
  verify_config
  verify_plugin_loaded
  verify_runtime_route

  if [ "${1:-}" != "--healthcheck" ]; then
    log "Worklists plugin binary, config, directory, and runtime route are ready."
  fi
}

main "$@"
