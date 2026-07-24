import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
const internal = fs.readFileSync(path.join(root, "docker-compose.internal-db.yml"), "utf8");
const entrypoint = fs.readFileSync(path.join(root, "docker/rispro/entrypoint.sh"), "utf8");

test("Request Scan Compose worker has no published HTTP/DICOM ports and shares the app image and storage", () => {
  const worker = compose.slice(compose.indexOf("  request-scan-worker:"), compose.indexOf("\n  ohif:"));
  assert.match(worker, /image: \$\{RISPRO_APP_IMAGE:-rispro-app:local\}/);
  assert.match(worker, /REQUEST_SCAN_WORKER_PROCESS_ENABLED: "\$\{REQUEST_SCAN_DEDICATED_WORKER_ENABLED:-true\}"/);
  assert.match(worker, /REQUEST_SCAN_MAX_CONCURRENCY: "\$\{REQUEST_SCAN_DEDICATED_MAX_CONCURRENCY:-1\}"/);
  assert.match(worker, /RISPRO_SKIP_BOOTSTRAP: "1"/);
  assert.match(worker, /- rispro-storage:\/app\/storage/);
  assert.match(worker, /cpus: 2/);
  assert.match(worker, /mem_limit: 3g/);
  assert.match(worker, /stop_grace_period: 75s/);
  assert.match(worker, /healthcheck:[\s\S]*healthcheck:request-scan-worker/);
  assert.match(worker, /interval: 30s/);
  assert.match(worker, /retries: 3/);
  assert.doesNotMatch(worker, /^\s+ports:/m);
  assert.doesNotMatch(worker, /^\s+expose:/m);
});

test("Compose app disables embedded Request Scan processing and worker waits for app health", () => {
  const app = compose.slice(compose.indexOf("  app:"), compose.indexOf("\n  request-scan-worker:"));
  assert.match(app, /REQUEST_SCAN_WORKER_PROCESS_ENABLED: "\$\{REQUEST_SCAN_APP_WORKER_ENABLED:-false\}"/);
  assert.match(app, /REQUEST_SCAN_MAX_CONCURRENCY: "1"/);
  assert.match(compose, /request-scan-worker:[\s\S]*depends_on:[\s\S]*app:[\s\S]*condition: service_healthy/);
  assert.match(internal, /request-scan-worker:[\s\S]*postgres:[\s\S]*condition: service_healthy/);
});

test("worker bootstrap waits for PostgreSQL but skips migrations and seeding", () => {
  assert.doesNotMatch(entrypoint, /\r\n/);
  assert.match(entrypoint, /wait_for_postgres/);
  assert.match(entrypoint, /RISPRO_SKIP_BOOTSTRAP/);
  assert.match(entrypoint, /Skipping migrations and account seeding/);
});
