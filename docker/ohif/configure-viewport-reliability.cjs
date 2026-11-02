const fs = require('node:fs');
const path = require('node:path');

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
    const displaySetPromise = this._setDisplaySets(`);
  replace(service, '    return viewport.setStack(imageIds, initialImageIndexToUse).then(() => {',
    `    const stackRequest = viewport.setStack(imageIds, initialImageIndexToUse);
    const selection = (viewport as any)._risproSelection;
    return stackRequest.then(() => {
      if ((viewport as any)._risproSelection !== selection || viewport.isDisabled) return;`);
  replace(service, '  public async setVolumesForViewport(viewport, volumeInputArray, presentations) {',
    `  public async setVolumesForViewport(viewport, volumeInputArray, presentations) {
    // A custom hanging-protocol loader may finish after another series is selected.
    const selected = this.servicesManager.services.viewportGridService.getDisplaySetsUIDsForViewport(viewport.id) || [];
    if (viewport.isDisabled || volumeInputArray.some(input => input.displaySetInstanceUID && !selected.includes(input.displaySetInstanceUID))) return;`);
  replace(service, '    await viewport.setVolumes(volumeInputArray);',
    `    const volumesRequest = viewport.setVolumes(volumeInputArray);
    const selection = (viewport as any)._risproSelection;
    await volumesRequest;
    if ((viewport as any)._risproSelection !== selection || viewport.isDisabled) return;`);
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
      // Invalidate actual pending pixel/actor mutations before metadata creation yields.
      const invalidate = () => {
        if (previousViewport) Object.assign(previousViewport, { _risproSelection: {}, _risproDataRequest: {} });
      };
      invalidate();
      const loadViewportData = async () => {`);
  replace(component, '        const presentations = getViewportPresentations(viewportId, viewportOptions);',
    `        if (obsolete) return;
        const presentations = getViewportPresentations(viewportId, viewportOptions);`);
  replace(component, '      loadViewportData();', `      loadViewportData().catch(error => {
        if (obsolete || error?.name === 'AbortError') return;
        if (!recoverMobileMpr(servicesManager, viewportId, displaySets, viewportOptions.viewportType, error)) {
          console.warn('OHIF viewport initialization failed', error);
          document.dispatchEvent(new Event('rispro-initial-image-failed'));
        }
      });
      return () => { obsolete = true; invalidate(); };`);
  // Pinned Cornerstone 4.15.29: guard the continuations that mutate pixels and actors,
  // including A -> B -> A, where an image-id/index check alone is insufficient.
  const core = 'node_modules/@cornerstonejs/core/dist/esm/RenderingEngine/';
  // Cornerstone returns a separate cache-insertion promise which this caller
  // discards. Observe it; the original image promise still reports failures to
  // its consumers and IMAGE_LOAD_FAILED, including intentional cancellation.
  replace('node_modules/@cornerstonejs/core/dist/esm/loaders/imageLoader.js',
    '        cache.putImageLoadObject(imageId, imageLoadObject);',
    '        cache.putImageLoadObject(imageId, imageLoadObject).catch(() => {});');
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
        const selection = this._risproSelection = {};`);
  replace(stack, '        const imageId = await this._setImageIdIndex(currentImageIdIndex);',
    `        const imageId = await this._setImageIdIndex(currentImageIdIndex);
        if (this._risproSelection !== selection || this.isDisabled) return imageId;`);
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
  replace(volume, '    async setVolumes(volumeInputArray, immediate = false, suppressEvents = false) {',
    `    async setVolumes(volumeInputArray, immediate = false, suppressEvents = false) {
        const selection = this._risproSelection = {};`);
  replace(volume, '            const { volumeId, actorUID, slabThickness, ...rest } = volumeInputArray[i];\n            const actor = await createVolumeActor(volumeInputArray[i], this.element, this.id, suppressEvents);',
    `            const { volumeId, actorUID, slabThickness, ...rest } = volumeInputArray[i];
            const actor = await createVolumeActor(volumeInputArray[i], this.element, this.id, suppressEvents);
            if (this._risproSelection !== selection || this.isDisabled) { actor?.delete?.(); return; }`);
  const commands = 'extensions/cornerstone/src/commandsModule.ts';
  replace(commands, "const { add, intersect, subtract, copy }", recoverMobileMpr.toString() + '\n\nconst { add, intersect, subtract, copy }');
  replace(commands, '      viewport.setOrientation(orientation);\n      viewport.render();', `      try {
        viewport.setOrientation(orientation);
        viewport.render();
      } catch (error) {
        if (!recoverMobileMpr(servicesManager, viewportId, displaySets, viewport.type, error)) throw error;
        return;
      }`);
}

module.exports = { configureViewportReliability, recoverMobileMpr };
if (require.main === module) configureViewportReliability(process.cwd());
