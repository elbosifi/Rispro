import { cache, getRenderingEngine, getConfiguration, eventTarget, triggerEvent, Enums } from '@cornerstonejs/core';

// A canvas readback is evidence of pixels, unlike IMAGE_RENDERED/viewportStatus.
// Only a boolean is retained; no pixel data leave this function.
export function hasDiagnosticPixels(viewport) {
  if (!viewport?.canvas?.width || !viewport.canvas.height) return false;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(viewport.canvas, 0, 0, 64, 64);
  const pixels = ctx.getImageData(0, 0, 64, 64).data;
  let low = 255, high = 0;
  for (let i = 0; i < pixels.length; i += 4) { low = Math.min(low, pixels[i]); high = Math.max(high, pixels[i]); }
  return high - low > 5;
}

export function createRenderingRecovery(servicesManager, target = document) {
  const services = servicesManager.services, listeners = new Set(), diagnostics = [];
  let state = null, episode, timer, running, stopped = false, lastAttempt = -Infinity;
  const publish = value => { state = value; listeners.forEach(fn => fn()); };
  const valid = viewport => viewport.element.isConnected && viewport.element.clientWidth >= 2 && viewport.element.clientHeight >= 2;
  const record = (code, engine, detail = {}) => {
    const volumes = cache.getVolumes();
    diagnostics.push({ code, ms: Math.round(performance.now()), cpu: getConfiguration().rendering.useCPURendering,
      engineCPU: engine?.useCPURendering, destroyed: !!engine?.hasBeenDestroyed,
      shaderStage: detail.shaderStage, shaderLog: detail.shaderLog, contextLost: detail.contextLost,
      contexts: engine?.contextPool?.getContextCount(), cacheBytes: cache.getCacheSize(),
      actorResources: { ...globalThis.risproRenderingResources },
      volumes: volumes.map(v => ({ dimensions: [...v.dimensions], frames: v.imageIds?.length, estimatedBytes: v.sizeInBytes,
        dimensionGroup: v.dimensionGroupNumber, groups: v.numDimensionGroups })),
      viewports: engine?.getViewports().map(v => ({ type: v.type, disabled: !!v.isDisabled,
        canvas: [v.canvas.width, v.canvas.height], container: [v.element.clientWidth, v.element.clientHeight],
        frames: v.getImageIds?.().length, actors: v.getActors?.().length })) });
    if (diagnostics.length > 32) diagnostics.shift();
  };
  const currentSelection = v => services.viewportGridService.getState().viewports.get(v.id)?.displaySetInstanceUIDs?.join('|');
  const snapshots = engine => engine.getViewports().map(v => ({ id: v.id, type: v.type, element: v.element,
    defaultOptions: v.defaultOptions, selection: currentSelection(v),
    imageIds: v.type === 'stack' ? [...v.getImageIds()] : null, index: v.getCurrentImageIdIndex?.(),
    volumes: v._risproVolumeInputs, groups: v._risproVolumeInputs?.map(input => ({ volumeId: input.volumeId, group: cache.getVolume(input.volumeId)?.dimensionGroupNumber })),
    camera: v.getCamera(), properties: v.getProperties(),
    presentation: v.getViewPresentation?.(), reference: v.getViewReference?.() }));
  async function recover(stackSelection) {
    if (running || stopped || !episode) return;
    if (performance.now() - lastAttempt < 5000) { publish({ ...state, message: 'Please wait five seconds between rendering recovery attempts.', busy: false }); return; }
    lastAttempt = performance.now(); clearTimeout(timer);
    const active = episode;
    running = (async () => {
      publish({ code: active.code, message: 'Recovering rendering. Loaded images and unsaved work are retained.', busy: true });
      try {
        const old = getRenderingEngine(active.engineId);
        const saved = (active.saved || snapshots(old)).map(item => stackSelection?.id === item.id
          ? { ...item, type: 'stack', imageIds: stackSelection.imageIds, index: stackSelection.index, volumes: null,
              defaultOptions: { ...item.defaultOptions, orientation: undefined }, reference: undefined, presentation: undefined, camera: undefined, properties: { voiRange: item.properties.voiRange, invert: item.properties.invert } }
          : item);
        active.saved = saved;
        if (!saved.length || saved.some(v => !valid(v))) throw new Error('Wait until the viewports are visible, then retry rendering.');
        if (saved.some(v => v.imageIds ? !v.imageIds.length : !v.volumes?.length))
          throw new Error('Series initialization did not complete safely. Reopen the study in a new tab and retain this tab for unsaved work.');
        // Invalidate every stale continuation before destroying shared GPU state.
        old?.getViewports().forEach(v => { v._risproSelection = {}; v._risproDataRequest = {}; });
        const released = new Set();
        for (const item of old?.getViewports().map(v => ({ id: v.id, volumes: v._risproVolumeInputs })) || saved) for (const input of item.volumes || []) {
          if (released.has(input.volumeId)) continue;
          const volume = cache.getVolume(input.volumeId);
          // VTK 34.15.1 does not clear a texture handle when called without its
          // render window. Release it while the old window still exists, then
          // re-upload decoded frames into the new context; keep the cache.
          const window = old?.getOffscreenMultiRenderWindow(item.id)?.getOpenGLRenderWindow();
          if (volume && window) { volume.vtkOpenGLTexture.releaseGraphicsResources(window); volume.invalidate(); }
          released.add(input.volumeId);
        }
        old?.destroy();
        // Use the existing OHIF service factory. Do not call service.destroy(),
        // which purges the decoded image cache and other clinical state.
        const engine = services.cornerstoneViewportService.getRenderingEngine();
        engine.setViewports(saved.map(v => ({ viewportId: v.id, element: v.element, type: v.type, defaultOptions: v.defaultOptions })));
        for (const item of saved) {
          if (stopped || active !== episode || currentSelection(item) !== item.selection) throw new Error('Series selection changed. Select the intended series again.');
          const v = engine.getViewport(item.id);
          if (item.imageIds) await v.setStack(item.imageIds, item.index);
          else await v.setVolumes(item.volumes);
          for (const { volumeId, group } of item.groups || []) {
            const volume = cache.getVolume(volumeId);
            if (volume?.isDynamicVolume?.() && group) {
              volume.dimensionGroupNumber = group;
              volume.invalidateVolume(false);
              triggerEvent(eventTarget, Enums.Events.DYNAMIC_VOLUME_DIMENSION_GROUP_CHANGED, { volumeId, dimensionGroupNumber: group,
                numDimensionGroups: volume.numDimensionGroups, imageIdGroupIndex: group - 1, numImageIdGroups: volume.numDimensionGroups, splittingTag: volume.splittingTag });
            }
          }
          if (stopped || active !== episode || currentSelection(item) !== item.selection) throw new Error('Series selection changed. Select the intended series again.');
          v.setProperties(item.properties); v.setViewReference?.(item.reference);
          v.setViewPresentation?.(item.presentation); if (item.camera) v.setCamera(item.camera);
        }
        engine.render();
        // A bounded wait checks real pixels on every affected viewport. A flat
        // image can fail this conservative test; never report it as recovered.
        const until = performance.now() + 5000;
        while (!stopped && active === episode && performance.now() < until) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const live = engine.getViewports();
          if (live.length === saved.length && live.every(v => valid(v) && saved.some(item => item.id === v.id && currentSelection(v) === item.selection) && hasDiagnosticPixels(v)) && !getRenderingEngine(active.engineId)?._risproRenderingBlocked) {
            record('recovered-pixels', getRenderingEngine(active.engineId)); episode = null; publish(null); return;
          }
        }
        throw new Error('Diagnostic pixels could not be verified. The browser GPU may require a new viewer tab. Keep this tab open to retain unsaved work.');
      } catch (error) {
        const message = /^(Wait until|Series initialization|Series selection changed|Diagnostic pixels)/.test(error.message || '')
          ? error.message : 'Rendering resources could not be safely restored. Reopen the study in a new tab; keep this tab for unsaved work.';
        if (!stopped) publish({ code: active.code, message, busy: false });
      }
    })().finally(() => { running = null; });
    return running;
  }
  const failed = event => {
    const { engineId } = event.detail || {};
    const code = event.detail?.contextLost ? 'context-lost' : event.detail?.code;
    if (services.cornerstoneViewportService.renderingEngine?.id !== engineId) return;
    const engine = getRenderingEngine(engineId);
    if (!engine || stopped) return;
    if (code === 'context-restored') {
      record(code, engine);
      if (episode?.engineId === engineId && !episode.attempted) { episode.attempted = true; clearTimeout(timer); timer = setTimeout(recover, Math.max(0, 5000 - performance.now() + lastAttempt)); }
      return;
    }
    if (episode) return; // one episode for the shared pool, no per-viewport loops
    engine._risproRenderingBlocked = true;
    engine._needsRender?.clear();
    record(code, engine, event.detail); episode = { code, engineId, attempted: false };
    publish({ code, message: code === 'context-lost' ? 'Graphics context lost. Waiting for restoration; unsaved work is retained.' : 'Rendering stopped (' + code + '). Loaded images and unsaved work are retained.', busy: false });
    if (code !== 'context-lost') { episode.attempted = true; timer = setTimeout(recover, Math.max(250, 5000 - performance.now() + lastAttempt)); }
    else timer = setTimeout(() => { if (episode) publish({ code, message: 'The graphics context has not restored. Retry rendering or reopen the study in a new tab. Unsaved work is retained.', busy: false }); }, 8000);
  };
  target.addEventListener('rispro-rendering-failure', failed);
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
    destroy() { stopped = true; clearTimeout(timer); target.removeEventListener('rispro-rendering-failure', failed); listeners.clear(); },
  };
}
