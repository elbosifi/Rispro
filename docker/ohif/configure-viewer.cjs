// Narrow source customizations for pinned OHIF v3.12.6; never patch bundles.
const fs = require('node:fs');
const path = require('node:path');
const { configureResponsive } = require('./configure-responsive.cjs');
const { configureSeriesWindowing } = require('./configure-series-windowing.cjs');

async function getStudiesForPatientByMRN(dataSource, currentStudies) {
  if (!currentStudies?.length) return [];
  const studyUids = dataSource.getConfig()?.risproStudyInstanceUIDs;
  if (Array.isArray(studyUids)) {
    // These URL selectors grant no access. RISpro rechecks the persisted launch
    // allowlist for every exact-study query, metadata request and frame.
    const studies = await Promise.all(studyUids.map(studyInstanceUid => {
      const current = currentStudies.find(study => study.studyInstanceUid === studyInstanceUid);
      return current ? [current] : dataSource.query.studies.search({ studyInstanceUid });
    }));
    return studies.flat();
  }
  const mrn = currentStudies[0].mrn;
  return mrn ? dataSource.query.studies.search({ patientId: mrn, disableWildcard: true }) : currentStudies;
}

const diagnosticSeriesRules = [
  { weight: 5, attribute: 'Modality', constraint: { equals: { value: 'CT' } } },
  { weight: 5, attribute: 'Modality', constraint: { equals: { value: 'MR' } } },
  { weight: 5, attribute: 'numImageFrames', constraint: { greaterThan: { value: 1 } } },
  ...['2','2.1','2.2','4','4.1','4.4'].map(suffix => ({
    weight: 5, attribute: 'SOPClassUID', constraint: { equals: { value: '1.2.840.10008.5.1.4.1.1.' + suffix } },
  })),
];

// Only inspect the active stack once; subsequent cache events update one frame.
// No image loader calls: lazy loading and the request pools remain upstream-owned.
function trackCachedFrames(imageIds, cache, target, events, update) {
  const ids = new Set(imageIds);
  const loaded = new Set([...ids].filter(id => cache.isLoaded(id) && cache.getImage(id)));
  const failed = new Set();
  const publish = () => update({ loaded: loaded.size, total: ids.size, failed: failed.size });
  const onEvent = event => {
    const id = event.detail.imageId || event.detail.image?.imageId;
    if (!ids.has(id)) return;
    if (event.type === events.IMAGE_LOAD_FAILED) {
      if (!loaded.has(id)) failed.add(id);
    } else if (event.type === events.IMAGE_CACHE_IMAGE_REMOVED) {
      loaded.delete(id);
    } else if (cache.isLoaded(id) && cache.getImage(id)) {
      loaded.add(id);
      failed.delete(id);
    }
    publish();
  };
  const names = ['IMAGE_LOADED', 'IMAGE_LOAD_FAILED', 'IMAGE_CACHE_IMAGE_ADDED', 'IMAGE_CACHE_IMAGE_REMOVED'];
  names.forEach(name => target.addEventListener(events[name], onEvent));
  publish();
  return () => names.forEach(name => target.removeEventListener(events[name], onEvent));
}

function isDiagnosticReady(viewport, renderedStatus) {
  if (!viewport || viewport.viewportStatus !== renderedStatus) return false;
  if (viewport.getCornerstoneImage) {
    const image = viewport.getCornerstoneImage();
    return !!(image && image.imageId === viewport.getCurrentImageId() && image.getPixelData()?.length);
  }
  // Volume viewports (MPR/MIP) have no stack image. Require actual voxel data
  // in addition to a completed render, never a hanging-protocol event.
  return !!viewport.getImageData?.()?.scalarData?.length;
}

const loadingSource = `import React, { useEffect, useLayoutEffect, useState } from 'react';
import { Button, useImageViewer, useViewportGrid } from '@ohif/ui-next';
import { cache, eventTarget, Enums } from '@cornerstonejs/core';

${trackCachedFrames.toString()}
${isDiagnosticReady.toString()}

export function useFirstDiagnosticImage(servicesManager, enabled) {
  const [{ activeViewportId, viewports }] = useViewportGrid();
  const { StudyInstanceUIDs } = useImageViewer();
  const [state, setState] = useState(enabled ? 'loading' : 'ready');
  const { cornerstoneViewportService, displaySetService } = servicesManager.services;
  useLayoutEffect(() => {
    if (!enabled || state === 'ready' || !cornerstoneViewportService) return;
    let alive = true;
    const pending = new Set();
    const primary = StudyInstanceUIDs[0];
    const selected = () => {
      const candidates = [activeViewportId, ...viewports.keys()];
      for (const id of candidates) {
        const ds = viewports.get(id)?.displaySetInstanceUIDs?.map(uid => displaySetService.getDisplaySetByUID(uid));
        if (ds?.some(ds => ds?.StudyInstanceUID === primary && !ds.unsupported &&
            !['SR', 'SEG', 'RTSTRUCT', 'RTPLAN', 'RTDOSE', 'DOC', 'PMAP'].includes(ds.Modality))) {
          return cornerstoneViewportService.getCornerstoneViewport(id);
        }
      }
    };
    const check = () => {
      const viewport = selected();
      if (isDiagnosticReady(viewport, Enums.ViewportStatus.RENDERED)) {
        if (alive) setState('ready');
        return;
      }
      // Catch a rejection even when the request started before this effect.
      const imageId = viewport?.getCurrentImageId?.();
      const promise = imageId && cache.getImageLoadObject(imageId)?.promise;
      if (promise && !pending.has(promise)) {
        pending.add(promise);
        promise.catch(() => { if (alive && selected()?.getCurrentImageId?.() === imageId) setState('error'); });
      }
    };
    const failure = event => {
      const viewport = selected();
      const id = event.detail.imageId;
      if (id && (viewport?.getCurrentImageId?.() === id ||
          (viewport?.type !== Enums.ViewportType.STACK && viewport?.getImageIds?.().includes(id)))) {
        if (alive) setState('error');
      }
    };
    // Render events are element-local and do not bubble; capture also covers
    // elements created after this effect. The readiness check covers warm opens.
    document.addEventListener(Enums.Events.IMAGE_RENDERED, check, true);
    document.addEventListener(Enums.Events.IMAGE_LOAD_ERROR, failure, true);
    eventTarget.addEventListener(Enums.Events.IMAGE_LOAD_FAILED, failure);
    const subscription = cornerstoneViewportService.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED, check);
    check();
    return () => {
      alive = false;
      document.removeEventListener(Enums.Events.IMAGE_RENDERED, check, true);
      document.removeEventListener(Enums.Events.IMAGE_LOAD_ERROR, failure, true);
      eventTarget.removeEventListener(Enums.Events.IMAGE_LOAD_FAILED, failure);
      subscription.unsubscribe();
    };
  }, [enabled, state, activeViewportId, viewports, StudyInstanceUIDs, cornerstoneViewportService, displaySetService]);
  return state;
}

export function InitialImageLoading({ state }) {
  if (state === 'ready') return null;
  return <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center">
    <div className="bg-black p-4 text-white" role={state === 'error' ? 'alert' : 'status'}>
      {state === 'error' ? <><p>Unable to load the diagnostic image.</p>
        <Button className="pointer-events-auto" onClick={() => window.location.reload()}>Retry</Button></> :
        <><progress aria-label="Preparing first diagnostic image" /><p>Preparing first diagnostic image…</p></>}
    </div>
  </div>;
}

export function useActiveCachedFrames(servicesManager, activeViewportId, viewports) {
  const [progress, setProgress] = useState(null);
  const { cornerstoneViewportService } = servicesManager.services;
  useEffect(() => {
    let stop = () => {};
    const attach = () => {
      stop();
      setProgress(null);
      const viewport = cornerstoneViewportService?.getCornerstoneViewport(activeViewportId);
      // A volume's slice count is not a count of its source stack frames.
      if (viewport?.type !== Enums.ViewportType.STACK) return;
      const ids = viewport.getImageIds();
      if (!ids?.length) return;
      stop = trackCachedFrames(ids, cache, eventTarget, Enums.Events, setProgress);
    };
    const subscription = cornerstoneViewportService?.subscribe(
      cornerstoneViewportService.EVENTS.VIEWPORT_DATA_CHANGED,
      ({ viewportId }) => { if (viewportId === activeViewportId) attach(); });
    attach();
    return () => { stop(); subscription?.unsubscribe(); };
  }, [activeViewportId, viewports, cornerstoneViewportService]);
  return progress;
}

export function CachedFrames({ progress }) {
  return <div className="p-2 text-white" role="status">
    {progress ? <><p>Cached frames: {progress.loaded} / {progress.total}{progress.failed ? ' · Failed frames: ' + progress.failed : ''}</p>
      <progress aria-label="Cached frames" value={progress.loaded} max={progress.total} /></> :
      <><p>Cached-frame progress unavailable for this view</p><progress aria-label="Preparing image view" /></>}
  </div>;
}
`;

function configureLoading(root) {
  const replace = (file, anchor, replacement) => {
    const filename = path.join(root, file);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    if (source.split(anchor).length !== 2) throw Error('Pinned OHIF loading integration changed: ' + file);
    fs.writeFileSync(filename, source.replace(anchor, replacement));
  };
  const layout = 'extensions/default/src/ViewerLayout/index.tsx';
  replace(layout, "const resizableHandleClassName", "import { useFirstDiagnosticImage, InitialImageLoading } from '../RisproLoading';\n\nconst resizableHandleClassName");
  replace(layout, 'const [showLoadingIndicator, setShowLoadingIndicator] = useState(appConfig.showLoadingIndicator);',
    'const initialImageState = useFirstDiagnosticImage(servicesManager, appConfig.showLoadingIndicator);');
  replace(layout, "import { HangingProtocolService, CommandsManager } from '@ohif/core';", "import { CommandsManager } from '@ohif/core';");
  replace(layout, 'const { panelService, hangingProtocolService, customizationService }', 'const { panelService, customizationService }');
  replace(layout, "  const LoadingIndicatorProgress = customizationService.getCustomization(\n    'ui.loadingIndicatorProgress'\n  );", '');
  const filename = path.join(root, layout);
  let source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf('  useEffect(() => {\n    const { unsubscribe } = hangingProtocolService.subscribe(');
  const end = source.indexOf('  }, [hangingProtocolService]);', start);
  if (start < 0 || end < 0) throw Error('Pinned OHIF protocol loading subscription changed');
  source = source.slice(0, start) + source.slice(end + '  }, [hangingProtocolService]);'.length);
  fs.writeFileSync(filename, source);
  replace(layout, '{showLoadingIndicator && <LoadingIndicatorProgress className="h-full w-full bg-black" />}',
    '<InitialImageLoading state={initialImageState} />');
  const panel = 'extensions/default/src/Panels/StudyBrowser/PanelStudyBrowser.tsx';
  replace(panel, 'const { sortStudyInstances', "import { useActiveCachedFrames, CachedFrames } from '../../RisproLoading';\n\nconst { sortStudyInstances");
  replace(panel, '  const [activeTabName, setActiveTabName]',
    '  const cachedFrames = useActiveCachedFrames(servicesManager, activeViewportId, viewports);\n  const [activeTabName, setActiveTabName]');
  replace(panel, '      <StudyBrowser\n', '      <CachedFrames progress={cachedFrames} />\n      <StudyBrowser\n');
  fs.writeFileSync(path.join(root, 'extensions/default/src/RisproLoading.tsx'), loadingSource);
}

const ctPresets = [
  { id: 'ct-abdomen', description: 'Abdomen', window: '400', level: '60' },
  { id: 'ct-angio', description: 'CT Angio', window: '600', level: '300' },
  { id: 'ct-bone', description: 'Bone', window: '1500', level: '300' },
  { id: 'ct-brain', description: 'Brain', window: '80', level: '40' },
  { id: 'ct-chest', description: 'Chest', window: '400', level: '40' },
  { id: 'ct-lung', description: 'Lung', window: '1500', level: '-400' },
  { id: 'ct-liver', description: 'Liver', window: '150', level: '90' },
];

// Cornerstone has already decoded/sign-extended these samples. Never reinterpret
// their storage bits or apply rescale twice. Only the displayed frame is visited.
function fullDynamicRange(image, instance) {
  if (!image || image.color || image.numberOfComponents > 1) return;
  const pixels = image.getPixelData();
  const scaling = image.preScale?.scalingParameters;
  const slope = Number(scaling?.rescaleSlope ?? instance.RescaleSlope ?? image.slope ?? 1);
  const intercept = Number(scaling?.rescaleIntercept ?? instance.RescaleIntercept ?? image.intercept ?? 0);
  const scaled = image.preScale?.scaled === true;
  const padding = instance.PixelPaddingValue;
  const paddingEnd = instance.PixelPaddingRangeLimit ?? padding;
  const p1 = Number(padding) * (scaled ? slope : 1) + (scaled ? intercept : 0);
  const p2 = Number(paddingEnd) * (scaled ? slope : 1) + (scaled ? intercept : 0);
  let lower = Infinity;
  let upper = -Infinity;
  for (let i = 0; i < pixels.length; i++) {
    const value = pixels[i];
    if (!Number.isFinite(value) || (padding != null && value >= Math.min(p1, p2) && value <= Math.max(p1, p2))) continue;
    const intensity = scaled ? value : value * slope + intercept;
    lower = Math.min(lower, intensity);
    upper = Math.max(upper, intensity);
  }
  if (Number.isFinite(lower) && Number.isFinite(upper)) return { lower, upper };
}

function isWindowingInput(element) {
  return !!element?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"]');
}

function configureUsability(root) {
  const replace = (file, anchor, replacement) => {
    const filename = path.join(root, file);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    if (source.split(anchor).length !== 2) throw Error('Pinned OHIF usability anchor changed: ' + file);
    fs.writeFileSync(filename, source.replace(anchor, replacement));
  };
  const groups = 'modes/basic/src/initToolGroups.ts';
  // Scope replacements to these two functions: SR and volume3d stay upstream.
  for (const [name, next] of [['initDefaultToolGroup', 'initSRToolGroup'], ['initMPRToolGroup', 'initVolume3DToolGroup']]) {
    const filename = path.join(root, groups);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
    const start = source.indexOf('function ' + name + '(');
    const end = source.indexOf('function ' + next + '(', start);
    if (start < 0 || end < 0) throw Error('Pinned OHIF diagnostic tool groups changed');
    const section = source.slice(start, end);
    const active = `toolName: toolNames.WindowLevel,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],`;
    const wheel = 'bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],';
    const passive = '    passive: [\n';
    for (const anchor of [active, wheel, passive, '      { toolName: toolNames.StackScroll },\n']) {
      if (section.split(anchor).length !== 2) throw Error('Pinned OHIF diagnostic bindings changed: ' + name);
    }
    const updated = section.replace(active, 'toolName: toolNames.WindowLevel,\n        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],')
      .replace(wheel, 'bindings: [{ mouseButton: Enums.MouseBindings.Primary }, { mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],')
      .replace('      { toolName: toolNames.StackScroll },\n', '')
      .replace(passive, passive + '      { toolName: toolNames.Pan },\n');
    replace(groups, section, updated);
  }
  const hotkeys = 'platform/core/src/defaults/hotkeyBindings.ts';
  const oldKeys = [
    ['ct-soft-tissue', 0], ['ct-lung', 1], ['ct-bone', 2], ['ct-brain', 3],
  ].map(([id, index]) => `  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetName: '${id}', presetIndex: ${index} },
    label: 'W/L Preset ${index + 1}',
    keys: ['${index + 1}'],
  },`).join('\n');
  const bindings = [
    { mode: 'original', label: 'Original DICOM window' },
    { mode: 'dynamic', label: 'Full Dynamic' },
    ...ctPresets.map((p, presetIndex) => ({ mode: 'preset', presetName: p.id, presetIndex, label: p.description })),
  ].map(({ label, ...commandOptions }, index) => ({
    commandName: 'risproWindowing', commandOptions, label, keys: [String(index)],
  }));
  replace(hotkeys, oldKeys, bindings.map(b => '  ' + JSON.stringify(b) + ',').join('\n'));
  const presets = 'extensions/cornerstone/src/components/WindowLevelActionMenu/defaultWindowLevelPresets.ts';
  const presetSource = fs.readFileSync(path.join(root, presets), 'utf8').replaceAll('\r\n', '\n');
  const oldCT = presetSource.match(/  CT: \[\n[\s\S]*?\n  \],/g);
  if (oldCT?.length !== 1 || !oldCT[0].includes("window: '2500', level: '480'")) throw Error('Pinned OHIF CT presets changed');
  replace(presets, oldCT[0], '  CT: ' + JSON.stringify(ctPresets, null, 2) + ',');
  const commands = 'extensions/cornerstone/src/commandsModule.ts';
  replace(commands, '  getEnabledElement,', '  metaData,\n  getEnabledElement,');
  replace(commands, 'const { add, intersect, subtract, copy }', fullDynamicRange.toString() + '\n' + isWindowingInput.toString() + '\n\nconst { add, intersect, subtract, copy }');
  replace(commands, '    setWindowLevelPreset: ({ presetName, presetIndex }) => {', `    risproWindowing: ({ mode, presetName, presetIndex }) => {
      if (isWindowingInput(document.activeElement)) return;
      const viewportId = viewportGridService.getActiveViewportId();
      const group = toolGroupService.getToolGroupForViewport(viewportId);
      if (!['default', 'mpr'].includes(group?.id)) return;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);
      const imageId = viewport?.getCurrentImageId?.();
      const instance = imageId ? metaData.get('instance', imageId) : undefined;
      const modality = instance?.Modality ?? viewport?.getImageData?.()?.metadata?.Modality;
      if (!['CT', 'MR'].includes(modality)) return;
      const image = viewport instanceof StackViewport ? viewport.getCornerstoneImage() : undefined;
      if (image?.color || image?.numberOfComponents > 1 ||
          (instance?.PhotometricInterpretation && !instance.PhotometricInterpretation.startsWith('MONOCHROME'))) return;
      if (mode === 'preset') {
        if (modality === 'CT') {
          viewport.setProperties({ VOILUTFunction: CoreEnums.VOILUTFunctionType.LINEAR });
          actions.setWindowLevelPreset({ presetName, presetIndex });
        }
        return;
      }
      // A reconstructed plane has no decoded stack image: do not scan a volume.
      if (!image || image.imageId !== imageId) return;
      if (mode === 'dynamic') {
        const range = fullDynamicRange(image, instance || {});
        if (!range) return;
        viewport.setProperties({ VOILUTFunction: CoreEnums.VOILUTFunctionType.LINEAR });
        actions.setViewportWindowLevel({ viewportId, ...csUtils.windowLevel.toWindowLevel(range.lower, range.upper) });
      } else if (mode === 'original') {
        const voi = metaData.get('voiLutModule', imageId);
        const windowWidth = Number(voi?.windowWidth?.[0] ?? image.windowWidth);
        const windowCenter = Number(voi?.windowCenter?.[0] ?? image.windowCenter);
        const VOILUTFunction = voi?.voiLUTFunction || image.voiLUTFunction || CoreEnums.VOILUTFunctionType.LINEAR;
        if (!Number.isFinite(windowWidth) || windowWidth <= 0 || !Number.isFinite(windowCenter)) return;
        viewport.setProperties({ VOILUTFunction,
          voiRange: csUtils.windowLevel.toLowHighRange(windowWidth, windowCenter, VOILUTFunction) });
        viewport.render();
      }
    },
    setWindowLevelPreset: ({ presetName, presetIndex }) => {`);
  replace(commands, '    setWindowLevelPreset: {\n      commandFn:', '    risproWindowing: { commandFn: actions.risproWindowing },\n    setWindowLevelPreset: {\n      commandFn:');
}

function configureViewer(root) {
  configureUsability(root);
  configureLoading(root);
  configureResponsive(root);
  configureSeriesWindowing(root);
  const webpack = path.join(root, '.webpack/webpack.base.js');
  const webpackSource = fs.readFileSync(webpack, 'utf8');
  const rulesAnchor = 'noParse: [/(dicomicc)/],\n      rules: [';
  if (webpackSource.split(rulesAnchor).length !== 2) throw Error('Pinned Webpack rules changed');
  // ONNX's browser ESM guards access to the Node-only __filename. Webpack's
  // NodeStuffPlugin evaluates that guard as true in ESM without supplying the
  // identifier. Preserve the dependency's browser guard; do not polyfill it.
  fs.writeFileSync(webpack, webpackSource.replace(rulesAnchor, rulesAnchor + `
        { test: /[\\\\/]onnxruntime-web[\\\\/]dist[\\\\/]esm[\\\\/]/, parser: { node: false } },`));

  const serviceWorker = path.join(root, 'platform/app/public/init-service-worker.js');
  const serviceWorkerSource = fs.readFileSync(serviceWorker, 'utf8');
  const registration = 'navigator.serviceWorker.getRegistrations().then';
  if (!serviceWorkerSource.startsWith(registration)) throw Error('Pinned service worker bootstrap changed');
  // navigator.serviceWorker is unavailable on ordinary hospital-LAN HTTP.
  fs.writeFileSync(serviceWorker, serviceWorkerSource.replace(registration, "if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then"));

  const lookup = path.join(root, 'extensions/default/src/Panels/getStudiesForPatientByMRN.js');
  if (!fs.readFileSync(lookup, 'utf8').includes('patientId: mrn')) throw Error('Pinned study browser integration changed');
  fs.writeFileSync(lookup, getStudiesForPatientByMRN.toString() + '\nexport default getStudiesForPatientByMRN;\n');

  const hp = path.join(root, 'extensions/default/src/getHangingProtocolModule.js');
  const source = fs.readFileSync(hp, 'utf8');
  const anchor = 'seriesMatchingRules: [';
  if (source.split(anchor).length !== 2) throw Error('Pinned default hanging protocol changed');
  // Weighted preferences preserve document-only fallback and explicit URL
  // selection (weight 20). MPR/comparison protocols and manual selection stay intact.
  fs.writeFileSync(hp, source.replace(anchor, anchor + '\n' + diagnosticSeriesRules.map(rule => JSON.stringify(rule) + ',').join('\n')));
}

module.exports = { configureViewer, configureUsability, fullDynamicRange, isWindowingInput, ctPresets, configureLoading, trackCachedFrames, isDiagnosticReady, getStudiesForPatientByMRN, diagnosticSeriesRules };
if (require.main === module) configureViewer(process.cwd());
