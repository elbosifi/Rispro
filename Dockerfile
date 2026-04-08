# =============================================================================
# RISpro Reception - Production Dockerfile (Multi-Stage Build)
# =============================================================================
# Stage 1: Build frontend assets
# Stage 2: Production runtime (Debian bookworm with DCMTK from apt)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build frontend assets
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Production runtime (Debian bookworm + DCMTK from apt)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS production

# Install runtime dependencies including DCMTK from Debian repos
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    bash \
    dcmtk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Verify all required DCMTK tools are present and executable
RUN echo "Verifying DCMTK installation..." \
    && wlmscpfs --version 2>&1 | head -1 \
    && ppsscpfs --version 2>&1 | head -1 \
    && dump2dcm --version 2>&1 | head -1 \
    && dcmdump --version 2>&1 | head -1 \
    && echoscu --version 2>&1 | head -1 \
    && findscu --version 2>&1 | head -1 \
    && echo "All DCMTK tools verified."

# Install backend dependencies (include devDependencies for tsx)
# NODE_ENV=development ensures tsx (in devDependencies) is installed.
# The ENV NODE_ENV=production below sets the runtime mode.
COPY package.json package-lock.json ./
RUN NODE_ENV=development npm ci

# Copy backend source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy DICOM gateway scripts
COPY scripts/dicom-gateway/ ./scripts/dicom-gateway/

# Copy frontend build from previous stage
COPY --from=frontend-builder /app/dist-frontend ./dist-frontend/

# Create DICOM gateway directories
RUN mkdir -p \
    storage/dicom/worklist-source \
    storage/dicom/worklists \
    storage/dicom/mpps/inbox \
    storage/dicom/mpps/processed \
    storage/dicom/mpps/failed \
    storage/uploads

# Copy entrypoint script
COPY docker/rispro/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 || exit 1

EXPOSE 3000 11112 11113

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
