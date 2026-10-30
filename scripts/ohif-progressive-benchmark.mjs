// Extension of the existing synthetic Orthanc + authenticated OHIF harness.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { fixture, raw, frameBytes, installProbe, waitPixels } from './ohif-native-benchmark.mjs';
const require = createRequire(import.meta.url), jwt = require('jsonwebtoken');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function recordRenders() {
  window.__diagnosticRenders = [];
  document.addEventListener('CORNERSTONE_IMAGE_RENDERED', () => {
    const s = window.services;
    const v = s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
    if (v?.viewportStatus === 'rendered' && v.getCornerstoneImage?.()?.getPixelData()?.length) {
      window.__diagnosticRenders.push({ atMs: performance.now(), imageId: v.getCurrentImageId() });
    }
  }, true);
}

export async function runProgressiveBenchmark(h) {
  const { browser, cases, origin, uncompressedOrigin, archiveRequest, pool, env, temp, login } = h;
  const results = [], checks = [];
  const save = () => writeFileSync(join(temp, 'progressive-results.json'), JSON.stringify({ conditions: 'Local synthetic Orthanc, real pinned production OHIF and Nginx; Chromium', results, checks }, null, 2));
  const c = cases.find(c => c.modality === 'MR');
  for (let series = 5; series <= 13; series++) await fixture(c, series, 16, 192, archiveRequest);
  assert.equal((await (await archiveRequest(`/dicom-web/studies/${c.study}/series`)).json()).length, 12);
  async function context() {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: env.cookieName, value: login, url: origin }]);
    await ctx.addInitScript(installProbe); await ctx.addInitScript(recordRenders);
    return ctx;
  }
  async function exchange(ctx, item = c) {
    const launch = await h.launch(item, ctx); assert.equal(launch.status, 'ready');
    const response = await ctx.request.get(origin + launch.launchUrl, { maxRedirects: 0 });
    assert.equal(response.status(), 302);
    return new URL(response.headers().location, origin);
  }
  const ctx = await context();
  const url = await exchange(ctx), id = url.searchParams.get('risproContext');
  const path = `/ohif-native/context/${id}/studies/${c.study}/series/${c.study}.2`;
  const cookie = (await ctx.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
  const headers = { Cookie: cookie, Accept: 'application/dicom+json', 'Accept-Encoding': 'gzip' };
  const before = await raw(uncompressedOrigin + path + '/metadata', headers);
  const after = await raw(origin + path + '/metadata', headers);
  assert.equal(before.status, 200); assert.equal(after.status, 200);
  assert.equal(before.headers['content-encoding'], undefined);
  assert.equal(after.headers['content-encoding'], 'gzip');
  assert.match(after.headers['content-type'], /application\/dicom\+json/);
  assert.deepEqual(gunzipSync(after.body), before.body);
  const framePath = path + `/instances/${c.study}.2.1/frames/1`;
  const frameHeaders = { Cookie: cookie, Accept: 'multipart/related; type=application/octet-stream; transfer-syntax=*', 'Accept-Encoding': 'gzip' };
  const frameBefore = await raw(uncompressedOrigin + framePath, frameHeaders);
  const frameAfter = await raw(origin + framePath, frameHeaders);
  assert.equal(frameAfter.status, 200); assert.equal(frameBefore.status, 200);
  assert.equal(frameAfter.headers['content-encoding'], undefined);
  const pixelsBefore = frameBytes(frameBefore.body, frameBefore.headers['content-type']);
  const pixelsAfter = frameBytes(frameAfter.body, frameAfter.headers['content-type']);
  assert.deepEqual(pixelsAfter, pixelsBefore);
  const partHeaders = body => body.subarray(body.indexOf('\r\n') + 2, body.indexOf('\r\n\r\n')).toString();
  assert.equal(partHeaders(frameAfter.body), partHeaders(frameBefore.body));
  assert.equal(/transfer-syntax=([^; ]+)/.exec(frameAfter.headers['content-type'])?.[1], /transfer-syntax=([^; ]+)/.exec(frameBefore.headers['content-type'])?.[1]);
  const probe = await ctx.newPage(); await probe.goto(origin + '/gateway-health');
  const browserCompression = await probe.evaluate(async path => {
    performance.clearResourceTimings();
    const response = await fetch(path); await response.json();
    const r = performance.getEntriesByType('resource').find(r => r.name.endsWith(path));
    return { encoding: response.headers.get('content-encoding'), transferSize: r.transferSize, encodedBodySize: r.encodedBodySize, decodedBodySize: r.decodedBodySize };
  }, path + '/metadata');
  assert.equal(browserCompression.encoding, 'gzip');
  assert.ok(browserCompression.encodedBodySize < browserCompression.decodedBodySize);
  checks.push({ check: 'Nginx streamed metadata compression and unchanged diagnostic frame payload', status: 'PASS',
    beforeBytes: before.body.length, afterBytes: after.body.length, ratio: before.body.length / after.body.length,
    httpStatus: after.status, contentType: after.headers['content-type'], contentEncoding: after.headers['content-encoding'],
    transferEncoding: after.headers['transfer-encoding'], frameContentType: frameAfter.headers['content-type'], frameContentEncoding: frameAfter.headers['content-encoding'] || null,
    decodedSha256: hash(before.body), pixelSha256: hash(pixelsAfter), frameBytes: pixelsAfter.length, browserCompression });
  await ctx.close(); save();

  // Verify real backend authorization and persisted administrator ON/OFF launch
  // behavior using the existing settings endpoint, including reauthentication.
  const reader = await context();
  const originalSettings = (await pool.query('select progressive_loading_enabled,updated_by_user_id,updated_at from ohif_viewer_settings where singleton_key=true')).rows[0];
  assert.equal((await reader.request.put(origin + '/api/ohif/admin/configuration', { data: { settings: { progressiveLoadingEnabled: true } } })).status(), 403);
  const adminId = Number((await pool.query("insert into users(username,full_name,password_hash,role,is_active) values($1,'SYNTHETIC OHIF ADMIN','disabled','supervisor',true) returning id", ['progressive.' + Date.now()])).rows[0].id);
  const admin = await browser.newContext();
  try {
    await admin.addCookies([{ name: env.cookieName, value: jwt.sign({ sub: adminId, role: 'supervisor' }, env.jwtSecret, { expiresIn: '1h' }), url: origin }]);
    assert.equal((await admin.request.get(origin + '/api/ohif/admin/configuration')).status(), 403);
    await admin.addCookies([{ name: env.reauthCookieName, value: jwt.sign({ sub: adminId, role: 'supervisor', purpose: 'supervisor-reauth' }, env.jwtSecret, { expiresIn: '5m' }), url: origin }]);
    const configuration = (await (await admin.request.get(origin + '/api/ohif/admin/configuration')).json()).configuration;
    const existing = await exchange(reader), existingPage = await reader.newPage();
    await existingPage.goto(existing.href, { waitUntil: 'domcontentloaded' }); await waitPixels(existingPage);
    for (const enabled of [true, false]) {
      const saved = await admin.request.put(origin + '/api/ohif/admin/configuration', { data: { settings: { ...configuration.settings, progressiveLoadingEnabled: enabled }, webEndpoint: configuration.webEndpoint } });
      assert.equal(saved.status(), 200, await saved.text());
      assert.equal((await saved.json()).configuration.settings.progressiveLoadingEnabled, enabled);
      const next = await exchange(reader);
      assert.equal(next.searchParams.get('risproLoadingProfile'), enabled ? 'progressive' : null);
      assert.equal(await existingPage.evaluate(() => window.config.risproProgressiveLoading), false);
      assert.equal((await reader.request.get(origin + `/ohif-native/context/${existing.searchParams.get('risproContext')}/studies/${c.study}/series/${c.study}.2/metadata`)).status(), 200);
    }
    checks.push({ check: 'Administrator-only, reauthenticated persisted ON/OFF and backend native launch URLs', status: 'PASS' });
  } catch (error) { console.error('Progressive administrator acceptance failed:', error); throw error; } finally {
    await admin.close(); await reader.close();
    await pool.query('update ohif_viewer_settings set progressive_loading_enabled=$1,updated_by_user_id=$2,updated_at=$3 where singleton_key=true', [originalSettings.progressive_loading_enabled, originalSettings.updated_by_user_id, originalSettings.updated_at]);
    await pool.query('delete from audit_log where changed_by_user_id=$1', [adminId]);
    await pool.query('delete from users where id=$1', [adminId]);
  }
  save();
  for (const network of [{ name: 'LAN', throughput: -1, latency: 0 }, { name: '2Mbps-80ms', throughput: 250000, latency: 80 }]) {
    for (const profile of ['baseline', 'progressive']) {
      const ctx = await context();
      const url = await exchange(ctx);
      if (profile === 'progressive') url.searchParams.set('risproLoadingProfile', 'progressive');
      const page = await ctx.newPage(), errors = [], failed = [], canceled = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400) failed.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      page.on('requestfailed', request => {
        const item = { path: new URL(request.url()).pathname, error: request.failure()?.errorText };
        (item.error === 'net::ERR_ABORTED' ? canceled : failed).push(item);
      });
      // The synthetic backend delays series 13 authorization by five seconds.
      // Avoid browser interception here: it disables HTTP cache measurements.
      const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: network.throughput, uploadThroughput: network.throughput, latency: network.latency });
      try {
        for (const cache of ['cold', 'warm']) {
          errors.length = failed.length = canceled.length = 0;
          if (cache === 'cold') await cdp.send('Network.clearBrowserCache');
          await page.goto(url.href, { waitUntil: 'domcontentloaded' }); await waitPixels(page);
          const first = await page.evaluate(() => ({ ...window.__nativeBench.firstPixels,
            render: window.__diagnosticRenders[0], longTasksMs: window.__nativeBench.longTasksMs,
            limits: window.config.maxNumRequests, poolLimits: window.cornerstone.imageLoadPoolManager.maxNumRequests }));
          const expectedLimits = profile === 'progressive' ? { interaction: 100, thumbnail: 1, prefetch: 1 } : { interaction: 100, thumbnail: 4, prefetch: 25 };
          assert.deepEqual(first.limits, expectedLimits);
          for (const [kind, limit] of Object.entries(expectedLimits)) assert.equal(first.poolLimits[kind], limit);
          if (profile === 'progressive') assert.ok(first.imageId.includes('/series/' + c.study + '.2/'), first.imageId);
          await page.locator('[data-cy="study-browser-thumbnail"][data-series="5"]').first().waitFor();
          const switchAt = await page.evaluate(() => performance.now());
          await page.locator('[data-cy="study-browser-thumbnail"][data-series="5"]').first().dblclick();
          const switchMs = await waitPixels(page, c.study + '.5', switchAt) - switchAt;
          await page.locator('.viewport-element canvas').first().hover();
          const scrollAt = await page.evaluate(() => performance.now());
          await page.mouse.wheel(0, 120);
          await page.waitForFunction(at => window.__nativeBench.renders.some(r => r.atMs > at), scrollAt);
          const scrollMs = await page.evaluate(at => window.__nativeBench.renders.find(r => r.atMs > at).atMs - at, scrollAt);
          await page.waitForFunction(study => window.services?.displaySetService.getActiveDisplaySets().filter(ds => ds.StudyInstanceUID === study).length === 12, c.study, { timeout: 180000 });
          const sidebarOrder = await page.locator('[data-cy="study-browser-thumbnail"]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-series'))));
          assert.deepEqual(sidebarOrder, [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
          const timing = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => /\/metadata$|\/frames\//.test(r.name)).map(r => ({ path: new URL(r.name).pathname, start: r.startTime, end: r.responseEnd, transfer: r.transferSize, decoded: r.decodedBodySize })));
          const metadata = timing.filter(r => r.path.endsWith('/metadata')), frames = timing.filter(r => r.path.includes('/frames/'));
          assert.equal(metadata.length, 12);
          if (profile === 'progressive') {
            const firstRender = first.render?.atMs || first.atMs;
            assert.equal(metadata.filter(r => r.start < firstRender).length, 1);
            assert.ok(firstRender < metadata.find(r => r.path.includes('.13/metadata')).end);
            assert.ok(switchAt < metadata.find(r => r.path.includes('.13/metadata')).end);
          } else assert.ok(Math.max(...metadata.map(r => r.end)) < frames[0].start);
          await page.screenshot({ path: join(temp, `progressive-${profile}-${network.name}-${cache}.png`) });
          assert.deepEqual(errors, []); assert.deepEqual(failed, []);
          results.push({ network: network.name, profile, cache, firstMetadataMs: metadata[0].start,
            initialMetadataEndMs: metadata[0].end, firstFrameRequestMs: frames[0].start, firstFrameCompleteMs: frames[0].end,
            firstPixelsMs: first.atMs, firstRenderMs: first.render?.atMs, limits: first.limits,
            metadataBytesBeforeFirstImage: metadata.filter(r => r.end <= (first.render?.atMs || first.atMs)).reduce((n, r) => n + r.transfer, 0),
            metadataRequests: metadata, sidebarOrder, switchMs, scrollMs, longTasksBeforePixelsMs: first.longTasksMs, failedRequests: [...failed], canceledRequests: [...canceled], errors: [...errors] });
          console.log(JSON.stringify({ progressiveResult: results.at(-1) })); save();
        }
      } finally { await ctx.close(); }
    }
  }
  const transport = await (await fetch(h.backendOrigin + '/__benchmark/metrics')).json();
  assert.equal(transport.proxyFrames, 0);
  checks.push({ check: 'Native diagnostic frames never traversed Express', status: 'PASS', proxyFrames: transport.proxyFrames }); save();
  // Explicit series/SOP selection, descriptions absent, and failed preferred
  // metadata all exercise the same real viewport initialization path.
  for (const scenario of ['explicit', 'sop-only', 'no-descriptions', 'metadata-failure', 'frame-failure', 'proxy', 'current', 'upstream']) {
    const ctx = await context(), page = await ctx.newPage(), url = await exchange(ctx);
    url.searchParams.set('risproLoadingProfile', ['current', 'upstream'].includes(scenario) ? scenario : 'progressive');
    if (scenario === 'proxy') url.searchParams.set('risproDelivery', 'proxy');
    if (scenario === 'explicit') {
      url.searchParams.set('initialSeriesInstanceUID', c.study + '.5');
      url.searchParams.set('initialSOPInstanceUID', c.study + '.5.3');
    }
    if (scenario === 'sop-only') url.searchParams.set('initialSOPInstanceUID', c.study + '.5.3');
    if (scenario === 'no-descriptions') await page.route('**/series?*', async route => {
      const response = await route.fetch(), body = await response.json();
      for (const s of body) delete s['0008103E'];
      await route.fulfill({ response, json: body });
    });
    if (scenario === 'metadata-failure') await page.route(`**/series/${c.study}.2/metadata`, route => route.fulfill({ status: 503, body: 'synthetic unavailable series' }));
    if (scenario === 'frame-failure') await page.route(`**/series/${c.study}.2/instances/**/frames/*`, route => route.fulfill({ status: 503, body: 'synthetic unavailable frame' }));
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' }); await waitPixels(page);
      const first = await page.evaluate(() => window.__nativeBench.firstPixels);
      if (['explicit', 'sop-only'].includes(scenario)) assert.ok(first.imageId.includes('/series/' + c.study + '.5/'));
      if (scenario.includes('failure')) assert.ok(!first.imageId.includes('/series/' + c.study + '.2/'));
      if (scenario === 'no-descriptions') assert.ok(!first.imageId.includes('/series/' + c.study + '.1/'));
      const actual = await page.evaluate(() => ({ progressive: window.config.risproProgressiveLoading, limits: window.config.maxNumRequests }));
      if (scenario === 'proxy') { assert.equal(actual.progressive, false); assert.deepEqual(actual.limits, { interaction: 4, thumbnail: 1, prefetch: 1 }); }
      if (scenario === 'current') assert.deepEqual(actual.limits, { interaction: 4, thumbnail: 4, prefetch: 1 });
      if (scenario === 'upstream') assert.deepEqual(actual.limits, { interaction: 100, thumbnail: 75, prefetch: 25 });
      checks.push({ check: scenario, status: 'PASS', first, actual }); save();
    } finally { await ctx.close(); }
  }
  // CT MPR and enhanced multiframe remain on the existing commands/viewport path.
  for (const item of cases) {
    const ctx = await context(), url = await exchange(ctx, item), page = await ctx.newPage();
    url.searchParams.set('risproLoadingProfile', 'progressive');
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded' }); await waitPixels(page);
      if (item.modality === 'CT') {
        const signed = await page.evaluate(() => {
          const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
          const image = v.getCornerstoneImage();
          return { pixel: image.getPixelData()[0], scaled: image.preScale?.scaled === true,
            rescale: image.preScale?.scalingParameters, voi: v.getProperties().voiRange };
        });
        assert.equal(signed.pixel, signed.scaled ? -2024 : -1000);
        checks.push({ check: 'Signed CT pixel and rescale survive native progressive delivery', status: 'PASS', signed }); save();
        await page.evaluate(() => window.commandsManager.runCommand('setHangingProtocol', { protocolId: 'mpr' }));
        await page.waitForFunction(() => {
          const s = window.services;
          const viewports = [...s.viewportGridService.getState().viewports.keys()].map(id => s.cornerstoneViewportService.getCornerstoneViewport(id));
          return viewports.length === 3 && viewports.every(v => {
            if (v?.type !== 'orthographic' || v.viewportStatus !== 'rendered' || !window.cornerstone.cache.getVolume(v.getVolumeId())?.loadStatus.loaded) return false;
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
            const context = canvas.getContext('2d'); context.drawImage(v.canvas, 0, 0, 64, 64);
            const data = context.getImageData(0, 0, 64, 64).data;
            let low = 255, high = 0; for (let i = 0; i < data.length; i += 16) { low = Math.min(low, data[i]); high = Math.max(high, data[i]); }
            return high - low > 20;
          });
        }, null, { timeout: 90000 });
      } else {
        await page.waitForFunction(study => window.services.displaySetService.getActiveDisplaySets().some(ds => ds.SeriesInstanceUID === study + '.4'), item.study);
        await page.locator('[data-cy="study-browser-thumbnail"][data-series="4"]').first().dblclick();
        await waitPixels(page, item.study + '.4');
      }
      await page.screenshot({ path: join(temp, 'progressive-regression-' + item.modality + '.png') });
      checks.push({ check: item.modality === 'CT' ? 'CT MPR' : 'MR enhanced multiframe', status: 'PASS' }); save();
    } finally { await ctx.close(); }
  }
}
