#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${1:-${PROJECT_ROOT}/docker/reverse-proxy/nginx.conf}"
ROUTES=(
  'location = /api/pacs/remap/jobs/process-multipart {'
  'location = /api/pacs/remap/jobs/stage-multipart {'
)

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

pass() {
  printf '[OK]   %s\n' "$*"
}

[[ -f "${CONFIG_FILE}" ]] || fail "missing Nginx configuration: ${CONFIG_FILE}"

grep -Eq '^[[:space:]]*client_max_body_size[[:space:]]+75m;' "${CONFIG_FILE}" \
  || fail 'global ordinary-request body limit is not 75m'
pass 'global ordinary-request body limit remains 75m'

root_line="$(grep -nE '^[[:space:]]*location / \{' "${CONFIG_FILE}" | cut -d: -f1)"
[[ -n "${root_line}" ]] || fail 'missing general location / route'
for route in "${ROUTES[@]}"; do
  route_line="$(grep -nF "${route}" "${CONFIG_FILE}" | cut -d: -f1)"
  [[ -n "${route_line}" ]] || fail "missing exact remap upload route: ${route}"
  [[ "${route_line}" -lt "${root_line}" ]] || fail "remap upload route must precede the general location / route: ${route}"
  route_end="$((route_line + 16))"
  route_block="$(sed -n "${route_line},${route_end}p" "${CONFIG_FILE}")"
  for directive in \
    'client_max_body_size 21g;' \
    'client_body_timeout 900s;' \
    'proxy_request_buffering off;' \
    'proxy_buffering off;' \
    'proxy_read_timeout 900s;' \
    'proxy_send_timeout 900s;' \
    'send_timeout 900s;'; do
    grep -Fqx "      ${directive}" <<<"${route_block}" || fail "missing route directive for ${route}: ${directive}"
  done
done
pass 'exact durable remap upload routes have dedicated streaming limits and timeouts'

[[ "$(grep -Fxc '      client_max_body_size 21g;' "${CONFIG_FILE}")" -eq 2 ]] \
  || fail 'multi-gigabyte body limit must exist only on the two exact remap upload routes'
pass 'other API routes retain the global 75m limit'

restore_route='location ~ ^/api/admin/restore/v3/upload-sessions/[0-9a-fA-F-]+/chunks$ {'
restore_line="$(grep -nF "${restore_route}" "${CONFIG_FILE}" | cut -d: -f1)"
[[ -n "${restore_line}" ]] || fail 'missing resumable V3 restore chunk route'
[[ "${restore_line}" -lt "${root_line}" ]] || fail 'V3 restore chunk route must precede the general location / route'
restore_block="$(sed -n "${restore_line},$((root_line - 1))p" "${CONFIG_FILE}")"
for directive in \
  'client_max_body_size 8m;' \
  'client_body_timeout 120s;' \
  'proxy_request_buffering off;' \
  'proxy_buffering off;' \
  'proxy_read_timeout 120s;' \
  'proxy_send_timeout 120s;' \
  'send_timeout 120s;'; do
  grep -Fqx "      ${directive}" <<<"${restore_block}" || fail "missing V3 restore chunk directive: ${directive}"
done
[[ "$(grep -Fxc '      client_max_body_size 8m;' "${CONFIG_FILE}")" -eq 1 ]] \
  || fail 'the 8m V3 chunk limit must exist only on the resumable upload route'
pass 'V3 restore uses a dedicated non-buffered bounded chunk route'
