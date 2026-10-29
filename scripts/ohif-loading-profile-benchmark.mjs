// Synthetic-only extension of the existing authenticated native benchmark.
// Observe the real cache/pools; never load or prefetch an image from this probe.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installProbe, waitPixels } from './ohif-native-benchmark.mjs';

export const networks = [
  { name: 'loopback', mbps: null, latencyMs: 0 },
  { name: '2mbps-80ms', mbps: 2, latencyMs: 80 },
  { name: '5mbps-40ms', mbps: 5, latencyMs: 40 },
];

function observeCache() {
  window.__loadingCache = [];
  setInterval(() => {
    const s = window.services, cs = window.cornerstone;
    const v = s?.cornerstoneViewportService?.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
    const ids = v?.getImageIds?.();
    if (!ids?.length || !cs?.cache) return;
    const loaded = ids.filter(id => cs.cache.isLoaded(id) && cs.cache.getImage(id)).length;
    window.__loadingCache.push({ atMs: performance.now(), series: /\/series\/([^/]+)/.exec(ids[0])?.[1],
      loaded, total: ids.length, proportion: loaded / ids.length,
      imageId: v.getCurrentImageId?.(), targetIndex: v.getTargetImageIdIndex?.(),
      renderedIndex: v.getCurrentImageIdIndex?.(), cacheBytes: cs.cache.getCacheSize() });
  }, 500);
}

export function requestKind(url) {
  const path = new URL(url).pathname;
  return /\/frames\//.test(path) ? 'frame' : /\/rendered$/.test(path) ? 'thumbnail'
    : /\/metadata$/.test(path) ? 'metadata' : /\/studies/.test(path) ? 'qido' : 'asset';
}

export function summarizeRequests(requests) {
  const frames = requests.filter(r => r.kind === 'frame');
  return { requested: frames.length, completed: frames.filter(r => r.outcome === 'completed').length,
    failed: frames.filter(r => r.outcome === 'failed').length,
    canceled: frames.filter(r => r.outcome === 'canceled').length,
    pendingAtEnd: frames.filter(r => r.outcome === 'pending').length,
    imageBytes: frames.reduce((n, r) => n + r.bodyBytes, 0) };
}

function observeNetwork(cdp, clock) {
  const requests = [], active = new Map();
  let peakFrames = 0, peakImages = 0;
  cdp.on('Network.requestWillBeSent', e => {
    if (!e.request.url.startsWith('http')) return;
    const item = { id: e.requestId, kind: requestKind(e.request.url), path: new URL(e.request.url).pathname,
      phase: clock.phase, atMs: e.timestamp * 1000, outcome: 'pending', bodyBytes: 0,
      frameConcurrency: 0, series: /\/series\/([^/]+)/.exec(e.request.url)?.[1] };
    requests.push(item); active.set(e.requestId, item);
    const frames = [...active.values()].filter(r => r.kind === 'frame').length;
    const images = [...active.values()].filter(r => ['frame', 'thumbnail'].includes(r.kind)).length;
    item.frameConcurrency = frames; peakFrames = Math.max(peakFrames, frames); peakImages = Math.max(peakImages, images);
  });
  cdp.on('Network.responseReceived', e => {
    const r = active.get(e.requestId); if (!r) return;
    r.status = e.response.status; r.protocol = e.response.protocol; r.fromDiskCache = !!e.response.fromDiskCache;
    r.responseAtMs = e.timestamp * 1000;
    const t = e.response.timing;
    if (t) {
      r.ttfbMs = t.receiveHeadersEnd - t.sendStart;
      r.browserQueueMs = Math.max(0, t.sendStart - Math.max(t.proxyEnd, t.dnsEnd, t.connectEnd, t.sslEnd, 0));
    }
  });
  cdp.on('Network.dataReceived', e => {
    const r = active.get(e.requestId); if (r) { r.bodyBytes += e.dataLength; r.lastDataAtMs = e.timestamp * 1000; }
  });
  const finish = (e, outcome) => {
    const r = active.get(e.requestId); if (!r) return;
    r.outcome = r.status >= 400 ? 'failed' : outcome; r.error = e.errorText;
    r.endMs = e.timestamp * 1000; r.elapsedMs = r.endMs - r.atMs;
    r.downloadMs = Math.max(0, (r.lastDataAtMs || r.endMs) - (r.responseAtMs || r.endMs));
    r.transferredBytes = e.encodedDataLength;
    active.delete(e.requestId);
  };
  cdp.on('Network.loadingFinished', e => finish(e, 'completed'));
  cdp.on('Network.loadingFailed', e => finish(e, e.canceled ? 'canceled' : 'failed'));
  return { requests, peaks: () => ({ peakFrames, peakImages }) };
}

async function scroll(page) {
  const results = [];
  // A real wheel event, followed by two commanded jumps into verified cache gaps.
  // setImageIdIndex is Cornerstone's existing interaction path, not a downloader.
  for (const action of ['wheel', 'near', 'distant']) {
    const before = await page.evaluate(action => {
      const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const ids = v.getImageIds(), current = v.getCurrentImageIdIndex();
      const target = action === 'wheel' ? Math.min(ids.length - 1, current + 1)
        : action === 'near' ? ids.findIndex((id, i) => i > current + 1 && !window.cornerstone.cache.isLoaded(id))
        : ids.findLastIndex(id => !window.cornerstone.cache.isLoaded(id));
      return { atMs: performance.now(), current, target, cached: target >= 0 && window.cornerstone.cache.isLoaded(ids[target]),
        series: /\/series\/([^/]+)/.exec(ids[0])[1], rect: v.element.getBoundingClientRect().toJSON() };
    }, action);
    if (before.target < 0 || before.target === before.current) { results.push({ action, skipped: 'no cache gap', ...before }); continue; }
    if (action === 'wheel') {
      await page.mouse.move(before.rect.x + before.rect.width / 2, before.rect.y + before.rect.height / 2);
      await page.mouse.wheel(0, 120);
    } else await page.evaluate(index => {
      const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      void v.setImageIdIndex(index);
    }, before.target);
    try {
      await page.waitForFunction(({ target, atMs }) => {
        const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
        return v.getCurrentImageIdIndex() === target && v.viewportStatus === 'rendered' &&
          window.__nativeBench.renders.some(r => r.atMs >= atMs && r.imageId === v.getCurrentImageId());
      }, before, { timeout: 90000 });
      const renderedAt = await page.evaluate(({ atMs }) => window.__nativeBench.renders.find(r => r.atMs >= atMs)?.atMs, before);
      results.push({ action, ...before, waitMs: renderedAt - before.atMs });
    } catch { results.push({ action, ...before, timedOutMs: 90000 }); }
  }
  return results;
}

export async function runLoadingProfileBenchmark(h) {
  const { browser, cases, origin, archive, exchange, login, env, temp, backendOrigin } = h;
  const variants = [
    { name: 'stock', stock: true }, { name: 'current', profile: 'current', limits: [4, 4, 1] },
    { name: 'upstream', profile: 'upstream', limits: [100, 75, 25] },
    { name: 'upstream-t4', profile: 'upstream', thumbnails: 'current', limits: [100, 4, 25] },
  ].filter(v => !process.env.OHIF_LOADING_VARIANTS || process.env.OHIF_LOADING_VARIANTS.split(',').includes(v.name));
  const conditions = networks.filter(n => !process.env.OHIF_LOADING_NETWORKS || process.env.OHIF_LOADING_NETWORKS.split(',').includes(n.name));
  const studyCases = cases.filter(c => c.modality === 'MR' || c.label === 'CT-large');
  const repeats = Number(process.env.OHIF_BENCH_REPEATS || 3), results = [];
  const save = event => {
    writeFileSync(join(temp, 'loading-profile-results.json'), JSON.stringify({ syntheticOnly: true,
      conditions, repeats, cache: 'Fresh context + cleared HTTP cache for cold; same-context normal reload for warm; no routes',
      network: 'Chromium CDP emulation, Mbps decimal, symmetric upload/download; HTTP/1.1 Docker loopback; no packet loss',
      results }, null, 2));
    console.log(JSON.stringify(event));
  };
  for (const network of conditions) for (let repeat = 0; repeat < repeats; repeat++) for (const c of studyCases) {
    const ordered = [...variants.slice(repeat % variants.length), ...variants.slice(0, repeat % variants.length)];
    for (const variant of ordered) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 },
        ...(variant.stock ? { extraHTTPHeaders: { Authorization: 'Basic ' + Buffer.from('synthetic:synthetic-only').toString('base64') } } : {}) });
      if (!variant.stock) await context.addCookies([{ name: env.cookieName, value: login, url: origin }]);
      try {
        const location = variant.stock ? '/ohif/viewer?StudyInstanceUIDs=' + c.study : await exchange(c, context);
        const url = new URL(location, variant.stock ? archive : origin);
        if (!variant.stock) {
          url.searchParams.set('risproDelivery', 'native'); url.searchParams.set('risproLoadingProfile', variant.profile);
          if (variant.thumbnails) url.searchParams.set('risproThumbnailProfile', variant.thumbnails);
        }
        await context.addInitScript(count => { window.__nativeExpectedThumbnails = count; }, c.expectedSeries);
        await context.addInitScript(installProbe); await context.addInitScript(observeCache);
        const page = await context.newPage(), cdp = await context.newCDPSession(page), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await cdp.send('Network.enable'); await cdp.send('Network.clearBrowserCache');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
        if (network.mbps) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: network.latencyMs,
          downloadThroughput: network.mbps * 1e6 / 8, uploadThroughput: network.mbps * 1e6 / 8 });
        const clock = { phase: 'cold' }, monitor = observeNetwork(cdp, clock);
        for (const cache of ['cold', 'warm']) {
          save({ loadingStart: { network: network.name, repeat, case: c.label || c.modality, variant: variant.name, cache } });
          clock.phase = cache;
          const requestStart = monitor.requests.length, archiveCpuStart = h.archiveCpuMs();
          await fetch(backendOrigin + '/__benchmark/metrics?reset=1');
          if (cache === 'cold') await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 180000 });
          else await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
          await waitPixels(page);
          const first = await page.evaluate(() => window.__nativeBench.firstPixels);
          assert.equal(first.decodedPixels, first.rows * first.columns);
          assert.ok(first.imageId.includes('/studies/' + c.study + '/'));
          const limits = await page.evaluate(() => window.cornerstone.imageLoadPoolManager.maxNumRequests);
          if (variant.limits) assert.deepEqual(['interaction', 'thumbnail', 'prefetch'].map(k => limits[k]), variant.limits);
          // Fixed passive observation; never wait for, or initiate, full-series downloads.
          await page.waitForTimeout(8000);
          const scrolling = await scroll(page);
          const initialSeries = /\/series\/([^/]+)/.exec(first.imageId)[1];
          const selectedSeries = c.study + '.2';
          const unloaded = await page.evaluate(series => {
            const ds = window.services.displaySetService.getActiveDisplaySets().find(ds => ds.SeriesInstanceUID === series);
            const ids = ds?.images?.map(i => i.imageId).filter(Boolean) || [];
            return { knownImageIds: ids.length, loaded: ids.filter(id => window.cornerstone.cache.isLoaded(id) && window.cornerstone.cache.getImage(id)).length };
          }, selectedSeries);
          const selectedAt = await page.evaluate(() => performance.now());
          await page.locator('[data-cy="study-browser-thumbnail"][data-series="2"]').first().dblclick();
          const selectedPixelsMs = await waitPixels(page, selectedSeries, selectedAt) - selectedAt;
          await page.waitForFunction(() => window.__nativeBench.thumbnails, null, { timeout: 120000 });
          await page.waitForTimeout(2000);
          const observed = await page.evaluate(() => ({ first: window.__nativeBench.firstPixels, thumbnails: window.__nativeBench.thumbnails,
            poolPeaks: window.__nativeBench.poolPeaks, queuePeaks: window.__nativeBench.queuePeaks, cacheTimeline: window.__loadingCache,
            longTasksMs: window.__nativeBench.longTasksMs, domContentLoadedMs: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd }));
          const backend = await (await fetch(backendOrigin + '/__benchmark/metrics')).json();
          backend.orthancCpuMs = h.archiveCpuMs() - archiveCpuStart;
          if (!variant.stock) assert.equal(backend.proxyFrames, 0, 'Native frames bypass Express');
          const requests = monitor.requests.slice(requestStart).map(r => ({ ...r }));
          const frameCounts = summarizeRequests(requests);
          const firstNetwork = requests.find(r => r.kind === 'asset');
          const initialComplete = observed.cacheTimeline.find(s => s.series === initialSeries && s.loaded === s.total);
          const otherSeriesWhileInitialLoading = requests.filter(r => r.kind === 'frame' && r.series !== initialSeries &&
            r.atMs - firstNetwork.atMs < Math.min(selectedAt, initialComplete?.atMs ?? selectedAt));
          assert.deepEqual(errors, [], 'No viewer runtime errors');
          assert.equal(frameCounts.failed, 0, 'No failed diagnostic frame requests');
          const result = { network: network.name, repeat, case: c.label || c.modality, variant: variant.name, cache,
            firstPixelsMs: first.atMs, selectedPixelsMs, unloadedAtSwitch: unloaded, initialSeries,
            initialFullCacheAtMs: initialComplete?.atMs ?? null, scrolling, effectiveLimits: limits,
            ...observed, ...monitor.peaks(), frameCounts, otherSeriesWhileInitialLoading: otherSeriesWhileInitialLoading.length,
            backend, requests };
          results.push(result);
          save({ loadingResult: { network: network.name, repeat, case: result.case, variant: result.variant, cache,
            firstPixelsMs: result.firstPixelsMs, selectedPixelsMs, frameCounts, initialFullCacheAtMs: result.initialFullCacheAtMs } });
          if (repeat === 0 && cache === 'cold') await page.screenshot({ path: join(temp, `loading-${network.name}-${result.case}-${variant.name}.png`) });
        }
      } catch (error) {
        save({ loadingFailure: { network: network.name, repeat, case: c.label || c.modality, variant: variant.name, error: error.stack } });
        throw error;
      } finally { await context.close(); }
    }
  }
  save({ loadingComplete: true, runs: results.length });
}
