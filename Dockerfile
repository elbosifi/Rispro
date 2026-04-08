# =============================================================================
# RISpro Reception - Production Dockerfile (Multi-Stage Build)
# =============================================================================
# Stage 1: Build DCMTK from source (Debian bookworm)
# Stage 2: Build frontend assets (Node Alpine)
# Stage 3: Production runtime (Debian bookworm - consistent with DCMTK build)
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build DCMTK from source (Debian bookworm)
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS dcmtk-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libssl-dev \
    libxml2-dev \
    zlib1g-dev \
    libicu-dev \
    pkg-config \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Download and build DCMTK 3.6.9 (stable release with ppsscpfs)
ENV DCMTK_VERSION=3.6.9
RUN wget -q "https://dcmtk.org/pub/dcmtk/dcmtk-${DCMTK_VERSION}.tar.gz" \
    && tar -xzf "dcmtk-${DCMTK_VERSION}.tar.gz" \
    && cd "dcmtk-${DCMTK_VERSION}" \
    && mkdir build && cd build \
    && cmake .. \
       -DCMAKE_BUILD_TYPE=Release \
       -DCMAKE_INSTALL_PREFIX=/opt/dcmtk \
       -DDCMTK_WIDE_CHAR_FILE_IO_FUNCTIONS=ON \
       -DDCMTK_ENABLE_STL=ON \
    && make -j$(nproc) \
    && make install/strip \
    && cd ../.. \
    && rm -rf "dcmtk-${DCMTK_VERSION}" "dcmtk-${DCMTK_VERSION}.tar.gz"

# ---------------------------------------------------------------------------
# Stage 2: Build frontend assets
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: Production runtime (Debian bookworm - same base as DCMTK build)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS production

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy DCMTK binaries from builder stage
COPY --from=dcmtk-builder /opt/dcmtk/bin/* /usr/local/bin/
COPY --from=dcmtk-builder /opt/dcmtk/lib/* /usr/local/lib/
COPY --from=dcmtk-builder /opt/dcmtk/etc/dcmtk/ /etc/dcmtk/

# Update shared library cache
RUN ldconfig

# Verify DCMTK binaries are present
RUN echo "Verifying DCMTK installation..." \
    && wlmscpfs --version 2>&1 | head -1 \
    && ppsscpfs --version 2>&1 | head -1 \
    && dump2dcm --version 2>&1 | head -1 \
    && dcmdump --version 2>&1 | head -1 \
    && echoscu --version 2>&1 | head -1 \
    && findscu --version 2>&1 | head -1 \
    && echo "All DCMTK tools verified."

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

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
