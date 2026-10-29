// Called by the guarded disposable-DB harness; never accepts a production URL.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { installProbe, waitPixels } from './ohif-native-benchmark.mjs';
const require = createRequire(import.meta.url), jwt = require('jsonwebtoken');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function pixels(body, type) {
  const boundary = /boundary="?([^";]+)/.exec(type)?.[1];
  assert.ok(boundary, 'Multipart boundary');
  return body.subarray(body.indexOf('\r\n\r\n') + 4, body.lastIndexOf('\r\n--' + boundary));
}

export async function runAuthenticatedNativeAcceptance(h) {
  const { browser, cases, origin, backendOrigin, archive, archiveRequest, pool, env, temp, login, userId, doctorId } = h;
  const security = [], results = [];
  const basic = 'Basic ' + Buffer.from('synthetic:synthetic-only').toString('base64');
  const forbidden = [env.ohifNativeAuthSecret, 'synthetic-only', basic];
  const save = () => writeFileSync(join(temp, 'authenticated-native-results.json'), JSON.stringify({ conditions: 'Synthetic CT/MR; Docker loopback; Basic authentication; same viewer image; no hospital LAN', security, results }, null, 2));
  function noSecrets(text) { for (const secret of forbidden) assert.ok(!text.includes(secret), 'No credential in client response or logs'); }
  async function context(token = login, viewport = { width: 1600, height: 1000 }) {
    const c = await browser.newContext({ viewport });
    if (token) await c.addCookies([{ name: env.cookieName, value: token, url: origin, httpOnly: true }]);
    return c;
  }
  async function exchange(c, ctx) {
    const launch = await h.launch(c); assert.equal(launch.status, 'ready');
    const r = await ctx.request.get(origin + launch.launchUrl, { maxRedirects: 0 });
    assert.equal(r.status(), 302);
    const url = new URL(r.headers().location, origin);
    assert.equal(url.searchParams.get('risproDelivery'), 'native');
    return url;
  }
  async function check(name, response, expected) {
    assert.equal(response.status(), expected, name);
    noSecrets(JSON.stringify(response.headers()) + await response.text());
    security.push({ check: name, http: response.status(), status: 'PASS' }); save();
  }
  const c = cases[0], ctx = await context(), url = await exchange(c, ctx);
  const contextId = url.searchParams.get('risproContext');
  const native = `${origin}/ohif-native/context/${contextId}/studies/${c.study}`;
  const frame = native + `/series/${c.study}.1/instances/${c.study}.1.1/frames/1`;
  await check('authenticated metadata', await ctx.request.get(native + '/metadata'), 200);
  await check('rendered JPEG thumbnail', await ctx.request.get(native + `/series/${c.study}.1/instances/${c.study}.1.1/rendered`, { headers: { Accept: 'image/jpeg' } }), 200);
  assert.equal((await fetch(archive + '/system')).status, 401, 'Orthanc Basic authentication remains enabled');
  security.push({ check: 'isolated Orthanc requires HTTP Basic, without Authorization plugin configuration', status: 'PASS' });
  const headers = { Accept: 'multipart/related; type="application/octet-stream"; transfer-syntax=*' };
  const direct = await archiveRequest(`/dicom-web/studies/${c.study}/series/${c.study}.1/instances/${c.study}.1.1/frames/1`, { headers });
  const source = pixels(Buffer.from(await direct.arrayBuffer()), direct.headers.get('content-type'));
  await fetch(backendOrigin + '/__benchmark/metrics?reset=1');
  const delivered = await ctx.request.get(frame, { headers });
  assert.equal(delivered.status(), 200);
  assert.deepEqual(pixels(await delivered.body(), delivered.headers()['content-type']), source, 'Diagnostic bytes are identical');
  const metrics = await (await fetch(backendOrigin + '/__benchmark/metrics')).json();
  assert.equal(metrics.proxyFrames, 0); assert.ok(metrics.authorizations > 0);
  noSecrets(JSON.stringify(delivered.headers()));
  security.push({ check: 'native frame byte equality and zero Express frame requests', status: 'PASS', pixelSha256: hash(source), metrics });
  const range = await ctx.request.get(frame, { headers: { ...headers, Range: 'bytes=0-127', 'If-Range': '"synthetic-etag"' } });
  const directRange = await archiveRequest(`/dicom-web/studies/${c.study}/series/${c.study}.1/instances/${c.study}.1.1/frames/1`, { headers: { ...headers, Range: 'bytes=0-127', 'If-Range': '"synthetic-etag"' } });
  assert.equal(range.status(), directRange.status);
  assert.equal(range.headers()['content-range'], directRange.headers.get('content-range') ?? undefined);
  security.push({ check: 'Range/If-Range behavior matches authenticated Orthanc', status: 'PASS', upstreamStatus: directRange.status });
  // Upstream credentials are taken from settings, and browser headers cannot
  // override them. A wrong saved password must fail closed, then recover.
  await check('client Authorization cannot override server credential', await ctx.request.get(native + '/metadata', { headers: { Authorization: 'Basic invalid', 'X-Rispro-Orthanc-Authorization': 'Basic invalid' } }), 200);
  const oldPassword = (await pool.query("select setting_value from system_settings where category='authoritative_orthanc' and setting_key='password'")).rows[0].setting_value;
  try {
    await pool.query("update system_settings set setting_value=$1 where category='authoritative_orthanc' and setting_key='password'", [JSON.stringify({ value: 'wrong-synthetic-password' })]);
    await check('wrong saved Orthanc credential fails closed', await ctx.request.get(native + '/metadata'), 401);
  } finally { await pool.query("update system_settings set setting_value=$1 where category='authoritative_orthanc' and setting_key='password'", [oldPassword]); }
  await check('saved Orthanc credential restored without gateway reconfiguration', await ctx.request.get(native + '/metadata'), 200);
  await check('unauthorized study', await ctx.request.get(native.replace(c.study, cases[1].study) + '/metadata'), 403);
  await check('query cannot widen study allowlist', await ctx.request.get(native + '/metadata?StudyInstanceUID=' + cases[1].study), 403);
  await check('malformed study suffix', await ctx.request.get(native + '/metadata/extra'), 403);
  await check('unrestricted search forbidden', await ctx.request.get(`${origin}/ohif-native/context/${contextId}/studies`), 403);
  for (const path of ['/system', '/tools/find', '/instances', '/patients', '/modalities']) await check('admin unavailable: ' + path, await ctx.request.get(`${origin}/ohif-native/context/${contextId}` + path), 403);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) await check(method + ' forbidden', await ctx.request.fetch(frame, { method }), 405);
  await check('internal subrequest is not public', await ctx.request.get(origin + '/_ohif-native-authorize'), 404);
  await check('credential endpoint blocked at public gateway', await ctx.request.get(origin + '/api/ohif/native/authorize', { headers: { 'X-Rispro-Native-Gateway': env.ohifNativeAuthSecret } }), 404);
  await check('direct API client without gateway secret', await ctx.request.get(backendOrigin + '/api/ohif/native/authorize', { headers: { Cookie: env.cookieName + '=' + login, 'X-Rispro-Native-Uri': new URL(native).pathname, 'X-Rispro-Native-Method': 'GET' } }), 403);
  await check('direct API client with wrong gateway secret', await ctx.request.get(backendOrigin + '/api/ohif/native/authorize', { headers: { 'X-Rispro-Native-Gateway': 'wrong', Cookie: env.cookieName + '=' + login } }), 403);
  for (const [name, token] of [['missing login', ''], ['expired login', jwt.sign({ sub: userId, role: 'doctor' }, env.jwtSecret, { expiresIn: -1 })], ['wrong user', jwt.sign({ sub: userId + 999999, role: 'doctor' }, env.jwtSecret, { expiresIn: '1h' })]]) {
    const denied = await context(token);
    try { await check(name, await denied.request.get(native + '/metadata'), 401); } finally { await denied.close(); }
  }
  const row = (await pool.query('select id,expires_at from viewer_launch_sessions where report_context_id=$1', [contextId])).rows[0];
  try {
    await pool.query("update viewer_launch_sessions set expires_at=now()-interval '1 second' where id=$1", [row.id]);
    await check('expired viewer context', await ctx.request.get(native + '/metadata'), 401);
    await pool.query('update viewer_launch_sessions set expires_at=$2,revoked_at=now() where id=$1', [row.id, row.expires_at]);
    await check('revoked viewer context, no authorization cache', await ctx.request.get(native + '/metadata'), 401);
  } finally { await pool.query('update viewer_launch_sessions set expires_at=$2,revoked_at=null where id=$1', [row.id, row.expires_at]); }
  try {
    await pool.query('update users set auth_version=auth_version+1 where id=$1', [userId]);
    await check('revoked login auth version', await ctx.request.get(native + '/metadata'), 401);
  } finally { await pool.query('update users set auth_version=auth_version-1 where id=$1', [userId]); }
  try {
    await pool.query('update doctor_portal.doctor_profiles set can_supervise=false where id=$1', [doctorId]);
    await pool.query('update doctor_portal.doctor_modality_permissions set active=false where doctor_id=$1', [doctorId]);
    await pool.query("update doctor_portal.case_team_assignments set status='cancelled' where appointment_id=$1 and assigned_doctor_id=$2", [c.appointmentId, doctorId]);
    await check('revoked case permission', await ctx.request.get(native + '/metadata'), 403);
  } finally {
    await pool.query('update doctor_portal.doctor_profiles set can_supervise=true where id=$1', [doctorId]);
    await pool.query('update doctor_portal.doctor_modality_permissions set active=true where doctor_id=$1', [doctorId]);
    await pool.query("update doctor_portal.case_team_assignments set status='active' where appointment_id=$1 and assigned_doctor_id=$2", [c.appointmentId, doctorId]);
  }
  const prior = c.study + '.8';
  await check('authorized prior metadata', await ctx.request.get(native.replace(c.study, prior) + '/metadata'), 200);
  const rollback = await ctx.request.get(frame.replace('/ohif-native/', '/ohif-dicomweb/'), { headers });
  assert.equal(rollback.status(), 200); assert.deepEqual(pixels(await rollback.body(), rollback.headers()['content-type']), source);
  security.push({ check: 'Express proxy rollback returns identical diagnostic pixels', status: 'PASS' });
  await ctx.close(); save();

  // Hold viewer, image negotiation, request limits and prefetch constant. The
  // proxy samples replace ONLY the WADO root in the browser's test config.
  const repeats = Number(process.env.OHIF_BENCH_REPEATS || 3);
  for (let repeat = 0; repeat < repeats; repeat++) for (const c of cases) for (const mode of repeat % 2 ? ['native', 'proxy'] : ['proxy', 'native']) {
    const ctx = await context(), url = await exchange(c, ctx);
    if (mode === 'proxy') await ctx.route('**/app-config.js*', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('/ohif-native/context/', '/ohif-dicomweb/context/') });
    });
    await ctx.addInitScript(installProbe);
    const page = await ctx.newPage(), failures = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', r => { if (r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    page.on('request', request => { assert.ok(!request.url().startsWith(archive)); noSecrets(JSON.stringify(request.headers())); });
    try {
      await fetch(backendOrigin + '/__benchmark/metrics?reset=1');
      await page.goto(url.href, { waitUntil: 'domcontentloaded' }); await waitPixels(page);
      const firstPixelsMs = await page.evaluate(() => window.__nativeBench.firstPixels.atMs);
      await page.waitForFunction(() => {
        const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        return v.getImageIds().every(id => window.cornerstone.cache.getImage(id));
      }, null, { timeout: 90000 });
      const completeSeriesMs = await page.evaluate(() => performance.now());
      const before = await page.evaluate(() => {
        const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        return { count: v.getImageIds().length, id: v.getCurrentImageId(), index: v.getCurrentImageIdIndex() };
      });
      const canvas = page.locator('.viewport-element canvas').first();
      await canvas.hover(); await page.mouse.wheel(0, 200);
      await page.waitForFunction(id => {
        const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        return v.getCurrentImageId() !== id;
      }, before.id);
      // Select a never-loaded series and time its first diagnostic slice.
      const switchAt = await page.evaluate(() => performance.now());
      await page.locator('[data-cy="study-browser-thumbnail"][data-series="2"]').first().dblclick();
      const unloadedSliceMs = await waitPixels(page, c.study + '.2', switchAt) - switchAt;
      const config = await page.evaluate(() => ({ limits: window.config.maxNumRequests, root: window.config.dataSources[0].configuration.wadoRoot }));
      assert.deepEqual(config.limits, { interaction: 4, thumbnail: 4, prefetch: 1 });
      assert.ok(config.root.startsWith(mode === 'native' ? '/ohif-native/' : '/ohif-dicomweb/'));
      await page.screenshot({ path: join(temp, `authenticated-${mode}-${c.modality}-${repeat}.png`) });
      const backend = await (await fetch(backendOrigin + '/__benchmark/metrics')).json();
      if (mode === 'native') { assert.equal(backend.proxyFrames, 0); assert.ok(backend.authorizations > 0); }
      else assert.ok(backend.proxyFrames > 0);
      await page.reload({ waitUntil: 'domcontentloaded' }); await waitPixels(page);
      const reopenMs = await page.evaluate(() => window.__nativeBench.firstPixels.atMs);
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      const result = { mode, repeat, modality: c.modality, firstPixelsMs, completeSeriesMs, unloadedSliceMs, reopenMs, slices: before.count, scrolling: 'PASS', ...config, backend };
      results.push(result); save(); console.log(JSON.stringify({ authenticatedNativeBenchmark: result }));
    } catch (error) {
      await page.screenshot({ path: join(temp, 'authenticated-failure.png') }).catch(() => {});
      writeFileSync(join(temp, 'authenticated-failure.json'), JSON.stringify({ errors, failures, body: await page.locator('body').innerText(), probe: await page.evaluate(() => window.__nativeBench) }, null, 2));
      throw error;
    } finally { await ctx.close(); }
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) for (const c of cases) {
    const ctx = await context(login, viewport), url = await exchange(c, ctx);
    await ctx.addInitScript(installProbe);
    const page = await ctx.newPage();
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' }); await waitPixels(page);
      await page.screenshot({ path: join(temp, `authenticated-native-${c.modality}-${viewport.width}.png`) });
      security.push({ check: `native ${c.modality} Chromium rendering at ${viewport.width}x${viewport.height}`, status: 'PASS' });
    } finally { await ctx.close(); }
  }
  // Verify the actual explicit rollback URL separately from the controlled
  // benchmark profile, retaining the application's ordinary proxy limits.
  const fallback = await context(), fallbackUrl = await exchange(c, fallback);
  fallbackUrl.searchParams.set('risproDelivery', 'proxy');
  await fallback.addInitScript(installProbe);
  try {
    const page = await fallback.newPage();
    await fetch(backendOrigin + '/__benchmark/metrics?reset=1');
    await page.goto(fallbackUrl.href, { waitUntil: 'domcontentloaded' }); await waitPixels(page);
    assert.ok((await (await fetch(backendOrigin + '/__benchmark/metrics')).json()).proxyFrames > 0);
    await page.screenshot({ path: join(temp, 'authenticated-explicit-proxy-rollback.png') });
    security.push({ check: 'explicit risproDelivery=proxy rollback renders diagnostic CT pixels', status: 'PASS' });
  } finally { await fallback.close(); }
  noSecrets(h.logs());
  security.push({ check: 'no credentials in gateway/backend/archive logs', status: 'PASS' }); save();
  console.log('PASS: authenticated native transport, security, byte equality, CT/MR pixels, scrolling and proxy rollback');
}
