#!/bin/sh
set -eu
umask 077
mkdir -p /run/rispro-https
chmod 700 /run/rispro-https
if [ -s /run/rispro-https/current.json ]; then
    exec caddy run --config /run/rispro-https/current.json
fi
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
