FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends dcmtk ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN chmod +x /app/scripts/dicom-gateway/run-gateway.sh

CMD ["/app/scripts/dicom-gateway/run-gateway.sh"]
