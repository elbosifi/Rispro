import { cache, getRenderingEngine, getConfiguration, eventTarget, triggerEvent, Enums } from '@cornerstonejs/core';
import { getImageRequestDiagnostics } from './image-recovery';

// A canvas readback is evidence of pixels, unlike IMAGE_RENDERED/viewportStatus.
// Only a boolean is retained; no pixel data leave this function.
export function hasDiagnosticPixels(viewport) {
  try {
    if (!viewport?.canvas?.width || !viewport.canvas.height) return false;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(viewport.canvas, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data;
    let low = 255, high = 0;
    for (let i = 0; i < pixels.length; i += 4) { low = Math.min(low, pixels[i]); high = Math.max(high, pixels[i]); }
    return high - low > 5;
  } catch { return false; }
}

export function createRenderingRecovery(servicesManager, target = document) {
  const services = servicesManager.services, listeners = new Set(), diagnostics = [];
  let state = null, episode, timer, running, stopped = false, lastAttempt = -Infinity, recoveryAttempts = 0;
  const publish = value => { state = value; listeners.forEach(fn => fn()); };
  const valid = viewport => viewport.element.isConnected && viewport.element.clientWidth >= 2 && viewport.element.clientHeight >= 2;
  const scrubStack = error => String(error?.stack || '').split('\n').map((line, index) => index ? line.replace(/https?:\/\/[^\s)]+/g, '[url]').replace(/\b\d+(?:\.\d+){3,}\b/g, '[uid]') : `${error?.name || 'Error'}: [redacted]`).join('\n').slice(0, 4000);
  const record = (code, engine, detail = {}) => {
    const volumes = cache.getVolumes();
    const contexts = engine?.contextPool?.getAllContexts?.() || [];
    const activeViewportId = services.viewportGridService.getActiveViewportId?.();
    const activeViewport = activeViewportId && engine?.getViewport?.(activeViewportId);
    const error = detail.error;
    diagnostics.push({ code, ms: Math.round(performance.now()), cpu: getConfiguration().rendering.useCPURendering,
      engineCPU: engine?.useCPURendering, destroyed: !!engine?.hasBeenDestroyed,
      shaderStage: detail.shaderStage, shaderLog: detail.shaderLog, contextLost: detail.contextLost,
      originalCode: detail.originalCode, duringRecovery: detail.duringRecovery,
      recoveryAttempt: detail.recoveryAttempt ?? episode?.attempts,
      originalException: error ? { name: error.name || 'Error', stack: scrubStack(error) } : undefined,
      unhandled: detail.unhandled || undefined,
      activeViewportId: detail.viewportId || activeViewportId,
      selectionGeneration: detail.selectionGeneration ?? activeViewport?._risproSelectionGeneration,
      contexts: engine?.contextPool?.getContextCount(), lostContexts: contexts.filter(context => {
        try { return !!context.getOpenGLRenderWindow().get3DContext()?.isContextLost?.(); } catch { return true; }
      }).length,
      pendingImageRequests: getImageRequestDiagnostics(), cacheBytes: cache.getCacheSize(),
      actorResources: { ...globalThis.risproRenderingResources },
      volumes: volumes.map(v => ({ dimensions: [...v.dimensions], frames: v.imageIds?.length, estimatedBytes: v.sizeInBytes,
        dimensionGroup: v.dimensionGroupNumber, groups: v.numDimensionGroups })),
      viewports: engine?.getViewports().map(v => ({ type: v.type, disabled: !!v.isDisabled,
        canvas: [v.canvas.width, v.canvas.height], container: [v.element.clientWidth, v.element.clientHeight],
        frames: v.getImageIds?.().length, actors: v.getActors?.().length })) });
    if (diagnostics.length > 32) diagnostics.shift();
  };
  const currentUIDs = v => services.viewportGridService.getState().viewports.get(v.id)?.displaySetInstanceUIDs || [];
  const currentSelection = v => currentUIDs(v).join('|');
  const currentGeneration = v => services.cornerstoneViewportService.getViewportInfo?.(v.id)?._risproSelectionGeneration ?? v._risproSelectionGeneration;
  const attached = v => v._risproAttachedData;
  const sameList = (a = [], b = []) => a.length === b.length && a.every((value, index) => value === b[index]);
  const ready = v => {
    const owner = v._risproSelectionOwner, data = attached(v), uids = currentUIDs(v);
    if (!owner || !data || owner.generation !== currentGeneration(v) || owner.generation !== v._risproSelectionGeneration ||
        !sameList(owner.displaySetInstanceUIDs, uids) || data.selectionGeneration !== owner.generation || !sameList(data.displaySetInstanceUIDs, uids)) return false;
    if (v.type === 'stack') {
      const ids = v.getImageIds?.() || [];
      return data.kind === 'stack' && ids.length > 0 && sameList(data.imageIds, ids) && ids.includes(v.getCurrentImageId?.());
    }
    const inputs = v._risproVolumeInputs || [], ids = inputs.map(input => input.volumeId);
    return data.kind === 'volume' && ids.length > 0 && sameList(data.volumeIds, ids) && ids.includes(v.getVolumeId?.());
  };
  const snapshots = engine => engine.getViewports().map(v => {
    const volumes = v._risproVolumeInputs;
    const safe = fn => { try { return fn?.(); } catch { return undefined; } };
    let cameraUnavailable = false;
    const capture = fn => { try { return fn?.(); } catch { cameraUnavailable = true; return undefined; } };
    return { id: v.id, type: v.type, element: v.element, defaultOptions: v.defaultOptions,
      selection: currentSelection(v), selectionGeneration: v._risproSelectionGeneration,
      displaySetInstanceUIDs: [...currentUIDs(v)], imageIds: v.type === 'stack' ? [...(v.getImageIds() || [])] : null,
      attachedData: attached(v), index: v.getCurrentImageIdIndex?.(), volumes,
      groups: volumes?.map(input => ({ volumeId: input.volumeId, group: safe(() => cache.getVolume(input.volumeId)?.dimensionGroupNumber) })),
      camera: capture(() => v.getCamera()), cameraUnavailable, properties: safe(() => v.getProperties()),
      presentation: safe(() => v.getViewPresentation?.()), reference: safe(() => v.getViewReference?.()) };
  });
  const waitForReady = async (engine, timeout = 5000) => {
    const complete = () => engine?.getViewports?.().length > 0 && engine.getViewports().every(ready);
    if (complete()) return;
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(deadline); target.removeEventListener('rispro-viewport-data-ready', changed); error ? reject(error) : resolve(); };
      const changed = () => { if (complete()) finish(); };
      const deadline = setTimeout(() => finish(new Error('Series initialization is still in progress. Retry rendering when it is ready, or reopen the study in a new tab and retain this tab for unsaved work.')), timeout);
      target.addEventListener('rispro-viewport-data-ready', changed);
      changed();
    });
  };
  const sameSource = (viewport, item) => {
    const data = attached(viewport);
    if (!ready(viewport) || viewport._risproSelectionGeneration !== item.selectionGeneration ||
        currentGeneration(viewport) !== item.selectionGeneration || currentSelection(viewport) !== item.selection) return false;
    if (item.imageIds) return data.kind === 'stack' && sameList(viewport.getImageIds?.() || [], item.imageIds) &&
      data.imageIds.includes(viewport.getCurrentImageId?.());
    return data.kind === 'volume' && sameList((viewport._risproVolumeInputs || []).map(input => input.volumeId), item.volumes.map(input => input.volumeId)) &&
      (viewport._risproVolumeInputs || []).some(input => input.volumeId === viewport.getVolumeId?.());
  };
  async function recover(stackSelection) {
    if (running || stopped || !episode) return;
    if (performance.now() - lastAttempt < 5000) { publish({ ...state, message: 'Please wait five seconds between rendering recovery attempts.', busy: false }); return; }
    lastAttempt = performance.now(); clearTimeout(timer);
    const active = episode;
    active.attempts = ++recoveryAttempts;
    running = (async () => {
      publish({ code: active.code, message: 'Recovering rendering. Loaded images and unsaved work are retained.', busy: true });
      try {
        const old = getRenderingEngine(active.engineId);
        await waitForReady(old);
        if (stopped || active !== episode) return;
        // Always take a fresh snapshot after initialization. A recovery episode
        // never keeps an incomplete A snapshot while B or C becomes selected.
        let saved = snapshots(old).map(item => stackSelection?.id === item.id
          ? { ...item, type: 'stack', imageIds: stackSelection.imageIds, index: stackSelection.index, volumes: null,
              attachedData: { kind: 'stack', selectionGeneration: item.selectionGeneration, displaySetInstanceUIDs: item.displaySetInstanceUIDs, imageIds: [...stackSelection.imageIds] },
              defaultOptions: { ...item.defaultOptions, orientation: undefined }, reference: undefined, presentation: undefined, camera: undefined,
              properties: { voiRange: item.properties?.voiRange, invert: item.properties?.invert } }
          : item);
        if (!saved.length || saved.some(item => !valid(item.element ? { element: item.element } : null))) throw new Error('Wait until the viewports are visible, then retry rendering.');
        if (saved.some(item => item.cameraUnavailable)) throw new Error('Rendering resources could not be safely restored. Reopen the study in a new tab; keep this tab for unsaved work.');
        if (saved.some(item => !item.selectionGeneration || !item.selection || item.attachedData?.selectionGeneration !== item.selectionGeneration))
          throw new Error('Series initialization is still in progress. Retry rendering when it is ready, or reopen the study in a new tab and retain this tab for unsaved work.');
        // Invalidate every stale continuation before destroying shared GPU state.
        old?.getViewports().forEach(v => { v._risproSelection = {}; v._risproDataRequest = {}; });
        const released = new Set();
        for (const item of old?.getViewports().map(v => ({ id: v.id, volumes: v._risproVolumeInputs })) || saved) for (const input of item.volumes || []) {
          if (released.has(input.volumeId)) continue;
          const volume = cache.getVolume(input.volumeId);
          const window = old?.getOffscreenMultiRenderWindow(item.id)?.getOpenGLRenderWindow();
          if (volume && window) { volume.vtkOpenGLTexture.releaseGraphicsResources(window); volume.invalidate(); }
          released.add(input.volumeId);
        }
        old?.destroy();
        // Use the existing OHIF service factory; keep decoded pixels and report state.
        const engine = services.cornerstoneViewportService.getRenderingEngine();
        engine.setViewports(saved.map(item => ({ viewportId: item.id, element: item.element, type: item.type, defaultOptions: item.defaultOptions })));
        for (const item of saved) {
          const assertCurrent = () => {
            const info = services.cornerstoneViewportService.getViewportInfo?.(item.id);
            if (stopped || active !== episode || currentSelection({ id: item.id }) !== item.selection ||
                info?._risproSelectionGeneration != null && info._risproSelectionGeneration !== item.selectionGeneration)
              throw new Error('Series selection changed. Select the intended series again.');
          };
          assertCurrent();
          const v = engine.getViewport(item.id);
          const owner = { generation: item.selectionGeneration, displaySetInstanceUIDs: [...item.displaySetInstanceUIDs] };
          Object.assign(v, { _risproSelectionGeneration: owner.generation, _risproSelectionOwner: owner,
            _risproDisplaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], _risproSelection: { generation: owner.generation }, _risproAttachedData: null });
          if (item.imageIds) {
            await v.setStack(item.imageIds, item.index);
            assertCurrent();
            v._risproAttachedData = { kind: 'stack', selectionGeneration: owner.generation, displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], imageIds: [...item.imageIds] };
          } else {
            await v.setVolumes(item.volumes);
            assertCurrent();
            v._risproVolumeInputs = item.volumes;
            v._risproAttachedData = { kind: 'volume', selectionGeneration: owner.generation, displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], volumeIds: item.volumes.map(input => input.volumeId) };
          }
          for (const { volumeId, group } of item.groups || []) {
            const volume = cache.getVolume(volumeId);
            if (volume?.isDynamicVolume?.() && group) {
              volume.dimensionGroupNumber = group;
              volume.invalidateVolume(false);
              triggerEvent(eventTarget, Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED, { volumeId, dimensionGroupNumber: group,
                numDimensionGroups: volume.numDimensionGroups, imageIdGroupIndex: group - 1, numImageIdGroups: volume.numDimensionGroups, splittingTag: volume.splittingTag });
            }
          }
          assertCurrent();
          v.setProperties(item.properties); v.setViewReference?.(item.reference);
          v.setViewPresentation?.(item.presentation); if (item.camera) v.setCamera(item.camera);
        }
        engine.render();
        const until = performance.now() + 5000;
        while (!stopped && active === episode && performance.now() < until) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const live = engine.getViewports();
          if (live.length === saved.length && live.every(v => {
            const item = saved.find(candidate => candidate.id === v.id);
            return item && valid(v) && sameSource(v, item) && hasDiagnosticPixels(v);
          }) && !getRenderingEngine(active.engineId)?._risproRenderingBlocked) {
            record('recovered-pixels', getRenderingEngine(active.engineId), { recoveryAttempt: active.attempts }); episode = null; publish(null); return;
          }
        }
        throw new Error('Diagnostic pixels could not be verified from the selected series. Retry rendering or reopen the study in a new tab; keep this tab open to retain unsaved work.');
      } catch (error) {
        const message = /^(Wait until|Series initialization|Series selection changed|Diagnostic pixels)/.test(error.message || '')
          ? error.message : 'Rendering resources could not be safely restored. Reopen the study in a new tab; keep this tab for unsaved work.';
        record('recovery-failed', getRenderingEngine(active.engineId), { error, recoveryAttempt: active.attempts });
        if (!stopped) publish({ code: active.code, message, busy: false });
      }
    })().finally(() => { running = null; });
    return running;
  }
  const failed = event => {
    const detail = event.detail || {}, { engineId } = detail;
    const code = detail.contextLost ? 'context-lost' : detail.code;
    if (services.cornerstoneViewportService.renderingEngine?.id !== engineId) return;
    const engine = getRenderingEngine(engineId);
    if (!engine || stopped) return;
    if (code === 'context-restored') {
      record(code, engine);
      if (episode?.engineId === engineId && !episode.attempted) { episode.attempted = true; clearTimeout(timer); timer = setTimeout(recover, Math.max(0, 5000 - performance.now() + lastAttempt)); }
      return;
    }
    const scope = detail.scope || (detail.contextLost || code === 'context-lost' || ['context-pool-missing','rendering-mode-mismatch'].includes(code) ? 'engine' : 'viewport');
    if (episode) {
      if (scope === 'engine' && episode.scope !== 'engine') {
        episode.scope = 'engine'; episode.code = code; episode.attempted = false;
        engine._risproRenderingBlocked = true; engine._needsRender?.clear();
        record('shared-rendering-failure', engine, { ...detail, originalCode: episode.originalCode });
        if (code !== 'context-lost') { episode.attempted = true; clearTimeout(timer); timer = setTimeout(recover, Math.max(250, 5000 - performance.now() + lastAttempt)); }
      } else record('secondary-rendering-failure', engine, { ...detail, originalCode: episode.originalCode, duringRecovery: !!running });
      return;
    }
    if (scope === 'engine') { engine._risproRenderingBlocked = true; engine._needsRender?.clear(); }
    record(code, engine, detail);
    episode = { code, originalCode: code, engineId, scope, viewportId: detail.viewportId, selectionGeneration: detail.selectionGeneration, attempted: false };
    publish({ code, message: code === 'context-lost' ? 'Graphics context lost. Waiting for restoration; unsaved work is retained.'
      : 'Rendering stopped (' + code + ') in this viewport. The other viewports remain available; loaded images and unsaved work are retained.', busy: false });
    if (code !== 'context-lost') { episode.attempted = true; timer = setTimeout(recover, Math.max(250, 5000 - performance.now() + lastAttempt)); }
    else timer = setTimeout(() => { if (episode) publish({ code, message: 'The graphics context has not restored. Retry rendering or reopen the study in a new tab. Unsaved work is retained.', busy: false }); }, 8000);
  };
  target.addEventListener('rispro-rendering-failure', failed);
  const globalTarget = target.defaultView || (typeof window !== 'undefined' ? window : target);
  let firstJsException = false, firstUnhandledRejection = false;
  const firstError = event => {
    if (firstJsException) return; firstJsException = true;
    record('first-javascript-exception', getRenderingEngine(episode?.engineId), { error: event.error || event });
  };
  const firstRejection = event => {
    if (firstUnhandledRejection) return; firstUnhandledRejection = true;
    record('first-unhandled-promise-rejection', getRenderingEngine(episode?.engineId), { error: event.reason, unhandled: true });
  };
  const cancelFailed = event => record('image-cancel-failed', getRenderingEngine(episode?.engineId), {
    error: { name: event.detail?.name || 'Error', stack: event.detail?.stack }, duringRecovery: !!running,
  });
  const cacheFailed = event => record('image-cache-failed', getRenderingEngine(episode?.engineId), {
    error: { name: event.detail?.name || 'Error', stack: event.detail?.stack }, duringRecovery: !!running,
  });
  globalTarget.addEventListener?.('error', firstError);
  globalTarget.addEventListener?.('unhandledrejection', firstRejection);
  globalTarget.addEventListener?.('rispro-image-cancel-failed', cancelFailed);
  target.addEventListener('rispro-image-cache-failed', cacheFailed);
  const fallback = () => {
    try {
    const id = services.viewportGridService.getActiveViewportId();
    const row = services.viewportGridService.getState().viewports.get(id);
    const sets = row?.displaySetInstanceUIDs?.map(uid => services.displaySetService.getDisplaySetByUID(uid));
    const v = services.cornerstoneViewportService.getCornerstoneViewport(id);
    const volumeId = v?.getVolumeId?.();
    const volume = volumeId ? cache.getVolume(volumeId) : null;
    // Fail closed for dynamic/enhanced/ambiguous phase order. OHIF builds the
    // conventional stack from its original DICOM imageIds and ordering.
    if (services.viewportGridService.getState().viewports.size !== 1 || sets?.length !== 1 || !['CT','MR'].includes(sets[0]?.Modality) || sets[0].isDynamicVolume || sets[0].unsupported ||
        !sets[0].images?.length || sets[0].images.some(image => Number(image.NumberOfFrames || 1) !== 1) ||
        !volume?.imageIds?.length || volume.isDynamicVolume?.() || !v?.isInAcquisitionPlane?.()) return null;
    const index = volume.imageIds.indexOf(v.getCurrentImageId?.());
    if (index < 0) return null;
    return { id, row, imageIds: [...volume.imageIds], index };
    } catch { return null; } // Missing GPU state cannot prove a safe mapping.
  };
  return {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => state,
    retry: recover, diagnostics: () => structuredClone(diagnostics), canStack: () => !!fallback(),
    openStack: async () => {
      const selected = fallback(); if (!selected || running) return;
      await recover(selected);
      if (!episode) services.viewportGridService.setDisplaySetsForViewport({ viewportId: selected.id,
        displaySetInstanceUIDs: selected.row.displaySetInstanceUIDs,
        viewportOptions: { viewportType: 'stack', toolGroupId: 'default', initialImageOptions: { index: selected.index }, presentationIds: {} }, displaySetOptions: [{}] });
    },
    destroy() { stopped = true; clearTimeout(timer); target.removeEventListener('rispro-rendering-failure', failed);
      globalTarget.removeEventListener?.('error', firstError); globalTarget.removeEventListener?.('unhandledrejection', firstRejection);
      globalTarget.removeEventListener?.('rispro-image-cancel-failed', cancelFailed); target.removeEventListener('rispro-image-cache-failed', cacheFailed); listeners.clear(); },
  };
}
