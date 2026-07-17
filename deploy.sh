#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="${APP_DIR:-$SCRIPT_DIR}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
INSTALL_CMD="${INSTALL_CMD:-npm ci --omit=dev}"
MIGRATE_CMD="${MIGRATE_CMD:-npm run migrate}"
POST_MIGRATE_CMD="${POST_MIGRATE_CMD:-}"
BACKUP_CMD="${BACKUP_CMD:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
READINESSCHECK_URL="${READINESSCHECK_URL:-http://127.0.0.1:3000/api/ready}"
BUILD_SHA_URL="${BUILD_SHA_URL:-http://127.0.0.1:3000/api/health}"
RESTART_MODE="${RESTART_MODE:-systemd}"
SERVICE_NAME="${SERVICE_NAME:-}"
PM2_NAME="${PM2_NAME:-}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
ENABLE_DICOM_GATEWAY="${ENABLE_DICOM_GATEWAY:-0}"
DICOM_GATEWAY_SERVICE_NAME="${DICOM_GATEWAY_SERVICE_NAME:-rispro-dicom-gateway}"
DICOM_GATEWAY_APP_USER="${DICOM_GATEWAY_APP_USER:-www-data}"
DICOM_INSTALL_DCMTK="${DICOM_INSTALL_DCMTK:-1}"
INSTALL_NATIVE_IMAGE_DEPS="${INSTALL_NATIVE_IMAGE_DEPS:-1}"
EXPECTED_SHA="${EXPECTED_SHA:-${RISPRO_EXPECTED_SHA:-}}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

error_exit() {
  log "ERROR: $1"
  exit 1
}

run_cmd() {
  if [ -z "$1" ]; then
    return 0
  fi

  log "Running: $1"
  eval "$1"
}

is_enabled() {
  case "${1:-0}" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "Deployment stopped: the server checkout has uncommitted changes."
    echo "Commit or remove those changes on the server, then run deploy again."
    exit 1
  fi
}

validate_expected_sha() {
  if [[ ! "$EXPECTED_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
    error_exit "EXPECTED_SHA must be a full 40-character commit SHA."
  fi

  EXPECTED_SHA="$(printf '%s' "$EXPECTED_SHA" | tr '[:upper:]' '[:lower:]')"
}

parse_deployment_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --expected-sha)
        if [ "$#" -lt 2 ]; then
          error_exit "--expected-sha requires a full commit SHA."
        fi
        EXPECTED_SHA="$2"
        shift 2
        ;;
      *)
        error_exit "Unsupported deployment argument: $1"
        ;;
    esac
  done
}

checkout_expected_commit() {
  validate_expected_sha

  if [ "$SKIP_GIT_PULL" != "1" ]; then
    log "Fetching origin/$DEPLOY_BRANCH for exact deployment commit"
    git fetch origin "$DEPLOY_BRANCH"
    git checkout --detach "$EXPECTED_SHA"
  fi

  local checked_out_sha
  checked_out_sha="$(git rev-parse HEAD)"
  if [ "$checked_out_sha" != "$EXPECTED_SHA" ]; then
    error_exit "Checked-out commit $checked_out_sha does not match expected commit $EXPECTED_SHA."
  fi

  log "Verified checked-out commit: $checked_out_sha"
}

persist_runtime_build_sha() {
  local env_file="$APP_DIR/.env"
  local temp_file

  export RISPRO_BUILD_COMMIT_SHA="$EXPECTED_SHA"

  if [ ! -f "$env_file" ]; then
    log "No $env_file found; relying on the service environment for RISPRO_BUILD_COMMIT_SHA."
    return 0
  fi

  temp_file="$(mktemp)"
  awk -v expected_sha="$EXPECTED_SHA" '
    BEGIN { replaced = 0 }
    /^RISPRO_BUILD_COMMIT_SHA=/ {
      print "RISPRO_BUILD_COMMIT_SHA=" expected_sha
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print "RISPRO_BUILD_COMMIT_SHA=" expected_sha
    }
  ' "$env_file" > "$temp_file"
  mv "$temp_file" "$env_file"
  log "Persisted RISPRO_BUILD_COMMIT_SHA=$EXPECTED_SHA in $env_file"
}

restart_app() {
  case "$RESTART_MODE" in
    systemd)
      if [ -z "$SERVICE_NAME" ]; then
        echo "Deployment stopped: SERVICE_NAME is required when RESTART_MODE=systemd."
        exit 1
      fi

      log "Restarting systemd service: $SERVICE_NAME"
      sudo systemctl restart "$SERVICE_NAME"
      ;;
    pm2)
      if [ -z "$PM2_NAME" ]; then
        echo "Deployment stopped: PM2_NAME is required when RESTART_MODE=pm2."
        exit 1
      fi

      log "Restarting PM2 process: $PM2_NAME"
      RISPRO_BUILD_COMMIT_SHA="$EXPECTED_SHA" pm2 restart "$PM2_NAME" --update-env
      ;;
    none)
      log "Skipping restart because RESTART_MODE=none"
      ;;
    *)
      echo "Deployment stopped: unsupported RESTART_MODE '$RESTART_MODE'."
      echo "Use one of: systemd, pm2, none."
      exit 1
      ;;
  esac
}

ensure_dcmtk_tools() {
  if command -v dump2dcm >/dev/null 2>&1 && command -v dcmdump >/dev/null 2>&1 && command -v wlmscpfs >/dev/null 2>&1 && command -v echoscu >/dev/null 2>&1; then
    log "DCMTK tools already installed: dump2dcm=$(command -v dump2dcm), dcmdump=$(command -v dcmdump), wlmscpfs=$(command -v wlmscpfs), echoscu=$(command -v echoscu)"
    return 0
  fi

  if ! is_enabled "$DICOM_INSTALL_DCMTK"; then
    log "WARNING: DCMTK tools are missing and DICOM_INSTALL_DCMTK is disabled."
    return 1
  fi

  log "Installing DCMTK tools..."
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq dcmtk
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y -q dcmtk
  elif command -v yum >/dev/null 2>&1; then
    sudo yum install -y -q dcmtk
  else
    log "WARNING: No supported package manager found to install dcmtk."
    return 1
  fi

  if command -v dump2dcm >/dev/null 2>&1 && command -v dcmdump >/dev/null 2>&1 && command -v wlmscpfs >/dev/null 2>&1 && command -v echoscu >/dev/null 2>&1; then
    log "DCMTK tools installed successfully."
    return 0
  fi

  log "WARNING: DCMTK tools are still missing after installation."
  return 1
}

ensure_native_image_deps() {
  if ! is_enabled "$INSTALL_NATIVE_IMAGE_DEPS"; then
    log "Skipping libpng/libtiff installation because INSTALL_NATIVE_IMAGE_DEPS is disabled."
    return 0
  fi

  if command -v apt-get >/dev/null 2>&1; then
    log "Installing native image dependencies via apt-get (libpng-dev, libtiff-dev)..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq libpng-dev libtiff-dev
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    log "Installing native image dependencies via dnf (libpng-devel, libtiff-devel)..."
    sudo dnf install -y -q libpng-devel libtiff-devel
    return 0
  fi

  if command -v yum >/dev/null 2>&1; then
    log "Installing native image dependencies via yum (libpng-devel, libtiff-devel)..."
    sudo yum install -y -q libpng-devel libtiff-devel
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    log "Installing native image dependencies via Homebrew (libpng, libtiff)..."
    brew install libpng libtiff
    return 0
  fi

  log "WARNING: No supported package manager found to install libpng/libtiff automatically."
  return 0
}

provision_dicom_gateway_service() {
  local template target rendered tmpdir
  template="$APP_DIR/deploy/systemd/rispro-dicom-gateway.service"
  target="/etc/systemd/system/${DICOM_GATEWAY_SERVICE_NAME}.service"

  if [ ! -f "$template" ]; then
    echo "Deployment stopped: missing gateway service template at $template."
    exit 1
  fi

  tmpdir="$(mktemp -d)"
  rendered="$tmpdir/${DICOM_GATEWAY_SERVICE_NAME}.service"
  sed \
    -e "s|@RISPRO_APP_DIR@|$APP_DIR|g" \
    -e "s|@RISPRO_APP_USER@|$DICOM_GATEWAY_APP_USER|g" \
    "$template" > "$rendered"

  sudo install -D -m 0644 "$rendered" "$target"
  rm -rf "$tmpdir"

  log "Installed systemd unit: $target"
  sudo systemctl daemon-reload
  sudo systemctl enable "$DICOM_GATEWAY_SERVICE_NAME"
}

provision_main_app_gateway_dropin() {
  local dropin_dir dropin_file
  dropin_dir="/etc/systemd/system/${SERVICE_NAME}.service.d"
  dropin_file="${dropin_dir}/10-rispro-dicom-gateway.conf"

  sudo install -d "$dropin_dir"
  sudo tee "$dropin_file" >/dev/null <<EOF
[Service]
Environment=RISPRO_DISABLE_EMBEDDED_DICOM_GATEWAY=1
EOF

  log "Installed systemd drop-in: $dropin_file"
  sudo systemctl daemon-reload
}

rebuild_dicom_worklist_sources() {
  log "Rebuilding DICOM worklist sources..."
  npm run gateway:rebuild-sources
}

restart_dicom_gateway_service() {
  log "Restarting DICOM gateway service: $DICOM_GATEWAY_SERVICE_NAME"
  sudo systemctl restart "$DICOM_GATEWAY_SERVICE_NAME"
}

smoke_test_dicom_echo() {
  local mwl_ae_title mwl_port

  read_setting() {
    local key="$1"
    node --input-type=module -e "import pg from 'pg';
const { Pool } = pg;
const key = process.argv[1];
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const { rows } = await pool.query(\"select setting_value from system_settings where category = \$1 and setting_key = \$2 limit 1\", ['dicom_gateway', key]);
process.stdout.write(String(rows[0]?.setting_value?.value || ''));
await pool.end();" "$key"
  }

  mwl_ae_title="$(read_setting mwl_ae_title)"
  mwl_port="$(read_setting mwl_port)"

  local worklist_dir="$APP_DIR/storage/dicom/worklists/$mwl_ae_title"
  if [ ! -d "$worklist_dir" ]; then
    log "WARNING: Worklist directory $worklist_dir does not exist."
    log "Creating directory and ensuring permissions..."
    sudo mkdir -p "$worklist_dir"
    sudo chown -R "$DICOM_GATEWAY_APP_USER":"$DICOM_GATEWAY_APP_USER" "$APP_DIR/storage/dicom"
  fi

  if [ -z "$mwl_ae_title" ] || [ -z "$mwl_port" ]; then
    echo "Deployment stopped: unable to read MWL AE title or port from the database."
    exit 1
  fi

  log "Running DICOM C-ECHO smoke test against ${mwl_ae_title}@127.0.0.1:${mwl_port}"
  echoscu -v -aec "$mwl_ae_title" 127.0.0.1 "$mwl_port"
}

test_pacs_find() {
  # Manual test for PACS C-FIND logic
  # Usage: ./deploy.sh test-find <NATIONAL_ID>
  local id="${1:-}"
  if [ -z "$id" ]; then return 0; fi
  
  log "Testing PACS C-FIND for ID: $id"
  # This simulates the internal PACS service logic
  # Replace PACS_AET, RIS_AET, IP, and PORT with your specific values or 
  # use the read_setting function to pull them from DB
  findscu -v -S -k "0010,0020=$id" \
    -aec YOUR_PACS_AET \
    -aet YOUR_RIS_AET \
    YOUR_PACS_IP YOUR_PACS_PORT
}

main() {
  cd "$APP_DIR"

  log "Starting deployment in $APP_DIR"

  if is_enabled "$ENABLE_DICOM_GATEWAY" && [ "$RESTART_MODE" != "systemd" ]; then
    error_exit "ENABLE_DICOM_GATEWAY=1 requires RESTART_MODE=systemd."
  fi

  if is_enabled "$ENABLE_DICOM_GATEWAY" && [ -z "$SERVICE_NAME" ]; then
    error_exit "ENABLE_DICOM_GATEWAY=1 requires SERVICE_NAME to identify the main app systemd unit."
  fi

  if is_enabled "$ENABLE_DICOM_GATEWAY" && [[ "$INSTALL_CMD" == *"--omit=dev"* ]]; then
    log "DICOM gateway enabled; installing dev dependencies so gateway rebuild scripts can run."
    INSTALL_CMD="npm ci"
  fi

  parse_deployment_args "$@"
  validate_expected_sha

  if [ "$SKIP_GIT_PULL" != "1" ]; then
    ensure_clean_worktree
    checkout_expected_commit
  else
    log "Skipping git pull because SKIP_GIT_PULL=1"
    checkout_expected_commit
  fi

  run_cmd "$BACKUP_CMD"
  ensure_native_image_deps
  run_cmd "$INSTALL_CMD"
  run_cmd "$MIGRATE_CMD"
  run_cmd "$POST_MIGRATE_CMD"
  persist_runtime_build_sha

  if is_enabled "$ENABLE_DICOM_GATEWAY"; then
    ensure_dcmtk_tools || error_exit "DCMTK tools are required for DICOM gateway deployment."
    provision_dicom_gateway_service
    provision_main_app_gateway_dropin
    rebuild_dicom_worklist_sources
    sleep 2
  fi

  restart_app
  sleep 2

  if is_enabled "$ENABLE_DICOM_GATEWAY"; then
    restart_dicom_gateway_service
    sleep 2
  fi

  if is_enabled "$ENABLE_DICOM_GATEWAY"; then
    smoke_test_dicom_echo
  fi

  log "Checking application health endpoint: ${HEALTHCHECK_URL:-http://127.0.0.1:3000/api/health}"
  curl --fail --silent --show-error "${HEALTHCHECK_URL:-http://127.0.0.1:3000/api/health}" >/dev/null
  log "Checking application readiness endpoint: $READINESSCHECK_URL"
  curl --fail --silent --show-error "$READINESSCHECK_URL" >/dev/null
  log "Verifying application-reported build SHA at $BUILD_SHA_URL"
  health_json="$(curl --fail --silent --show-error "$BUILD_SHA_URL")"
  node - "$EXPECTED_SHA" "$health_json" <<'NODE_VERIFY'
const expectedSha = process.argv[2];
const health = JSON.parse(process.argv[3]);

if (health.ok !== true || health.buildSha !== expectedSha) {
  console.error(`Running build mismatch: expected ${expectedSha}, received ${JSON.stringify(health)}`);
  process.exit(1);
}

console.log(`Application-reported build SHA verified: ${expectedSha}`);
NODE_VERIFY

  log "Deployment finished successfully"
}

main "$@"
