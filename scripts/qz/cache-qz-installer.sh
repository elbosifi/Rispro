#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CACHE_DIR="${QZ_INSTALLER_CACHE_DIR:-${PROJECT_ROOT}/var/qz-bootstrap}"
NAME="qz-tray-2.2.6-x86_64.exe"
URL="https://github.com/qzind/tray/releases/download/v2.2.6/${NAME}"
EXPECTED_SHA256="aeb93a601c27f5fa6bb464f63471e7acd43052ba384fef49dceec8290d4f7587"
TARGET="${CACHE_DIR}/${NAME}"

command -v curl >/dev/null 2>&1 || { printf 'curl is required to cache QZ Tray.\n' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { printf 'sha256sum is required to cache QZ Tray.\n' >&2; exit 1; }
mkdir -p "$CACHE_DIR"
chmod 755 "$CACHE_DIR"

if [ -f "$TARGET" ] && printf '%s  %s\n' "$EXPECTED_SHA256" "$TARGET" | sha256sum -c - >/dev/null 2>&1; then
  printf 'QZ Tray 2.2.6 x86-64 installer cache is valid.\n'
  exit 0
fi

temporary="$(mktemp "${CACHE_DIR}/.${NAME}.XXXXXX")"
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT
effective_url="$(curl --fail --show-error --silent --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 30 --max-time 900 --output "$temporary" --write-out '%{url_effective}' "$URL")"
case "$effective_url" in
  https://github.com/*|https://objects.githubusercontent.com/*|https://release-assets.githubusercontent.com/*) ;;
  *) printf 'QZ installer redirected to an unexpected host: %s\n' "$effective_url" >&2; exit 1 ;;
esac
printf '%s  %s\n' "$EXPECTED_SHA256" "$temporary" | sha256sum -c - >/dev/null
chmod 644 "$temporary"
mv -f "$temporary" "$TARGET"
printf '%s  %s\n' "$EXPECTED_SHA256" "$NAME" > "${TARGET}.sha256"
chmod 644 "${TARGET}.sha256"
trap - EXIT
printf 'Cached official QZ Tray 2.2.6 x86-64 installer at %s.\n' "$TARGET"
