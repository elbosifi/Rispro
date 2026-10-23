import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const config = readFileSync(new URL("../../../docker/reverse-proxy/nginx.conf", import.meta.url), "utf8");

test("MedGemma generation has an exact proxy route covering the maximum saved timeout", () => {
  const matches = [...config.matchAll(/location\s*=\s*\/api\/medgemma\/generate\s*\{([^}]+)\}/g)];
  assert.equal(matches.length, 1, "Generation must have one dedicated exact-match location");
  const block = matches[0][1];
  assert.match(block, /proxy_pass\s+http:\/\/rispro_app;/);
  // 600 seconds is the maximum accepted by the saved connection settings.
  for (const directive of ["proxy_read_timeout", "proxy_send_timeout", "send_timeout"]) {
    const timeout = block.match(new RegExp(`\\b${directive}\\s+(\\d+)s;`));
    assert.ok(timeout, `Missing ${directive}`);
    assert.equal(Number(timeout[1]), 630, `${directive} must allow the 600-second deadline plus response margin`);
  }
  for (const header of ["Host", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For"]) assert.match(block, new RegExp(`proxy_set_header\\s+${header}\\s+`));
});

test("ordinary API routes retain their existing 120-second proxy read timeout", () => {
  const ordinary = config.match(/location\s+\/\s*\{([^}]+)\}/);
  assert.ok(ordinary, "Missing ordinary API fallback location");
  assert.match(ordinary[1], /proxy_read_timeout\s+120s;/);
  assert.doesNotMatch(ordinary[1], /(?:proxy_send_timeout|send_timeout)\s+630s;/);
  assert.doesNotMatch(config, /location\s+(?:\^~\s+)?\/api\/(?:medgemma\/)?\s*\{/);
});
