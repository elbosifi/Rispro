#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
IDENTITY_DIR="${QZ_IDENTITY_DIR:-${PROJECT_ROOT}/secrets/qz/identity}"
REPAIR="false"
FILES=(qz-root-ca.crt qz-root-ca.key qz-signing-certificate.pem qz-signing-private-key.pem qz-signing-public-key.pem qz-signing-metadata.json)

if [ "${1:-}" = "--repair" ]; then REPAIR="true"; elif [ "$#" -gt 0 ]; then printf 'Unsupported argument: %s\n' "$1" >&2; exit 2; fi
command -v openssl >/dev/null 2>&1 || { printf 'OpenSSL is required to provision the QZ signing identity.\n' >&2; exit 1; }

validate_identity() {
  local dir="$1" root_pub leaf_pub key_pub
  for file in "${FILES[@]}"; do [ -s "${dir}/${file}" ] || return 1; done
  grep -q '^-----BEGIN PRIVATE KEY-----' "${dir}/qz-signing-private-key.pem" || return 1
  openssl x509 -in "${dir}/qz-root-ca.crt" -noout -checkend 0 >/dev/null 2>&1 || return 1
  openssl x509 -in "${dir}/qz-signing-certificate.pem" -noout -checkend 0 >/dev/null 2>&1 || return 1
  openssl pkey -in "${dir}/qz-root-ca.key" -check -noout >/dev/null 2>&1 || return 1
  openssl pkey -in "${dir}/qz-signing-private-key.pem" -check -noout >/dev/null 2>&1 || return 1
  openssl verify -CAfile "${dir}/qz-root-ca.crt" "${dir}/qz-signing-certificate.pem" >/dev/null 2>&1 || return 1
  openssl x509 -in "${dir}/qz-root-ca.crt" -text -noout | grep -q 'CA:TRUE' || return 1
  openssl x509 -in "${dir}/qz-signing-certificate.pem" -text -noout | grep -q 'CA:FALSE' || return 1
  root_pub="$(openssl x509 -in "${dir}/qz-root-ca.crt" -pubkey -noout | openssl sha256)"
  [ "$root_pub" = "$(openssl pkey -in "${dir}/qz-root-ca.key" -pubout | openssl sha256)" ] || return 1
  leaf_pub="$(openssl x509 -in "${dir}/qz-signing-certificate.pem" -pubkey -noout | openssl sha256)"
  key_pub="$(openssl pkey -in "${dir}/qz-signing-private-key.pem" -pubout | openssl sha256)"
  [ "$leaf_pub" = "$key_pub" ] || return 1
}

if [ -e "${IDENTITY_DIR}" ]; then
  if validate_identity "${IDENTITY_DIR}"; then
    printf 'Existing QZ signing identity is valid; preserving it.\n'
    exit 0
  fi
  if [ "$REPAIR" != "true" ]; then
    printf 'QZ identity is partial or invalid at %s; refusing replacement without --repair.\n' "${IDENTITY_DIR}" >&2
    exit 1
  fi
  backup="${IDENTITY_DIR}.invalid.$(date -u '+%Y%m%dT%H%M%SZ')"
  mv "${IDENTITY_DIR}" "$backup"
  printf 'Moved invalid QZ identity aside to %s.\n' "$backup"
fi

parent="$(dirname "${IDENTITY_DIR}")"
mkdir -p "$parent"
chmod 700 "$parent"
umask 077
temporary="$(mktemp -d "${parent}/.qz-identity.XXXXXX")"
cleanup() { [ -d "$temporary" ] && rm -rf -- "$temporary"; }
trap cleanup EXIT

cat > "${temporary}/root.cnf" <<'EOF_ROOT'
[req]
distinguished_name=dn
prompt=no
x509_extensions=root_ext
[dn]
CN=NCCB RISpro QZ Root CA
O=National Cancer Center Benghazi
[root_ext]
basicConstraints=critical,CA:TRUE,pathlen:1
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
EOF_ROOT

cat > "${temporary}/leaf.cnf" <<'EOF_LEAF'
[req]
distinguished_name=dn
prompt=no
[dn]
CN=NCCB RISpro Printing
O=National Cancer Center Benghazi
[leaf_ext]
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=codeSigning
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF_LEAF

openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "${temporary}/qz-root-ca.key" >/dev/null 2>&1
openssl req -new -x509 -sha256 -days 3650 -key "${temporary}/qz-root-ca.key" -config "${temporary}/root.cnf" -out "${temporary}/qz-root-ca.crt"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "${temporary}/qz-signing-private-key.pem" >/dev/null 2>&1
openssl req -new -sha256 -key "${temporary}/qz-signing-private-key.pem" -config "${temporary}/leaf.cnf" -out "${temporary}/leaf.csr"
openssl x509 -req -sha256 -days 1095 -in "${temporary}/leaf.csr" -CA "${temporary}/qz-root-ca.crt" -CAkey "${temporary}/qz-root-ca.key" -CAcreateserial -extfile "${temporary}/leaf.cnf" -extensions leaf_ext -out "${temporary}/qz-signing-certificate.pem" >/dev/null 2>&1
openssl pkey -in "${temporary}/qz-signing-private-key.pem" -pubout -out "${temporary}/qz-signing-public-key.pem" >/dev/null 2>&1

ROOT_FP="$(openssl x509 -in "${temporary}/qz-root-ca.crt" -noout -fingerprint -sha256 | cut -d= -f2)" \
LEAF_FP="$(openssl x509 -in "${temporary}/qz-signing-certificate.pem" -noout -fingerprint -sha256 | cut -d= -f2)" \
ROOT_DATES="$(openssl x509 -in "${temporary}/qz-root-ca.crt" -noout -dates)" \
LEAF_DATES="$(openssl x509 -in "${temporary}/qz-signing-certificate.pem" -noout -dates)" \
node > "${temporary}/qz-signing-metadata.json" <<'EOF_META'
const dateLines = (value) => Object.fromEntries(value.trim().split(/\r?\n/).map((line) => line.split(/=(.*)/s).slice(0, 2)));
const root = dateLines(process.env.ROOT_DATES);
const leaf = dateLines(process.env.LEAF_DATES);
process.stdout.write(JSON.stringify({ schemaVersion: 1, trustMode: "internal_ca", algorithm: "RSA", bits: 3072, root: { commonName: "NCCB RISpro QZ Root CA", fingerprintSha256: process.env.ROOT_FP, notBefore: root.notBefore, notAfter: root.notAfter }, signing: { commonName: "NCCB RISpro Printing", fingerprintSha256: process.env.LEAF_FP, notBefore: leaf.notBefore, notAfter: leaf.notAfter } }, null, 2) + "\n");
EOF_META

rm -f "${temporary}/root.cnf" "${temporary}/leaf.cnf" "${temporary}/leaf.csr" "${temporary}/qz-root-ca.srl"
chmod 700 "$temporary"
chmod 600 "${temporary}/qz-root-ca.key" "${temporary}/qz-signing-private-key.pem"
chmod 644 "${temporary}/qz-root-ca.crt" "${temporary}/qz-signing-certificate.pem" "${temporary}/qz-signing-public-key.pem" "${temporary}/qz-signing-metadata.json"
validate_identity "$temporary" || { printf 'Generated QZ identity failed validation.\n' >&2; exit 1; }
mv "$temporary" "${IDENTITY_DIR}"
trap - EXIT
printf 'Generated persistent NCCB RISpro QZ signing identity at %s.\n' "${IDENTITY_DIR}"
