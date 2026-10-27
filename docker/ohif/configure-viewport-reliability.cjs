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
    '    return displaySetPromise.then(() => {\n      this._broadcastEvent(this.EVENTS.VIEWPORT_DATA_CHANGED, {\n        viewportData,\n        viewportId,\n      });\n    });\n  }\n\n  public getViewportOptions');
  const component = 'extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx';
  replace(component, "const STACK = 'stack';", recoverMobileMpr.toString() + "\n\nconst STACK = 'stack';");
  replace(component, '        cornerstoneViewportService.setViewportData(', '        await cornerstoneViewportService.setViewportData(');
  replace(component, '      loadViewportData();', `      loadViewportData().catch(error => {
        if (!recoverMobileMpr(servicesManager, viewportId, displaySets, viewportOptions.viewportType, error)) throw error;
      });`);
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
