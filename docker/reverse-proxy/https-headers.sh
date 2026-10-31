#!/bin/sh
set -eu
umask 077
token="$(cat /run/secrets/https_gateway_identity)"
case "$token" in *[!a-f0-9]*|'') exit 1 ;; esac
[ "${#token}" -eq 64 ]
printf '"%s" "%s";\n' "$token" "$token" > /etc/nginx/https-identity/gateway.conf
printf '8081 "%s";\n' "$token" > /etc/nginx/https-bootstrap/local.conf
printf 'listen 8081;\n' > /etc/nginx/https-listen/local.conf
