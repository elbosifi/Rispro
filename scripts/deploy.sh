#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
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

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

run_cmd() {
  if [ -z "$1" ]; then
    return 0
  fi

  log "Running: $1"
  eval "$1"
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

main() {
  cd "$APP_DIR"

  log "Starting deployment in $APP_DIR"

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
  restart_app

  if [ -n "$HEALTHCHECK_URL" ]; then
    log "Checking health endpoint: $HEALTHCHECK_URL"
    curl --fail --silent --show-error "$HEALTHCHECK_URL" >/dev/null
  else
    log "Skipping health check because HEALTHCHECK_URL is not set"
  fi

  log "Deployment finished successfully"
}

main "$@"
