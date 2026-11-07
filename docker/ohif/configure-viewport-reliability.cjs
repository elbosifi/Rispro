const fs = require('node:fs');
const path = require('node:path');

function failedCacheCleanupGuard() {
  return 'if (this._imageCache.get(imageId) === cachedImage) this._imageCache.delete(imageId);';
}

// Queued stack work belongs to one viewport selection, not merely an image ID.
// Retirement deliberately leaves transports and successful cache entries alone.
function createStackPrefetchOwnership(getEnabledElement, pool) {
  const owners = new WeakMap();
  let sequence = 0;
  const retire = owner => {
    if (!owner || owner.retired) return;
    owner.retired = true;
    pool.filterRequests(request => request.additionalDetails?._risproStackPrefetchOwner !== owner);
    owner.cleanup?.();
    if (owners.get(owner.element) === owner) owners.delete(owner.element);
    if (owner.viewport._risproStackPrefetchOwner === owner) delete owner.viewport._risproStackPrefetchOwner;
  };
  const current = owner => {
    if (!owner || owner.retired) return false;
    let viewport;
    try { viewport = getEnabledElement(owner.element)?.viewport; } catch { /* Already disabled. */ }
    const valid = viewport === owner.viewport && !viewport?.isDisabled && viewport?.type === 'stack' &&
      viewport._risproSelectionOwner === owner.selection &&
      (viewport._risproSelectionGeneration ?? owner.generation) === owner.generation &&
      (viewport._risproDisplaySetInstanceUIDs || []).join('|') === owner.displaySets;
    if (!valid) retire(owner);
    return valid;
  };
  return {
    get: element => owners.get(element), current, retire,
    begin(element) {
      const previous = owners.get(element);
      if (current(previous)) return previous;
      retire(previous);
      let viewport;
      try { viewport = getEnabledElement(element)?.viewport; } catch { return; }
      if (!viewport || viewport.isDisabled || viewport.type !== 'stack') return;
      const serial = ++sequence;
      const owner = { element, viewport, selection: viewport._risproSelectionOwner,
        generation: viewport._risproSelectionGeneration ?? serial, serial,
        displaySets: (viewport._risproDisplaySetInstanceUIDs || []).join('|'), retired: false, fresh: true };
      owner.retire = () => retire(owner);
      owners.set(element, owner);
      viewport._risproStackPrefetchOwner = owner;
      return owner;
    },
  };
}

function patchStackContextPrefetch(input) {
  let source = input.replaceAll('\r\n', '\n');
  const replace = (anchor, replacement) => {
    if (source.split(anchor).length !== 2) throw new Error('Pinned stackContextPrefetch anchor drift: ' + anchor.slice(0, 90));
    source = source.replace(anchor, replacement);
  };
  replace('import { imageLoader,', 'import { getEnabledElement, imageLoader,');
  replace('let resetPrefetchTimeout;', 'const risproPrefetch = (' + createStackPrefetchOwnership.toString() + ')(getEnabledElement, imageLoadPoolManager);');
  replace('const priorities = {};\n', '');
  replace('const enable = (element, priority = 0) => {', `const enable = (element, priority = 0) => {
    const owner = risproPrefetch.begin(element);
    if (!owner) return;
    if (owner.fresh) { addToolState(element, undefined); owner.fresh = false; }`);
  replace('    priorities[element] = priority;', '    owner.priority = priority;');
  replace('    owner.priority = priority;\n    prefetch(element, priority);', '    owner.priority = priority;\n    prefetch(element, priority, owner);');
  replace(`    const promiseRemovedHandler = getPromiseRemovedHandler(element);
    eventTarget.removeEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, promiseRemovedHandler);
    eventTarget.addEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, promiseRemovedHandler);`, `    if (!owner.cacheRemoved) {
        const handler = getPromiseRemovedHandler(element);
        owner.cacheRemoved = event => { if (risproPrefetch.current(owner)) handler(event); };
        eventTarget.addEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, owner.cacheRemoved);
        owner.cleanup = () => {
            clearTimeout(owner.timer);
            if (risproPrefetch.get(element) === owner) element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onImageUpdated);
            eventTarget.removeEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, owner.cacheRemoved);
            if (owner.state) owner.state.enabled = false;
        };
    }`);
  replace('function prefetch(element, priority = 0) {', `function prefetch(element, priority = 0, owner = risproPrefetch.get(element)) {
    if (!risproPrefetch.current(owner)) return;`);
  replace('imageLoadPoolManager.filterRequests(clearFromImageIds(stack));', 'imageLoadPoolManager.filterRequests(request => request.additionalDetails?._risproStackPrefetchOwner !== owner);');
  replace('    function doneCallback(imageId) {', `    function doneCallback(imageId) {
        if (!risproPrefetch.current(owner)) return;`);
  replace(`    if (!stackPrefetch.indicesToRequest.length) {
        return;
    }`, `    if (!stackPrefetch.indicesToRequest.length) {
        const currentId = stack.imageIds[currentImageIdIndex];
        if (!stackPrefetch.cacheFill && cache.getCachedImageBasedOnImageURI(currentId)?.sizeInBytes) doneCallback(currentId);
        return;
    }`);
  replace('                    updateToolState(element, usage);\n                    prefetch(element, priority);', '                    updateToolState(element, usage, owner);\n                    prefetch(element, priority, owner);');
  replace('    const requestFn = (imageId, options) => {', `    const requestFn = (imageId, options) => {
        if (!risproPrefetch.current(owner)) return Promise.resolve();`);
  replace('            imageId,\n        }, priority);', '            imageId, _risproStackPrefetchOwner: owner,\n        }, priority);');
  replace(`    clearTimeout(resetPrefetchTimeout);
    resetPrefetchTimeout = setTimeout(function () {
        const element = e.target;`, `    const element = e.target, owner = risproPrefetch.get(element);
    if (!risproPrefetch.current(owner)) return;
    clearTimeout(owner.timer);
    owner.timer = setTimeout(function () {
        if (!risproPrefetch.current(owner)) return;`);
  replace('            updateToolState(element);\n            prefetch(element, priorities[element]);', '            updateToolState(element, undefined, owner);\n            prefetch(element, owner.priority, owner);');
  replace('const updateToolState = (element, usage) => {', `const updateToolState = (element, usage, owner = risproPrefetch.get(element)) => {
    if (!risproPrefetch.current(owner)) return;`);
  replace('    addToolState(element, stackPrefetchData);', '    owner.state = stackPrefetchData;\n    addToolState(element, stackPrefetchData);');
  replace(`function disable(element) {
    clearTimeout(resetPrefetchTimeout);
    element.removeEventListener(Enums.Events.STACK_NEW_IMAGE, onImageUpdated);
    const promiseRemovedHandler = getPromiseRemovedHandler(element);
    eventTarget.removeEventListener(Enums.Events.IMAGE_CACHE_IMAGE_REMOVED, promiseRemovedHandler);
    const stackPrefetchData = getToolState(element);
    if (stackPrefetchData) {
        stackPrefetchData.enabled = false;
    }
}`, `function disable(element) {
    risproPrefetch.retire(risproPrefetch.get(element));
}`);
  return source;
}

function createCornerstoneImageOwnership(imageLoadPoolManager, cache) {
  const sharedLoads = new Map();
  const queuedCount = imageId => {
    const pool = imageLoadPoolManager.getRequestPool?.() || {};
    let count = 0;
    for (const priorities of Object.values(pool)) for (const requests of Object.values(priorities || {})) {
      for (const request of requests || []) if (request.additionalDetails?.imageId === imageId) count++;
    }
    return count;
  };
  const removeOneQueued = imageId => {
    const pool = imageLoadPoolManager.getRequestPool?.() || {};
    for (const priorities of Object.values(pool)) for (const requests of Object.values(priorities || {})) {
      const index = (requests || []).findIndex(request => request.additionalDetails?.imageId === imageId);
      if (index >= 0) { requests.splice(index, 1); return true; }
    }
    return false;
  };
  const cancelUnderlying = shared => {
    if (!shared || shared.aborted || shared.settled || shared.consumers.size || queuedCount(shared.imageId)) return;
    shared.aborted = true;
    shared.cancelFn?.();
  };
  const track = (imageId, loadObject) => {
    const shared = { imageId, promise: loadObject.promise, cancelFn: loadObject.cancelFn,
      consumers: new Set(), aborted: false, settled: false, failed: false, cacheOwned: true, loadObject: null };
    shared.loadObject = { _risproSharedLoad: shared, promise: shared.promise, cancelFn: () => {
      shared.cacheOwned = false;
      cancelUnderlying(shared);
    } };
    shared.promise.then(() => {
      shared.settled = true;
      if (sharedLoads.get(imageId) === shared) sharedLoads.delete(imageId);
    }, () => {
      shared.settled = true;
      shared.failed = true;
      if (sharedLoads.get(imageId) === shared) sharedLoads.delete(imageId);
    });
    sharedLoads.set(imageId, shared);
    return shared;
  };
  const createConsumer = shared => {
    let active = true, rejectConsumer;
    const consumer = { _risproSharedLoad: shared, promise: new Promise((resolve, reject) => {
      rejectConsumer = reject;
      shared.promise.then(value => { release(); resolve(value); }, error => { release(); reject(error); });
    }) };
    const release = () => { if (!active) return; active = false; shared.consumers.delete(consumer); };
    consumer.cancelFn = () => {
      if (!active) return;
      release();
      rejectConsumer(Object.assign(new Error('Image request canceled.'), { name: 'AbortError' }));
      cancelUnderlying(shared);
    };
    shared.consumers.add(consumer);
    consumer.promise.catch(() => {});
    return consumer;
  };
  const cancelConsumer = imageId => {
    const shared = sharedLoads.get(imageId) || cache.getImageLoadObject(imageId)?._risproSharedLoad;
    if (shared?.consumers.size) {
      shared.consumers.values().next().value.cancelFn();
      return true;
    }
    const removed = removeOneQueued(imageId);
    cancelUnderlying(shared);
    return removed || !!shared;
  };
  return { get: imageId => sharedLoads.get(imageId), track, createConsumer, cancelConsumer,
    queuedCount, cancelUnderlying };
}

function recoverMobileMpr(servicesManager, viewportId, displaySets, viewportType, error) {
  if (!window.matchMedia('(pointer: coarse)').matches ||
      !['orthographic', 'volume'].includes(viewportType) ||
      displaySets.length !== 1 || !['CT', 'MR'].includes(displaySets[0].Modality) ||
      displaySets[0].unsupported || displaySets[0].isDynamicVolume || !displaySets[0].images?.length) return false;
  const { viewportGridService, uiNotificationService } = servicesManager.services;
  const uids = displaySets.map(ds => ds.displaySetInstanceUID);
  const current = viewportGridService.getState().viewports.get(viewportId);
  // A late rejection must never replace a more recent user selection.
  if (!current || current.displaySetInstanceUIDs?.join() !== uids.join() ||
      !['orthographic', 'volume'].includes(current.viewportOptions?.viewportType)) return true;
  console.warn('OHIF mobile MPR failed; restoring 2D stack', error);
  viewportGridService.setDisplaySetsForViewport({
    viewportId, displaySetInstanceUIDs: uids,
    viewportOptions: { viewportType: 'stack', toolGroupId: 'default',
      initialImageOptions: { index: 0 }, presentationIds: {} },
    displaySetOptions: [{}],
  });
  uiNotificationService.show({ title: 'MPR unavailable',
    message: 'MPR could not be initialized on this device. Standard 2D images have been restored. You can select another series.',
    type: 'warning', duration: 7000 });
  return true;
}

function configureViewportReliability(root) {
  const replace = (file, anchor, replacement) => {
    const filename = path.join(root, file);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    if (source.split(anchor).length !== 2) throw Error('Pinned OHIF viewport reliability anchor changed: ' + file);
    fs.writeFileSync(filename, source.replace(anchor, replacement));
  };
  const service = 'extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts';
  const prefetchFile = path.join(root, 'node_modules/@cornerstonejs/tools/dist/esm/utilities/stackPrefetch/stackContextPrefetch.js');
  fs.writeFileSync(prefetchFile, patchStackContextPrefetch(fs.readFileSync(prefetchFile, 'utf8')));
  // Expose the existing completion promise to its caller. Previously neither
  // async volume assignment nor createViewportData rejections were handled.
  replace(service, '  ): void {\n    const renderingEngine = this.getRenderingEngine();',
    '  ): Promise<void> {\n    const renderingEngine = this.getRenderingEngine();');
  replace(service, '      if (!viewportData.data[0].imageIds?.length) {\n        return;',
    '      if (!viewportData.data[0].imageIds?.length) {\n        return Promise.resolve();');
  replace(service, '    displaySetPromise.then(() => {\n      this._broadcastEvent(this.EVENTS.VIEWPORT_DATA_CHANGED, {\n        viewportData,\n        viewportId,\n      });\n    });\n  }\n\n  public getViewportOptions',
    '    return displaySetPromise.then(() => {\n      if ((viewport as any)._risproDataRequest !== request) return;\n      this._broadcastEvent(this.EVENTS.VIEWPORT_DATA_CHANGED, {\n        viewportData,\n        viewportId,\n      });\n    });\n  }\n\n  public getViewportOptions');
  replace(service, '    const displaySetPromise = this._setDisplaySets(',
    `    const request = {};
    Object.assign(viewport, { _risproDataRequest: request });
    const selectionOwner = (viewportInfo as any)._risproPendingSelection;
    if (selectionOwner) Object.assign(viewport, {
      _risproSelectionOwner: selectionOwner,
      _risproSelectionGeneration: selectionOwner.generation,
      _risproDisplaySetInstanceUIDs: [...selectionOwner.displaySetInstanceUIDs],
      _risproSelection: { generation: selectionOwner.generation },
      _risproAttachedData: null,
    });
    const displaySetPromise = this._setDisplaySets(`);
  replace(service, `      if ((viewport as any)._risproDataRequest !== request) return;
      this._broadcastEvent(this.EVENTS.VIEWPORT_DATA_CHANGED, {
        viewportData,
        viewportId,
      });`, `      if ((viewport as any)._risproDataRequest !== request) return;
      const owner = selectionOwner;
      const selected = this.servicesManager.services.viewportGridService.getDisplaySetsUIDsForViewport(viewportId) || [];
      if (owner && ((viewport as any)._risproSelectionOwner !== owner || owner.generation !== (viewport as any)._risproSelectionGeneration || owner.displaySetInstanceUIDs.join('|') !== selected.join('|'))) return;
      const imageIds = viewport.type === csEnums.ViewportType.STACK ? viewport.getImageIds() : null;
      const volumeInputs = viewport.type === csEnums.ViewportType.STACK ? null : (viewport as any)._risproVolumeInputs;
      if (owner) {
        (viewport as any)._risproAttachedData = imageIds?.length
          ? { kind: 'stack', selectionGeneration: owner.generation, displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], imageIds: [...imageIds] }
          : volumeInputs?.length
            ? { kind: 'volume', selectionGeneration: owner.generation, displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], volumeInputs: [...volumeInputs], volumeIds: volumeInputs.map(input => input.volumeId) }
            : null;
        if (!(viewport as any)._risproAttachedData) return;
        document.dispatchEvent(new CustomEvent('rispro-viewport-data-ready', { detail: {
          viewportId, selectionGeneration: owner.generation,
          displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], kind: (viewport as any)._risproAttachedData.kind,
        } }));
      }
      this._broadcastEvent(this.EVENTS.VIEWPORT_DATA_CHANGED, {
        viewportData,
        viewportId,
      });`);
  replace(service, '    return viewport.setStack(imageIds, initialImageIndexToUse).then(() => {',
    `    const stackRequest = viewport.setStack(imageIds, initialImageIndexToUse);
    const selection = (viewport as any)._risproSelection;
    const generation = (viewport as any)._risproSelectionGeneration;
    const owner = (viewport as any)._risproSelectionOwner;
    return stackRequest.then(() => {
      if ((viewport as any)._risproSelection !== selection || (viewport as any)._risproSelectionGeneration !== generation ||
          (viewport as any)._risproSelectionOwner !== owner || viewport.isDisabled) return;`);
  replace(service, '  public async setVolumesForViewport(viewport, volumeInputArray, presentations) {',
    `  public async setVolumesForViewport(viewport, volumeInputArray, presentations) {
    // A custom hanging-protocol loader may finish after another series is selected.
    const selected = this.servicesManager.services.viewportGridService.getDisplaySetsUIDsForViewport(viewport.id) || [];
    const owner = (viewport as any)._risproSelectionOwner;
    if (viewport.isDisabled || owner && (owner.generation !== (viewport as any)._risproSelectionGeneration || owner.displaySetInstanceUIDs.join('|') !== selected.join('|')) ||
        volumeInputArray.some(input => input.displaySetInstanceUID && !selected.includes(input.displaySetInstanceUID))) return;`);
  replace(service, '    await viewport.setVolumes(volumeInputArray);',
    `    const volumesRequest = viewport.setVolumes(volumeInputArray);
    const selection = (viewport as any)._risproSelection;
    const generation = (viewport as any)._risproSelectionGeneration;
    await volumesRequest;
    if ((viewport as any)._risproSelection !== selection || (viewport as any)._risproSelectionGeneration !== generation ||
        (viewport as any)._risproSelectionOwner !== owner || viewport.isDisabled) return;
    if (owner) {
      const selected = this.servicesManager.services.viewportGridService.getDisplaySetsUIDsForViewport(viewport.id) || [];
      if (owner.displaySetInstanceUIDs.join('|') !== selected.join('|')) return;
      (viewport as any)._risproAttachedData = { kind: 'volume', selectionGeneration: generation,
        displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], volumeInputs: [...volumeInputArray],
        volumeIds: volumeInputArray.map(input => input.volumeId) };
      document.dispatchEvent(new CustomEvent('rispro-viewport-data-ready', { detail: { viewportId: viewport.id,
        selectionGeneration: generation, displaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], kind: 'volume' } }));
    }`);
  replace(service, '    const timeoutViewportCallback = (callback: () => void) => setTimeout(callback, 0);',
    `    const dataRequest = (viewport as any)._risproDataRequest;
    const timeoutViewportCallback = (callback: () => void) => setTimeout(() => {
      if ((viewport as any)._risproDataRequest === dataRequest && !viewport.isDisabled) callback();
    }, 0);`);
  const component = 'extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx';
  replace(component, "const STACK = 'stack';", recoverMobileMpr.toString() + "\n\nconst STACK = 'stack';");
  replace(component, '        cornerstoneViewportService.setViewportData(', '        await cornerstoneViewportService.setViewportData(');
  replace(component, '      const loadViewportData = async () => {', `      let obsolete = false;
      const previousViewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      previousViewport?._risproStackPrefetchOwner?.retire();
      const viewportInfo = cornerstoneViewportService.getViewportInfo(viewportId);
      const owner = {
        generation: Math.max(viewportInfo?._risproSelectionGeneration || 0, previousViewport?._risproSelectionGeneration || 0) + 1,
        displaySetInstanceUIDs: displaySets.map(displaySet => displaySet.displaySetInstanceUID),
      };
      if (viewportInfo) { viewportInfo._risproSelectionGeneration = owner.generation; viewportInfo._risproPendingSelection = owner; }
      // Invalidate actual pending pixel/actor mutations before metadata creation yields.
      const invalidate = () => {
        if (previousViewport?._risproStackPrefetchOwner?.selection === owner) previousViewport._risproStackPrefetchOwner.retire();
        if (previousViewport && previousViewport._risproSelectionGeneration === owner.generation) Object.assign(previousViewport, {
          _risproSelection: { generation: owner.generation, obsolete: true }, _risproDataRequest: {},
          _risproSelectionOwner: owner, _risproSelectionGeneration: owner.generation,
          _risproDisplaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], _risproAttachedData: null,
        });
      };
      if (previousViewport) Object.assign(previousViewport, {
        _risproSelection: { generation: owner.generation }, _risproDataRequest: {},
        _risproSelectionOwner: owner, _risproSelectionGeneration: owner.generation,
        _risproDisplaySetInstanceUIDs: [...owner.displaySetInstanceUIDs], _risproAttachedData: null,
      });
      invalidate();
      const loadViewportData = async () => {`);
  replace(component, '        const presentations = getViewportPresentations(viewportId, viewportOptions);',
    `        if (obsolete || viewportInfo?._risproPendingSelection !== owner) return;
        const presentations = getViewportPresentations(viewportId, viewportOptions);`);
  replace(component, '      loadViewportData();', `      loadViewportData().catch(error => {
        if (obsolete || error?.name === 'AbortError' || viewportInfo?._risproSelectionGeneration !== owner.generation) return;
        if (!recoverMobileMpr(servicesManager, viewportId, displaySets, viewportOptions.viewportType, error)) {
          const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
          const code = error?.code || 'viewport-init-failed';
          const contextLost = code === 'context-lost';
          const scope = contextLost || ['context-pool-missing','rendering-mode-mismatch'].includes(code) ? 'engine' : 'viewport';
          document.dispatchEvent(new CustomEvent('rispro-rendering-failure', { detail: {
            engineId: cornerstoneViewportService.renderingEngine?.id, code, viewportId,
            selectionGeneration: owner.generation, scope, contextLost, error,
          } }));
          document.dispatchEvent(new Event('rispro-initial-image-failed'));
        }
      });
      return () => { obsolete = true; invalidate(); if (viewportInfo?._risproPendingSelection === owner) viewportInfo._risproPendingSelection = null; };`);
  // Pinned Cornerstone 4.15.29: guard the continuations that mutate pixels and actors,
  // including A -> B -> A, where an image-id/index check alone is insufficient.
  const core = 'node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/';
  const loaderModule = 'node_modules/@cornerstonejs/core/dist/esm/loaders/imageLoader.js';
  replace(loaderModule, 'const imageLoaders = {};',
    'const imageLoaders = {};\nconst risproImageOwnership = (' + createCornerstoneImageOwnership.toString() + ')(imageLoadPoolManager, cache);');
  replace(loaderModule, `function loadImageFromImageLoader(imageId, options) {
    const cachedImageLoadObject = cache.getImageLoadObject(imageId);
    if (cachedImageLoadObject) {
        handleImageLoadPromise(cachedImageLoadObject.promise, imageId);
        return cachedImageLoadObject;
    }
    const scheme = imageId.split(':')[0];
    const loader = imageLoaders[scheme] || unknownImageLoader;
    if (!loader) {
        throw new Error(\`loadImageFromImageLoader: No image loader found for scheme '\${scheme}'\`);
    }
    const imageLoadObject = loader(imageId, options);
    handleImageLoadPromise(imageLoadObject.promise, imageId);
    return imageLoadObject;
}`, `function loadImageFromImageLoader(imageId, options) {
    let cachedImageLoadObject = cache.getImageLoadObject(imageId);
    let shared = risproImageOwnership.get(imageId) || cachedImageLoadObject?._risproSharedLoad;
    if (shared && (shared.aborted || shared.failed)) {
        if (cachedImageLoadObject?._risproSharedLoad === shared) cache.removeImageLoadObject(imageId, { force: true });
        cachedImageLoadObject = undefined;
        shared = undefined;
    }
    if (shared && !shared.settled) {
        const imageLoadObject = risproImageOwnership.createConsumer(shared);
        handleImageLoadPromise(imageLoadObject.promise, imageId);
        return imageLoadObject;
    }
    if (cachedImageLoadObject) {
        handleImageLoadPromise(cachedImageLoadObject.promise, imageId);
        return cachedImageLoadObject;
    }
    if (shared && !shared.aborted && !shared.failed) {
        handleImageLoadPromise(shared.promise, imageId);
        return shared.loadObject;
    }
    const scheme = imageId.split(':')[0];
    const loader = imageLoaders[scheme] || unknownImageLoader;
    if (!loader) throw new Error(\`loadImageFromImageLoader: No image loader found for scheme '\${scheme}'\`);
    shared = risproImageOwnership.track(imageId, loader(imageId, options));
    const imageLoadObject = risproImageOwnership.createConsumer(shared);
    handleImageLoadPromise(imageLoadObject.promise, imageId);
    return imageLoadObject;
}`);
  replace(loaderModule, '        cache.putImageLoadObject(imageId, imageLoadObject);',
    `        const cachedLoadObject = imageLoadObject._risproSharedLoad?.loadObject || imageLoadObject;
        cache.putImageLoadObject(imageId, cachedLoadObject).catch(error => {
            if (error?.name !== 'AbortError') document.dispatchEvent(new CustomEvent('rispro-image-cache-failed', {
                detail: { name: error?.name || 'Error', stack: error?.stack }
            }));
        });`);
  replace(loaderModule, `export function cancelLoadImage(imageId) {
    const filterFunction = ({ additionalDetails }) => {
        if (additionalDetails.imageId) {
            return additionalDetails.imageId !== imageId;
        }
        return true;
    };
    imageLoadPoolManager.filterRequests(filterFunction);
    const imageLoadObject = cache.getImageLoadObject(imageId);
    if (imageLoadObject) {
        imageLoadObject.cancelFn();
    }
}`, `export function cancelLoadImage(imageId) {
    const shared = risproImageOwnership.get(imageId) || cache.getImageLoadObject(imageId)?._risproSharedLoad;
    if (shared) {
        risproImageOwnership.cancelConsumer(imageId);
        return;
    }
    const filterFunction = ({ additionalDetails }) => {
        if (additionalDetails.imageId) return additionalDetails.imageId !== imageId;
        return true;
    };
    imageLoadPoolManager.filterRequests(filterFunction);
    const imageLoadObject = cache.getImageLoadObject(imageId);
    if (imageLoadObject) imageLoadObject.cancelFn?.();
}`);
  replace('node_modules/@cornerstonejs/core/dist/esm/cache/cache.js',
    '            console.debug(`Error caching image ${imageId}:`, error);\n            this._imageCache.delete(imageId);\n            throw error;',
    '            console.debug(`Error caching image ${imageId}:`, error);\n            ' + failedCacheCleanupGuard() + '\n            throw error;');
  // The WADO iterator consumes the stream directly; its bridge promise is
  // otherwise discarded and rejects separately on failed/canceled transfers.
  replace('node_modules/@cornerstonejs/dicom-image-loader/dist/esm/imageLoader/wadors/loadImage.js',
    '            const compressedIt = ProgressiveIterator.as(getPixelData(imageURI, imageId, mediaType, options));',
    `            const compressedPromise = getPixelData(imageURI, imageId, mediaType, options);
            if (compressedPromise.iterator) compressedPromise.catch(() => {});
            const compressedIt = ProgressiveIterator.as(compressedPromise);`);
  const stack = core + 'StackViewport.js';
  replace(stack, '    async setStack(imageIds, currentImageIdIndex = 0) {',
    `    async setStack(imageIds, currentImageIdIndex = 0) {
        this._risproStackPrefetchOwner?.retire();
        const generation = this._risproSelectionGeneration;
        const owner = this._risproSelectionOwner;
        const selection = this._risproSelection = { generation };`);
  replace(stack, '        const imageId = await this._setImageIdIndex(currentImageIdIndex);',
    `        const imageId = await this._setImageIdIndex(currentImageIdIndex);
        if (this._risproSelection !== selection || this._risproSelectionGeneration !== generation || this._risproSelectionOwner !== owner || this.isDisabled) return imageId;`);
  replace(stack, '    _loadAndDisplayImageCPU(imageId, imageIdIndex) {',
    `    _loadAndDisplayImageCPU(imageId, imageIdIndex) {
        const selection = this._risproSelection;`);
  replace(stack, '            function successCallback(image, imageIdIndex, imageId) {',
    `            function successCallback(image, imageIdIndex, imageId) {
                if (this._risproSelection !== selection || this.isDisabled || this.currentImageIdIndex !== imageIdIndex) { resolve(imageId); return; }`);
  replace(stack, '            function errorCallback(error, imageIdIndex, imageId) {',
    `            function errorCallback(error, imageIdIndex, imageId) {
                if (this._risproSelection !== selection || this.isDisabled) { resolve(imageId); return; }`);
  replace(stack, '        return this.imagesLoader.loadImages([imageId], this).then(() => {',
    `        const selection = this._risproSelection;
        const current = () => this._risproSelection === selection && !this.isDisabled;
        const listener = Object.create(this);
        listener.successCallback = (...args) => { if (current()) this.successCallback(...args); };
        listener.errorCallback = (...args) => { if (current()) this.errorCallback(...args); };
        listener.getLoaderImageOptions = this.getLoaderImageOptions.bind(this);
        return this.imagesLoader.loadImages([imageId], listener).then(() => {`);
  replace(stack, '        const imageId = await this._loadAndDisplayImage(this.imageIds[imageIdIndex], imageIdIndex);',
    `        const selection = this._risproSelection;
        const imageId = await this._loadAndDisplayImage(this.imageIds[imageIdIndex], imageIdIndex);
        if (this._risproSelection !== selection || this.isDisabled || this.currentImageIdIndex !== imageIdIndex) return imageId;`);
  const volume = core + 'BaseVolumeViewport.js';
  replace(core + 'BaseRenderingEngine.js', '    _resetViewport(viewport) {', `    _resetViewport(viewport) {
        viewport._risproStackPrefetchOwner?.retire();`);
  replace(volume, '    async setVolumes(volumeInputArray, immediate = false, suppressEvents = false) {',
    `    async setVolumes(volumeInputArray, immediate = false, suppressEvents = false) {
        const generation = this._risproSelectionGeneration;
        const owner = this._risproSelectionOwner;
        const selection = this._risproSelection = { generation };`);
  replace(volume, '            const { volumeId, actorUID, slabThickness, ...rest } = volumeInputArray[i];\n            const actor = await createVolumeActor(volumeInputArray[i], this.element, this.id, suppressEvents);',
    `            const { volumeId, actorUID, slabThickness, ...rest } = volumeInputArray[i];
            const input = volumeInputArray[i];
            const guardedInput = input.callback ? { ...input, callback: (...args) => {
              if (this._risproSelection === selection && this._risproSelectionGeneration === generation && this._risproSelectionOwner === owner && !this.isDisabled) input.callback(...args);
            } } : input;
            const actor = await createVolumeActor(guardedInput, this.element, this.id, suppressEvents);
            if (this._risproSelection !== selection || this._risproSelectionGeneration !== generation || this._risproSelectionOwner !== owner || this.isDisabled) { actor?.delete?.(); return; }`);
  const commands = 'extensions/cornerstone/src/commandsModule.ts';
  replace(commands, "const { add, intersect, subtract, copy }", recoverMobileMpr.toString() + '\n\nconst { add, intersect, subtract, copy }');
  replace(commands, '      viewport.setOrientation(orientation);\n      viewport.render();', `      try {
        viewport.setOrientation(orientation);
        viewport.render();
      } catch (error) {
        if (!recoverMobileMpr(servicesManager, viewportId, displaySets, viewport.type, error)) throw error;
        return;
      }`);
  require('./configure-rendering-resilience.cjs').configureRenderingResilience(root);
}

module.exports = { configureViewportReliability, recoverMobileMpr, failedCacheCleanupGuard, createCornerstoneImageOwnership, patchStackContextPrefetch };
if (require.main === module) configureViewportReliability(process.cwd());
