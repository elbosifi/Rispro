# =============================================================================
# RISpro Reception - Production Dockerfile
# =============================================================================
# Multi-stage build: builds frontend, then packages backend + static assets
# =============================================================================

FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# =============================================================================

FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install build dependencies for native modules (dicom-dimse-native)
# Uncomment if DICOM features are needed:
# RUN apk add --no-cache python3 make g++

# Install backend dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy backend source
COPY src/ ./src/
COPY tsconfig.json ./

# Copy frontend build from previous stage
COPY --from=frontend-builder /app/dist-frontend ./dist-frontend/

# Create uploads directory
RUN mkdir -p storage/uploads

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 || exit 1

EXPOSE 3000

# Start with tsx for TypeScript execution
CMD ["npx", "tsx", "src/server.ts"]
