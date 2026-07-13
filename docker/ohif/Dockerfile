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
ENV QUICK_BUILD=true
ENV PUBLIC_URL=${PUBLIC_URL}
RUN bun run show:config \
  && bun run build

FROM nginx:1.27.5-alpine
COPY docker/ohif/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html/ohif
COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

EXPOSE 80
