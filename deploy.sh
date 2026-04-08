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
RESTART_MODE="${RESTART_MODE:-systemd}"
SERVICE_NAME="${SERVICE_NAME:-}"
PM2_NAME="${PM2_NAME:-}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
ENABLE_DICOM_GATEWAY="${ENABLE_DICOM_GATEWAY:-0}"
DICOM_GATEWAY_SERVICE_NAME="${DICOM_GATEWAY_SERVICE_NAME:-rispro-dicom-gateway}"
DICOM_GATEWAY_APP_USER="${DICOM_GATEWAY_APP_USER:-www-data}"
DICOM_INSTALL_DCMTK="${DICOM_INSTALL_DCMTK:-1}"

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
      pm2 restart "$PM2_NAME"
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

  if [ -z "$mwl_ae_title" ] || [ -z "$mwl_port" ]; then
    echo "Deployment stopped: unable to read MWL AE title or port from the database."
    exit 1
  fi

  log "Running DICOM C-ECHO smoke test against ${mwl_ae_title}@127.0.0.1:${mwl_port}"
  echoscu -v -aec "$mwl_ae_title" 127.0.0.1 "$mwl_port"
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

  if [ "$SKIP_GIT_PULL" != "1" ]; then
    ensure_clean_worktree
    log "Updating code from origin/$DEPLOY_BRANCH"
    git fetch origin "$DEPLOY_BRANCH"
    git checkout "$DEPLOY_BRANCH"
    git pull --rebase origin "$DEPLOY_BRANCH"
  else
    log "Skipping git pull because SKIP_GIT_PULL=1"
  fi

  run_cmd "$BACKUP_CMD"
  run_cmd "$INSTALL_CMD"
  run_cmd "$MIGRATE_CMD"
  run_cmd "$POST_MIGRATE_CMD"

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

  if [ -n "$HEALTHCHECK_URL" ]; then
    log "Checking health endpoint: $HEALTHCHECK_URL"
    curl --fail --silent --show-error "$HEALTHCHECK_URL" >/dev/null
  else
    log "Skipping health check because HEALTHCHECK_URL is not set"
  fi

  log "Deployment finished successfully"
}

main "$@"
