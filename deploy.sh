#!/bin/bash
set -euo pipefail

APP_DIR="/home/rispro/Rispro"
LOG_FILE="/home/rispro/deploy-$(date +%Y%m%d-%H%M%S).log"

log() {
  echo "[$(date +%H:%M:%S)] $1" | tee -a "$LOG_FILE"
}

error_exit() {
  log "ERROR: $1"
  log "Deployment failed. Check $LOG_FILE for details."
  exit 1
}

log "========================================="
log "Starting RISpro deployment"
log "========================================="

# 1. Verify prerequisites
log "Checking prerequisites..."
command -v node >/dev/null 2>&1 || error_exit "Node.js not installed"
command -v npm >/dev/null 2>&1 || error_exit "npm not installed"
command -v git >/dev/null 2>&1 || error_exit "git not installed"

# 2. Pull latest code
log "Fetching latest code from GitHub..."
cd "${APP_DIR}"
git fetch origin || error_exit "Failed to fetch from GitHub"

CURRENT_COMMIT=$(git rev-parse --short HEAD)
NEW_COMMIT=$(git rev-parse --short origin/main)

if [ "$CURRENT_COMMIT" = "$NEW_COMMIT" ]; then
  log "Already on latest version ($CURRENT_COMMIT). Nothing to deploy."
  exit 0
fi

log "Updating from $CURRENT_COMMIT to $NEW_COMMIT..."
git reset --hard origin/main || error_exit "Failed to reset to origin/main"

# 3. Install ALL dependencies (including dev deps for build/migrate)
log "Installing dependencies..."
npm ci || error_exit "Failed to install dependencies"

# 4. Load environment variables
log "Loading environment variables..."
if [ -f "${APP_DIR}/.env" ]; then
  set -a
  source "${APP_DIR}/.env"
  set +a
  log "Environment loaded from .env"
else
  log "WARNING: .env file not found at ${APP_DIR}/.env"
fi

# 5. Run database migrations
log "Running database migrations..."
npm run migrate || error_exit "Failed to run database migrations"
log "Migrations completed successfully"

# 6. Build frontend
log "Building frontend..."
cd "${APP_DIR}/frontend"
npm run build || error_exit "Frontend build failed"
log "Frontend built successfully"

# 7. Verify frontend build was placed correctly
cd "${APP_DIR}"
if [ -d "dist-frontend" ] && [ -f "dist-frontend/index.html" ]; then
  log "Frontend build verified at dist-frontend/"
else
  log "WARNING: dist-frontend not found or missing index.html. Checking frontend/dist..."
  if [ -d "frontend/dist" ]; then
    rm -rf dist-frontend
    cp -r frontend/dist dist-frontend || error_exit "Failed to copy frontend build"
    log "Frontend deployed to dist-frontend/"
  else
    error_exit "Frontend build output not found in dist-frontend/ or frontend/dist/"
  fi
fi

# 8. Restart backend service
log "Restarting RISpro backend service..."
systemctl restart rispro || error_exit "Failed to restart rispro service"

# 9. Wait for service to start
log "Waiting for service to start..."
sleep 3

# 10. Health check
log "Running health checks..."
MAX_RETRIES=10
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -sf http://127.0.0.1:3000/api/ready > /dev/null 2>&1; then
    log "Health check passed: backend is ready"
    break
  fi

  RETRY_COUNT=$((RETRY_COUNT + 1))

  if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    error_exit "Health check failed after ${MAX_RETRIES} retries"
  fi

  log "Health check attempt ${RETRY_COUNT}/${MAX_RETRIES}... retrying in 2s"
  sleep 2
done

# 11. Final status
log "========================================="
log "Deployment successful!"
log "Version: $NEW_COMMIT"
log "Log file: $LOG_FILE"
log "========================================="

systemctl --no-pager status rispro

# Final readiness check
curl -s http://127.0.0.1:3000/api/ready
echo ""
log "RISpro is ready"
