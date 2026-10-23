import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("existing gateway permits CPU dictation deadlines only on the exact transcription route", () => {
  const config = readFileSync(new URL("../../../docker/reverse-proxy/nginx.conf", import.meta.url), "utf8");
  const route = config.match(/location = \/api\/medical-dictation\/transcribe \{([^}]+)\}/)?.[1];
  assert.ok(route, "dedicated transcription route is required");
  assert.ok(Number(route.match(/proxy_read_timeout (\d+)s/)?.[1]) > 600, "gateway must outlast the maximum saved inference deadline");
  assert.match(route, /client_max_body_size 16m;/, "allow 15 MB audio plus multipart headers");
  assert.match(route, /proxy_request_buffering off;/, "keep recordings out of gateway disk buffering");
  assert.match(route, /proxy_pass http:\/\/rispro_app;/, "gateway must proxy to RISpro, never MedASR");
  assert.match(config, /location \/ \{[^}]+proxy_read_timeout 120s;/, "ordinary API timeout remains unchanged");
});
