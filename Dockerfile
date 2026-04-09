# =============================================================================
# RISpro Reception - Production Dockerfile (Multi-Stage Build)
# =============================================================================
# Stage 1: Build frontend assets
# Stage 2: Build the MWL-only DCMTK 3.6.9 toolchain from the OFFIS release tarball
# Stage 3: Production runtime (Node.js + copied MWL DCMTK toolchain)
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
# Stage 2: Build DCMTK 3.6.9 from OFFIS release tarball
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS dcmtk-builder

WORKDIR /tmp

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      build-essential \
      cmake \
      ca-certificates \
      wget \
      libssl-dev \
      libxml2-dev \
      zlib1g-dev \
      libwrap0-dev \
      libpng-dev \
      libtiff-dev \
      libsndfile1-dev \
    xxd; \
    rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    dcmtk_url="https://support.dcmtk.org/redmine/attachments/download/214/dcmtk-3.6.9.tar.gz"; \
    dcmtk_sha256="b93ff5561244916a6e1e7e3ecccf2e26e6932c4edb5961268401cea7d4ab9c16"; \
    wget -O /tmp/dcmtk-3.6.9.tar.gz "$dcmtk_url"; \
    echo "${dcmtk_sha256}  /tmp/dcmtk-3.6.9.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/dcmtk-3.6.9.tar.gz -C /tmp; \
    rm -f /tmp/dcmtk-3.6.9.tar.gz

RUN set -eux; \
    src_dir="$(find /tmp -maxdepth 1 -type d -name 'dcmtk-*' | sort | head -n 1)"; \
    cmake -S "$src_dir" -B "$src_dir/build" \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/dcmtk \
      -DDCMTK_WIDE_CHAR_FILE_IO_FUNCTIONS=ON \
      -DDCMTK_ENABLE_STL=ON \
      -DBUILD_SHARED_LIBS=ON; \
    cmake --build "$src_dir/build" -j"$(nproc)"; \
    cmake --install "$src_dir/build"

# ---------------------------------------------------------------------------
# Stage 3: Production runtime (Node.js + copied MWL DCMTK toolchain)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS production

# Install runtime dependencies for the app and DCMTK shared libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    bash \
    libssl3 \
    libxml2 \
    zlib1g \
    libwrap0 \
    libpng16-16 \
    libtiff6 \
    libsndfile1 \
    libjpeg62-turbo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy the source-built DCMTK toolchain into the runtime image.
# MPPS is intentionally omitted in this build; only MWL-required tools are verified.
COPY --from=dcmtk-builder /opt/dcmtk /opt/dcmtk
ENV PATH="/opt/dcmtk/bin:/opt/dcmtk/sbin:${PATH}"

RUN set -eux; \
    for libdir in /opt/dcmtk/lib /opt/dcmtk/lib64; do \
      if [ -d "$libdir" ]; then \
        echo "$libdir"; \
      fi; \
    done > /etc/ld.so.conf.d/dcmtk.conf; \
    ldconfig

# Fail the build unless the MWL-required DCMTK tools are present and executable.
# Print resolved paths to make build failures easier to diagnose.
RUN set -eux; \
    for tool in wlmscpfs dump2dcm dcmdump echoscu findscu; do \
      tool_path="$(command -v "$tool")"; \
      echo "$tool: $tool_path"; \
      test -n "$tool_path"; \
      test -x "$tool_path"; \
    done

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

# Create DICOM worklist directories
RUN mkdir -p \
    storage/dicom/worklist-source \
    storage/dicom/worklists \
    storage/uploads

# Copy entrypoint script
COPY docker/rispro/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 || exit 1

EXPOSE 3000 11112

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["npx", "tsx", "src/server.ts"]
