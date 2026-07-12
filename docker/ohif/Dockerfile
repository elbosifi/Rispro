FROM node:22.22.0-bookworm-slim AS builder

ARG OHIF_VERSION=v3.12.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src
RUN git clone --depth 1 --branch "${OHIF_VERSION}" https://github.com/OHIF/Viewers.git ohif
WORKDIR /usr/src/ohif
RUN corepack enable && yarn install --frozen-lockfile
COPY docker/ohif/app-config.js platform/app/public/config/rispro.js
RUN PUBLIC_URL=/ohif/ APP_CONFIG=config/rispro.js yarn build

FROM nginx:1.27.5-alpine
COPY docker/ohif/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /usr/src/ohif/platform/app/dist /usr/share/nginx/html/ohif

EXPOSE 80
