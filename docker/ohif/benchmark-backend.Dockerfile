FROM node:22-bookworm-slim
WORKDIR /app
# Match this checkout's locked dependencies; mount source read-only at test time.
COPY package.json package-lock.json ./
ARG NPM_OFFLINE=false
RUN --mount=type=cache,target=/root/.npm npm ci --offline=${NPM_OFFLINE} --foreground-scripts --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000
CMD ["node", "--import", "tsx", "scripts/ohif-native-benchmark-server.mjs"]
