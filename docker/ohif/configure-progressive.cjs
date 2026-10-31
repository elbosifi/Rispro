// Source patches only, for pinned OHIF v3.12.6. No replacement image loader/pool.
const fs = require('node:fs');
const path = require('node:path');

function prioritizeSeries(series, rules, search = '', metadataOf = value => value) {
  const params = new URLSearchParams(search);
  const selected = [...params].filter(([key]) => key.toLowerCase() === 'initialseriesinstanceuid')
    .flatMap(([, value]) => value.split(','));
  const rank = metadata => {
    if (selected.includes(metadata.SeriesInstanceUID)) return 1000;
    const imageType = [].concat(metadata.ImageType || []).join('\\');
    const description = String(metadata.SeriesDescription || '');
    if (/LOCALIZER|SCOUT|SURVEY|PILOT|TOPOGRAM|NON.?DIAGNOSTIC/i.test(imageType + ' ' + description)) return -100;
    if (['SR', 'SEG', 'PR', 'KO', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'PMAP'].includes(metadata.Modality)) return -200;
    // Series QIDO supplies instance counts. Optional instance attributes are
    // useful only when actually returned; classification must not require them.
    const counts = Math.max(Number(metadata.NumberOfSeriesRelatedInstances) || 0,
      Number(metadata.NumberOfFrames) || 0);
    return rules.reduce((score, rule) => {
      const value = rule.attribute === 'numImageFrames' ? counts : metadata[rule.attribute];
      const equals = rule.constraint.equals;
      const matches = equals ? [].concat(value || []).includes(equals.value)
        : Number(value) > rule.constraint.greaterThan.value;
      return score + (matches ? rule.weight : 0);
    }, 0) + Math.min(counts, 32) / 32;
  };
  // Stable ties preserve OHIF's existing date/number/custom sorting.
  return [...series].sort((a, b) => rank(metadataOf(b)) - rank(metadataOf(a)));
}

// Consumes OHIF DeferredPromises serially. Only metadata is bounded here;
// Cornerstone continues to own every image request and interaction priority.
async function loadProgressively({ promises, services, apply, waitForImage, isReady }) {
  let stopped = false;
  let cancelWait = () => {};
  const { displaySetService, cornerstoneViewportService, viewportGridService, uiNotificationService } = services;
  const viewport = () => cornerstoneViewportService.getCornerstoneViewport(viewportGridService.getActiveViewportId());
  const run = async () => {
    let rendered = false;
    for (const promise of promises) {
      if (stopped) return;
      try {
        await promise.start();
        if (stopped) return;
        const uid = promise.metadata.SeriesInstanceUID;
        const sets = displaySetService.getActiveDisplaySets().filter(ds => ds.SeriesInstanceUID === uid);
        if (!sets.some(ds => !ds.unsupported && ds.numImageFrames > 0 &&
            !['SR', 'SEG', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'PMAP'].includes(ds.Modality))) continue;
        const waiting = waitForImage(viewport, uid);
        cancelWait = waiting.cancel;
        apply(uid);
        rendered = await waiting.promise;
        cancelWait();
        if (rendered || stopped) break;
      } catch (error) {
        cancelWait();
        console.warn('Initial OHIF series unavailable; trying the next series', error);
      }
    }
    if (stopped) return;
    if (!rendered) {
      // All candidates failed: expose upstream document fallback and an explicit
      // error, rather than a permanent loading overlay.
      apply();
      document.dispatchEvent(new Event('rispro-initial-image-failed'));
      uiNotificationService.show({ title: 'Diagnostic image unavailable', message: 'Unable to render a diagnostic series. Select another series or retry.', type: 'error' });
    }
    // Start at most one background series. A newly selected viewport must render
    // before another background download starts. Already-started requests are
    // left intact, preserving upstream caching and explicit series selection.
    for (const promise of promises) {
      if (stopped) return;
      if (promise.internalPromise) continue;
      if (rendered && !isReady(viewport())) {
        const waiting = waitForImage(viewport);
        cancelWait = waiting.cancel;
        await waiting.promise;
        cancelWait();
      }
      if (stopped) return;
      try { await promise.start(); } catch (error) { console.warn('Background OHIF metadata unavailable', error); }
    }
  };
  // The route can unmount while metadata or pixels are pending.
  void run().catch(error => console.error('Progressive OHIF initialization failed', error));
  return () => { stopped = true; cancelWait(); };
}

function waitForDiagnosticImage(getViewport, seriesUID, core, ready, target = document, timeoutMs = 120000) {
  let finish;
  let settled = false;
  const promise = new Promise(resolve => { finish = resolve; });
  const events = core.Enums.Events;
  const matches = v => !seriesUID || v?.getImageIds?.().some(id => id.includes('/series/' + seriesUID + '/'));
  const complete = value => {
    if (settled) return;
    settled = true;
    cleanup();
    finish(value);
  };
  const check = () => {
    if (settled) return false;
    const v = getViewport(), rendered = matches(v) && ready(v);
    if (rendered) complete(true);
    return rendered;
  };
  const failure = event => {
    const v = getViewport(), id = event.detail?.imageId;
    if (settled || !matches(v) || !id) return;
    if (v?.type === core.Enums.ViewportType?.STACK) {
      const selected = v.getCurrentImageId?.();
      const requestType = event.detail?.requestType;
      if (id !== selected || (seriesUID && !selected.includes('/series/' + seriesUID + '/')) ||
          (requestType && [core.Enums.RequestType?.Thumbnail, core.Enums.RequestType?.Prefetch].includes(requestType))) return;
      if (ready(v)) { complete(true); return; }
    } else if (!v?.getImageIds?.().includes(id)) return;
    complete(false);
  };
  // Safety watchdog only, never the normal background scheduling trigger.
  const timer = setTimeout(() => { if (!check()) complete(false); }, timeoutMs);
  function cleanup() {
    clearTimeout(timer);
    target.removeEventListener(events.IMAGE_RENDERED, check, true);
    target.removeEventListener(events.IMAGE_LOAD_ERROR, failure, true);
    core.eventTarget.removeEventListener(events.IMAGE_LOAD_FAILED, failure);
  }
  target.addEventListener(events.IMAGE_RENDERED, check, true);
  target.addEventListener(events.IMAGE_LOAD_ERROR, failure, true);
  core.eventTarget.addEventListener(events.IMAGE_LOAD_FAILED, failure);
  // Also covers a cached image that rendered before the listeners attached.
  queueMicrotask(check);
  return { promise, cancel: () => complete(false) };
}

function configureProgressive(root, diagnosticRules, ready) {
  const replace = (file, anchor, replacement) => {
    const filename = path.join(root, file);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    if (source.split(anchor).length !== 2) throw Error('Pinned OHIF progressive anchor changed: ' + file);
    fs.writeFileSync(filename, source.replace(anchor, replacement));
  };
  const hp = 'extensions/default/src/getHangingProtocolModule.js';
  replace(hp, "  id: 'default',", "  id: 'default',\n  ...(window.config?.risproProgressiveLoading ? { hpInitiationCriteria: { minSeriesLoaded: 1 } } : {}),");
  const loader = 'extensions/default/src/DicomWebDataSource/wado/retrieveMetadataLoaderAsync.js';
  replace(loader, 'export class DeferredPromise {', `${prioritizeSeries.toString()}\nconst risproDiagnosticRules = ${JSON.stringify(diagnosticRules)};\n\nexport class DeferredPromise {`);
  replace(loader, '    this.internalPromise = this.processFunction();', `    this.internalPromise = this.processFunction();
    if (window.config?.risproProgressiveLoading && this.thenFunction) {
      this.internalPromise = this.internalPromise.then(this.thenFunction);
      this.thenFunction = undefined;
    }`);
  replace(loader, "const includeField = ['00080021', '00080031', '0008103E', '00200011'].join(',');",
    "const includeField = ['00080021', '00080031', '0008103E', '00200011', ...(window.config?.risproProgressiveLoading ? ['00080060', '00201209'] : [])].join(',');");
  replace(loader, 'const seriesInstanceUIDs = preLoadData.map(seriesMetadata => {',
    'const retrievalOrder = window.config?.risproProgressiveLoading\n      ? prioritizeSeries(preLoadData, risproDiagnosticRules, window.location.search) : preLoadData;\n    const seriesInstanceUIDs = retrievalOrder.map(seriesMetadata => {');
  const route = 'platform/app/src/routes/Mode/defaultRouteInit.ts';
  replace(route, "import getStudies from './studiesList';", "import getStudies from './studiesList';\nimport { loadProgressively, waitForImage, isReady, prioritizePromises } from './risproProgressive';");
  replace(route, 'function applyHangingProtocol() {\n    const displaySets = displaySetService.getActiveDisplaySets();',
    "function applyHangingProtocol(progressiveSeriesUID = undefined) {\n    const displaySets = displaySetService.getActiveDisplaySets().filter(ds =>\n      typeof progressiveSeriesUID !== 'string' || ds.SeriesInstanceUID === progressiveSeriesUID);");
  replace(route, '  await Promise.allSettled(allRetrieves).then(async promises => {', `  const discovered = await Promise.allSettled(allRetrieves);
  const protocolId = Array.isArray(hangingProtocolId) ? hangingProtocolId[0] : hangingProtocolId;
  // SOP-only selection needs upstream all-series matching: QIDO cannot identify
  // its containing series. Explicit series+SOP still uses the fast path.
  if (window.config?.risproProgressiveLoading && protocolId === 'default' &&
      (!initialSOPInstanceUID || initialSeriesInstanceUID)) {
    const series = prioritizePromises(discovered.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []));
    unsubscriptions.push(await loadProgressively({ promises: series, services: servicesManager.services,
      apply: applyHangingProtocol, waitForImage, isReady }));
    return unsubscriptions;
  }
  await Promise.resolve(discovered).then(async promises => {`);
  fs.writeFileSync(path.join(root, 'platform/app/src/routes/Mode/risproProgressive.js'),
    "import * as core from '@cornerstonejs/core';\n" + ready.toString() + '\n' +
    prioritizeSeries.toString() + '\n' + `const risproDiagnosticRules = ${JSON.stringify(diagnosticRules)};\n` +
    loadProgressively.toString() + '\n' + waitForDiagnosticImage.toString() + `
export const isReady = viewport => isDiagnosticReady(viewport, core.Enums.ViewportStatus.RENDERED);
export const waitForImage = (getViewport, uid) => waitForDiagnosticImage(getViewport, uid, core, isReady);
export const prioritizePromises = promises => prioritizeSeries(promises, risproDiagnosticRules, window.location.search, promise => promise.metadata);
export { loadProgressively };
`);
}

module.exports = { configureProgressive, prioritizeSeries, loadProgressively, waitForDiagnosticImage };
