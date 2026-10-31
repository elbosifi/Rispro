# syntax=docker/dockerfile:1.7-labs

FROM node:20.18.1-slim AS builder

ARG OHIF_VERSION=v3.12.6
ARG APP_CONFIG=config/rispro.js
ARG PUBLIC_URL=/ohif/

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential ca-certificates git python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
RUN npm install -g bun@1.2.23 \
  && npm install -g lerna@7.4.2
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

# Keep the pinned upstream source and dependency installation in stable layers.
RUN git clone --depth 1 --branch "${OHIF_VERSION}" https://github.com/OHIF/Viewers.git .
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --no-save \
  && printf '[install]\nfrozenLockfile = false\n' > /tmp/bunfig.toml \
  && bun add --config=/tmp/bunfig.toml ajv@8.12.0

COPY docker/ohif/app-config.js platform/app/public/config/rispro.js
COPY frontend/public/assets/nccb-logo.png platform/app/public/assets/nccb-logo.png
COPY docker/ohif/rispro-reporting extensions/rispro-reporting
COPY frontend/src/hooks/use-audio-recorder.ts frontend/src/hooks/use-dictation-shortcuts.ts frontend/src/lib/dictation-preferences.ts frontend/src/lib/dictation-target.ts frontend/src/lib/medical-dictation-cleanup.ts extensions/rispro-reporting/src/dictation-shared/
COPY docker/ohif/register-reporting.cjs /tmp/register-reporting.cjs
COPY docker/ohif/configure-viewer.cjs /tmp/configure-viewer.cjs
COPY docker/ohif/configure-dynamic-mri.cjs /tmp/configure-dynamic-mri.cjs
COPY docker/ohif/dynamic-mri /tmp/dynamic-mri
COPY docker/ohif/configure-progressive.cjs /tmp/configure-progressive.cjs
COPY docker/ohif/configure-series-windowing.cjs /tmp/configure-series-windowing.cjs
COPY docker/ohif/configure-responsive.cjs /tmp/configure-responsive.cjs
COPY docker/ohif/configure-cornerstone-compat.cjs /tmp/configure-cornerstone-compat.cjs
COPY docker/ohif/configure-viewport-reliability.cjs /tmp/configure-viewport-reliability.cjs
COPY docker/ohif/configure-thumbnails.cjs /tmp/configure-thumbnails.cjs
COPY docker/ohif/responsive /tmp/responsive
COPY docker/ohif/verify-browser-build.cjs /tmp/verify-browser-build.cjs
RUN node /tmp/register-reporting.cjs \
  && node /tmp/configure-cornerstone-compat.cjs \
  && node /tmp/configure-viewer.cjs \
  && node /tmp/configure-viewport-reliability.cjs \
  && node /tmp/configure-thumbnails.cjs \
  && mkdir -p node_modules/@rispro \
  && ln -s ../../extensions/rispro-reporting node_modules/@rispro/extension-reporting
# Production minification; QUICK_BUILD=true remains available for local diagnosis.
ARG QUICK_BUILD=false
ENV QUICK_BUILD=${QUICK_BUILD}
ENV PUBLIC_URL=${PUBLIC_URL}
RUN bun run show:config \
  && bun run build \
  && node /tmp/verify-browser-build.cjs

FROM nginx:1.27.5-alpine
COPY docker/ohif/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html/ohif
COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

EXPOSE 80
