import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { verifyOhifAppConfig } from './verify-ohif-app-config.mjs';

test('OHIF deployment check detects config delivery failures using localhost HTTP', async t => {
  const expected = readFileSync(new URL('../docker/ohif/app-config.js', import.meta.url), 'utf8');
  let status = 200;
  let body = expected;
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/ohif/app-config.js');
    response.writeHead(status, { 'content-type': 'application/javascript', location: '/ohif/' });
    response.end(body);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/ohif/app-config.js`;
  try {
    await t.test('accepts HTTP 200 with the actual checked-out RISpro config', () => verifyOhifAppConfig(url, expected));
    for (const code of [403, 404, 302]) {
      await t.test(`rejects HTTP ${code}`, async () => {
        status = code;
        await assert.rejects(verifyOhifAppConfig(url, expected), new RegExp(`HTTP ${code}`));
      });
    }
    status = 200;
    for (const [name, value] of [
      ['HTML fallback', '<html>viewer shell</html>'],
      ['stale config', expected.replace("routerBasename: '/ohif'", "routerBasename: '/old-ohif'")],
    ]) {
      await t.test(`rejects HTTP 200 with ${name}`, async () => {
        body = value;
        await assert.rejects(verifyOhifAppConfig(url, expected), /differs from the checked-out configuration/);
      });
    }
    await t.test('rejects malformed JavaScript even if the checkout matches', async () => {
      body = 'window.config = {';
      await assert.rejects(verifyOhifAppConfig(url, body), /Unexpected/);
    });
    await t.test('rejects a valid script with the wrong RISpro data source', async () => {
      body = expected.replace("defaultDataSourceName: 'risproDicomWeb'", "defaultDataSourceName: 'other'");
      await assert.rejects(verifyOhifAppConfig(url, body));
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
