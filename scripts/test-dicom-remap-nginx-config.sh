#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_FILE="${1:-${PROJECT_ROOT}/docker/reverse-proxy/nginx.conf}"
ROUTE='location = /api/pacs/remap/jobs/process-multipart {'

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

route_line="$(grep -nF "${ROUTE}" "${CONFIG_FILE}" | cut -d: -f1)"
root_line="$(grep -nE '^[[:space:]]*location / \{' "${CONFIG_FILE}" | cut -d: -f1)"
[[ -n "${route_line}" ]] || fail 'missing exact process-multipart route'
[[ -n "${root_line}" ]] || fail 'missing general location / route'
[[ "${route_line}" -lt "${root_line}" ]] || fail 'process-multipart route must precede the general location / route'
pass 'exact process-multipart route precedes the general proxy route'

route_block="$(sed -n "${route_line},$((root_line - 1))p" "${CONFIG_FILE}")"
for directive in \
  'client_max_body_size 21g;' \
  'client_body_timeout 900s;' \
  'proxy_request_buffering off;' \
  'proxy_buffering off;' \
  'proxy_read_timeout 900s;' \
  'proxy_send_timeout 900s;' \
  'send_timeout 900s;'; do
  grep -Fqx "      ${directive}" <<<"${route_block}" || fail "missing route directive: ${directive}"
done
pass 'process-multipart route has the dedicated streaming limit and timeouts'

[[ "$(grep -Fxc '      client_max_body_size 21g;' "${CONFIG_FILE}")" -eq 1 ]] \
  || fail 'multi-gigabyte body limit must exist only on the exact remap route'
pass 'other API routes retain the global 75m limit'

for restore_route in /api/admin/restore/v3/preview /api/admin/restore/v3/restore; do
  restore_line="$(grep -nF "location = ${restore_route} {" "${CONFIG_FILE}" | cut -d: -f1)"
  [[ -n "${restore_line}" ]] || fail "missing exact V3 restore upload route: ${restore_route}"
  [[ "${restore_line}" -lt "${root_line}" ]] || fail "V3 restore upload route must precede the general location / route"
  restore_block="$(sed -n "${restore_line},$((root_line - 1))p" "${CONFIG_FILE}")"
  for directive in \
    'client_max_body_size 4g;' \
    'client_body_timeout 900s;' \
    'proxy_request_buffering off;' \
    'proxy_buffering off;' \
    'proxy_read_timeout 900s;' \
    'proxy_send_timeout 900s;' \
    'send_timeout 900s;'; do
    grep -Fqx "      ${directive}" <<<"${restore_block}" || fail "missing V3 restore directive for ${restore_route}: ${directive}"
  done
done
[[ "$(grep -Fxc '      client_max_body_size 4g;' "${CONFIG_FILE}")" -eq 2 ]] \
  || fail 'the 4g V3 restore upload limit must exist only on preview and confirmed restore routes'
pass 'V3 restore preview and execution have dedicated streamed upload limits'
