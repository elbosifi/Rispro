import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const secret = 'a'.repeat(64); // Synthetic; Compose config only, no services started.
function config({ native = true, enabled, gatewaySecret = secret } = {}) {
  const env = { ...process.env, OHIF_NATIVE_AUTH_SECRET: gatewaySecret };
  delete env.OHIF_NATIVE_DELIVERY_ENABLED;
  if (enabled !== undefined) env.OHIF_NATIVE_DELIVERY_ENABLED = enabled;
  return spawnSync('docker', [
    'compose', '--env-file', 'codex-db-test.env', '-f', 'docker-compose.yml',
    ...(native ? ['-f', 'docker-compose.ohif-native.yml'] : []),
    'config', '--no-env-resolution', '--format', 'json',
  ], { cwd: root, env, encoding: 'utf8' });
}
function services(options) {
  const result = config(options);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).services;
}

test('native overlay enables the existing app gate and supplies the matching required gateway secret and route', () => {
  const { app, gateway } = services();
  assert.equal(app.environment.OHIF_NATIVE_DELIVERY_ENABLED, 'true');
  assert.equal(app.environment.OHIF_NATIVE_AUTH_SECRET, secret);
  assert.equal(gateway.environment.OHIF_NATIVE_AUTH_SECRET, secret);
  assert.ok(gateway.volumes.some(v => v.target === '/etc/nginx/templates/native.conf.template' && v.read_only));
  assert.ok(gateway.tmpfs.some(v => v.startsWith('/etc/nginx/ohif-native:')));
});

test('explicit server-side emergency disable overrides the native overlay default', () => {
  assert.equal(services({ enabled: 'false' }).app.environment.OHIF_NATIVE_DELIVERY_ENABLED, 'false');
});

test('base-only installations do not enable native and the native overlay refuses a missing secret', () => {
  const { app, gateway } = services({ native: false, gatewaySecret: '' });
  assert.equal(app.environment.OHIF_NATIVE_DELIVERY_ENABLED, undefined);
  assert.ok(!gateway.volumes.some(v => v.target === '/etc/nginx/templates/native.conf.template'));
  const missing = config({ gatewaySecret: '' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /OHIF_NATIVE_AUTH_SECRET/);
});
