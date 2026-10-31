const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getStudiesForPatientByMRN, diagnosticSeriesRules } = require('./configure-viewer.cjs');
const { prioritizeSeries, loadProgressively, waitForDiagnosticImage } = require('./configure-progressive.cjs');

test('progressive QIDO priority preserves sidebar input, explicit series, count evidence and stable ties', () => {
  const series = [
    { SeriesInstanceUID: '1', Modality: 'MR', SeriesDescription: 'localizer', NumberOfSeriesRelatedInstances: 3 },
    { SeriesInstanceUID: '2', Modality: 'SR' },
    { SeriesInstanceUID: '3', Modality: 'MR', NumberOfSeriesRelatedInstances: 40 },
    { SeriesInstanceUID: '4', Modality: 'MR', SeriesDescription: 'unknown', NumberOfSeriesRelatedInstances: 1 },
    { SeriesInstanceUID: '5', Modality: 'MR', NumberOfFrames: 100 },
    { SeriesInstanceUID: '6', Modality: 'MR', ImageType: ['ORIGINAL', 'LOCALIZER'] },
  ];
  assert.deepEqual(prioritizeSeries(series, diagnosticSeriesRules).map(s => s.SeriesInstanceUID), ['3', '5', '4', '1', '6', '2']);
  assert.equal(series[0].SeriesInstanceUID, '1');
  assert.equal(prioritizeSeries(series, diagnosticSeriesRules, '?initialSeriesInstanceUID=5')[0].SeriesInstanceUID, '5');
  assert.equal(prioritizeSeries(series, diagnosticSeriesRules, '?initialseriesinstanceuid=1')[0].SeriesInstanceUID, '1');
  assert.equal(prioritizeSeries([
    { SeriesInstanceUID: 'short', Modality: 'MR', NumberOfSeriesRelatedInstances: 2 },
    { SeriesInstanceUID: 'stack', Modality: 'MR', NumberOfSeriesRelatedInstances: 32 },
  ], diagnosticSeriesRules)[0].SeriesInstanceUID, 'stack');
  const studies = [
    { metadata: { StudyInstanceUID: '1', SeriesInstanceUID: '1.1', Modality: 'MR', NumberOfSeriesRelatedInstances: 32 } },
    { metadata: { StudyInstanceUID: '2', SeriesInstanceUID: '2.1', Modality: 'MR', NumberOfSeriesRelatedInstances: 16 } },
  ];
  assert.equal(prioritizeSeries(studies, diagnosticSeriesRules, '?initialSeriesInstanceUID=2.1', p => p.metadata)[0], studies[1]);
});

test('series-level QIDO ranking needs no SOP class, ImageType or NumberOfFrames', () => {
  const series = [
    { SeriesInstanceUID: '1', Modality: 'MR', SeriesNumber: 1, SeriesDescription: 'Scout', NumberOfSeriesRelatedInstances: 2 },
    { SeriesInstanceUID: '2', Modality: 'MR', SeriesNumber: 2, NumberOfSeriesRelatedInstances: 2 },
    { SeriesInstanceUID: '3', Modality: 'MR', SeriesNumber: 3, NumberOfSeriesRelatedInstances: 32 },
    { SeriesInstanceUID: '4', Modality: 'MR', SeriesNumber: 4, NumberOfSeriesRelatedInstances: 32 },
    { SeriesInstanceUID: '5', Modality: 'SR', SeriesNumber: 5 },
  ];
  assert.deepEqual(prioritizeSeries(series, diagnosticSeriesRules).map(s => s.SeriesInstanceUID), ['3', '4', '2', '1', '5']);
  assert.equal(prioritizeSeries(series, diagnosticSeriesRules, '?initialSeriesInstanceUID=1')[0], series[0]);
  const withoutCounts = series.map(({ NumberOfSeriesRelatedInstances, ...metadata }) => metadata);
  assert.deepEqual(prioritizeSeries(withoutCounts, diagnosticSeriesRules).map(s => s.SeriesInstanceUID), ['2', '3', '4', '1', '5']);
  const optionalClasses = [series[2], { ...series[3], SOPClassesInSeries: '1.2.840.10008.5.1.4.1.1.4' }];
  assert.equal(prioritizeSeries(optionalClasses, diagnosticSeriesRules)[0], optionalClasses[0]);
});

function diagnosticGateFixture() {
  const target = new EventTarget(), eventTarget = new EventTarget();
  const core = { eventTarget, Enums: {
    Events: { IMAGE_RENDERED: 'render', IMAGE_LOAD_ERROR: 'error', IMAGE_LOAD_FAILED: 'failed' },
    ViewportType: { STACK: 'stack' }, RequestType: { Thumbnail: 'thumbnail', Prefetch: 'prefetch' },
  } };
  const viewport = { type: 'stack', imageId: '/series/1/frames/1', rendered: false,
    getImageIds: () => ['/series/1/frames/1', '/series/1/frames/2', '/series/2/frames/1'],
    getCurrentImageId() { return this.imageId; } };
  return { target, core, viewport, wait: timeout => waitForDiagnosticImage(() => viewport, '1', core, v => v.rendered, target, timeout) };
}

test('neighbor, thumbnail, prefetch and unrelated-series failures leave the selected diagnostic frame pending', async () => {
  const f = diagnosticGateFixture(), waiting = f.wait();
  let outcome;
  waiting.promise.then(value => { outcome = value; });
  for (const detail of [
    { imageId: '/series/1/frames/2' }, { imageId: '/series/2/frames/1' },
    { imageId: f.viewport.imageId, requestType: 'thumbnail' },
    { imageId: f.viewport.imageId, requestType: 'prefetch' },
  ]) f.core.eventTarget.dispatchEvent(new CustomEvent('failed', { detail }));
  await Promise.resolve(); assert.equal(outcome, undefined);
  // A viewport transitioning to another series must not fail this series' wait.
  f.viewport.imageId = '/series/2/frames/1';
  f.target.dispatchEvent(new CustomEvent('error', { detail: { imageId: f.viewport.imageId } }));
  await Promise.resolve(); assert.equal(outcome, undefined);
  f.viewport.imageId = '/series/1/frames/1'; f.viewport.rendered = true;
  f.target.dispatchEvent(new Event('render'));
  assert.equal(await waiting.promise, true);
});

test('actual selected diagnostic frame failure triggers fallback once and removes every listener', async () => {
  const f = diagnosticGateFixture(), removals = [];
  for (const target of [f.target, f.core.eventTarget]) {
    const remove = target.removeEventListener.bind(target);
    target.removeEventListener = (...args) => { removals.push(args[0]); return remove(...args); };
  }
  const waiting = f.wait(); let resolutions = 0;
  waiting.promise.then(() => resolutions++);
  f.core.eventTarget.dispatchEvent(new CustomEvent('failed', { detail: { imageId: f.viewport.imageId } }));
  assert.equal(await waiting.promise, false);
  f.viewport.rendered = true; f.target.dispatchEvent(new Event('render')); waiting.cancel();
  await Promise.resolve(); assert.equal(resolutions, 1);
  assert.deepEqual(removals.sort(), ['error', 'failed', 'render']);
});

test('selected-frame failure cannot undo diagnostic pixels that have already rendered', async () => {
  const f = diagnosticGateFixture(), waiting = f.wait();
  await Promise.resolve();
  f.viewport.rendered = true;
  // Even if the render event was missed, check the actual pixels before failing.
  f.core.eventTarget.dispatchEvent(new CustomEvent('failed', { detail: { imageId: f.viewport.imageId } }));
  assert.equal(await waiting.promise, true);
});

test('the bounded watchdog accepts diagnostic rendering after the old 30-second limit', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = diagnosticGateFixture(), waiting = f.wait(); let outcome;
  waiting.promise.then(value => { outcome = value; });
  await Promise.resolve(); t.mock.timers.tick(45000);
  await Promise.resolve(); assert.equal(outcome, undefined);
  f.viewport.rendered = true; f.target.dispatchEvent(new Event('render'));
  assert.equal(await waiting.promise, true);
  t.mock.timers.tick(120000); waiting.cancel();
});

test('a stalled render times out at 120 seconds and tests may inject a shorter bound', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = diagnosticGateFixture(), waiting = f.wait(); let outcome;
  waiting.promise.then(value => { outcome = value; });
  await Promise.resolve(); t.mock.timers.tick(119999);
  await Promise.resolve(); assert.equal(outcome, undefined);
  t.mock.timers.tick(1); assert.equal(await waiting.promise, false);
  const short = f.wait(25);
  await Promise.resolve(); t.mock.timers.tick(25);
  assert.equal(await short.promise, false);
});

test('watchdog performs a final diagnostic-pixel check before timing out', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = diagnosticGateFixture(), waiting = f.wait(25);
  await Promise.resolve(); f.viewport.rendered = true;
  t.mock.timers.tick(25);
  assert.equal(await waiting.promise, true);
});

test('progressive metadata waits for real pixels, falls back from failed/unsupported series and is serial after render', async () => {
  const trace = [], sets = [], releases = [];
  let resolveRender;
  const rendered = new Promise(resolve => { resolveRender = resolve; });
  const promises = ['failed', 'document', 'diagnostic', 'background', 'last'].map(uid => ({
    metadata: { SeriesInstanceUID: uid },
    start() {
      if (this.internalPromise) return this.internalPromise;
      trace.push(uid);
      this.internalPromise = uid === 'failed' ? Promise.reject(Error('synthetic metadata failure'))
        : uid === 'background' ? new Promise(resolve => releases.push(resolve)) : Promise.resolve();
      if (uid !== 'failed') sets.push({ SeriesInstanceUID: uid, unsupported: uid === 'document', numImageFrames: 10 });
      return this.internalPromise;
    },
  }));
  const stop = await loadProgressively({ promises, services: {
    displaySetService: { getActiveDisplaySets: () => sets },
    cornerstoneViewportService: { getCornerstoneViewport: () => ({}) },
    viewportGridService: { getActiveViewportId: () => 'v' },
    uiNotificationService: { show: assert.fail },
  }, apply: uid => trace.push('hang:' + uid),
  waitForImage: () => ({ promise: rendered, cancel() {} }), isReady: () => true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace, ['failed', 'document', 'diagnostic', 'hang:diagnostic']);
  resolveRender(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(trace.at(-1), 'background');
  assert.ok(!trace.includes('last'));
  releases[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(trace.at(-1), 'last');
  stop();
});

test('render gate ignores metadata/blank renders, releases on pixels or error and cleans listeners', async () => {
  const target = new EventTarget(), eventTarget = new EventTarget();
  const core = { Enums: { Events: { IMAGE_RENDERED: 'render', IMAGE_LOAD_ERROR: 'error', IMAGE_LOAD_FAILED: 'failed' } }, eventTarget };
  let pixels = false;
  const viewport = { getImageIds: () => ['/series/1/frames/1'], getCurrentImageId: () => '/series/1/frames/1' };
  const waiting = waitForDiagnosticImage(() => viewport, '1', core, () => pixels, target);
  let settled = false; waiting.promise.then(() => { settled = true; });
  target.dispatchEvent(new Event('render'));
  await Promise.resolve(); assert.equal(settled, false);
  pixels = true; target.dispatchEvent(new Event('render'));
  assert.equal(await waiting.promise, true);
  const failure = waitForDiagnosticImage(() => viewport, '1', core, () => false, target);
  eventTarget.dispatchEvent(new CustomEvent('failed', { detail: { imageId: '/series/1/frames/1' } }));
  assert.equal(await failure.promise, false);
  const canceled = waitForDiagnosticImage(() => viewport, '1', core, () => false, target);
  canceled.cancel(); assert.equal(await canceled.promise, false);
});

test('exhausted progressive candidates show a terminal error and unmount prevents later metadata starts', async () => {
  const previousDocument = global.document, target = new EventTarget();
  global.document = target;
  let exhausted = false, notified = false;
  target.addEventListener('rispro-initial-image-failed', () => { exhausted = true; });
  const services = { displaySetService: { getActiveDisplaySets: () => [] },
    cornerstoneViewportService: {}, viewportGridService: {}, uiNotificationService: { show: () => { notified = true; } } };
  try {
    const stop = await loadProgressively({ promises: [], services, apply() {}, waitForImage() {}, isReady() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(exhausted, true); assert.equal(notified, true); stop();
    let release, started = 0;
    const promises = [
      { metadata: {}, start: () => new Promise(resolve => { release = resolve; }) },
      { metadata: {}, start: () => { started++; return Promise.resolve(); } },
    ];
    const cancel = await loadProgressively({ promises, services, apply() {}, waitForImage() {}, isReady() {} });
    cancel(); release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(started, 0);
  } finally { global.document = previousDocument; }
});
const { protectBootstrapHtml } = require('./verify-browser-build.cjs');
const { verifyMinifiedOnnxGuard } = require('./verify-browser-build.cjs');

test('minified ONNX initializer works in async chunks/workers and rejects a lost filename guard', () => {
  const source = 'var t,n=(t=typeof document<"u"&&document.currentScript?document.currentScript.src:void 0,typeof __filename<"u"&&(t=t||__filename),function(e={}){return e});';
  verifyMinifiedOnnxGuard(source, 'synthetic-minified.js');
  assert.throws(() => verifyMinifiedOnnxGuard(source.replace('typeof __filename<"u"', 'true'), 'broken.js'), /__filename is not defined/);
});
const { configureLoading, loadingSource, trackCachedFrames, isDiagnosticReady } = require('./configure-viewer.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { configureUsability, fullDynamicRange, isWindowingInput, ctPresets } = require('./configure-viewer.cjs');

test('Full Dynamic uses decoded signed samples, rescale once, padding ranges and finite pixels only', () => {
  const image = { getPixelData: () => new Int16Array([-2048, -2047, -100, 0, 100]), slope: 2, intercept: -1024 };
  const instance = { PixelRepresentation: 1, PixelPaddingValue: -2048, PixelPaddingRangeLimit: -2047 };
  assert.deepEqual(fullDynamicRange(image, instance), { lower: -1224, upper: -824 });
  image.preScale = { scaled: true, scalingParameters: { rescaleSlope: 2, rescaleIntercept: -1024 } };
  image.getPixelData = () => new Float32Array([-5120, -5118, -1224, -824, NaN]);
  assert.deepEqual(fullDynamicRange(image, instance), { lower: -1224, upper: -824 });
  image.preScale = { scaled: false };
  image.slope = -2;
  image.getPixelData = () => new Int16Array([-100, 100]);
  assert.deepEqual(fullDynamicRange(image, {}), { lower: -1224, upper: -824 });
  image.getPixelData = () => new Int16Array([7, 7]);
  assert.deepEqual(fullDynamicRange(image, {}), { lower: -1038, upper: -1038 });
  assert.equal(fullDynamicRange(image, { PixelPaddingValue: 7 }), undefined);
  assert.equal(fullDynamicRange({ ...image, color: true }, {}), undefined);
  assert.equal(fullDynamicRange({ ...image, numberOfComponents: 3 }, {}), undefined);
});

test('windowing input guard covers editors, fields and ARIA input controls', () => {
  for (const selector of ['input', 'textarea', 'select', '[contenteditable]', '[role="textbox"]', '[role="combobox"]', '[role="spinbutton"]']) {
    const element = { closest: query => query.includes(selector.replace('[contenteditable]', '[contenteditable]:not([contenteditable="false"])')) };
    assert.equal(isWindowingInput(element), true);
  }
  assert.equal(isWindowingInput({ closest: () => null }), false);
  assert.equal(isWindowingInput(null), false);
});

function usabilityFixture(root) {
  const write = (file, source) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), source);
  };
  const diagnostic = `const tools = { active: [
      {
        toolName: toolNames.WindowLevel,
        bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
      },
      {
        toolName: toolNames.Pan,
        bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
      },
      { toolName: toolNames.Zoom, bindings: [{ mouseButton: Enums.MouseBindings.Secondary }] },
      { toolName: toolNames.StackScroll,
        bindings: [{ mouseButton: Enums.MouseBindings.Wheel }, { numTouchPoints: 3 }],
      }],
    passive: [
      { toolName: toolNames.Length },
      { toolName: toolNames.StackScroll },
    ] }; return tools;`;
  write('modes/basic/src/initToolGroups.ts', `function initDefaultToolGroup() { ${diagnostic} }\nfunction initSRToolGroup() { return 'SR unchanged'; }\nfunction initMPRToolGroup() { ${diagnostic} }\nfunction initVolume3DToolGroup() { return '3D unchanged'; }`);
  write('platform/core/src/defaults/hotkeyBindings.ts', 'const bindings = [\n' + [
    ['ct-soft-tissue', 0], ['ct-lung', 1], ['ct-bone', 2], ['ct-brain', 3],
  ].map(([id, index]) => `  {
    commandName: 'setWindowLevelPreset',
    commandOptions: { presetName: '${id}', presetIndex: ${index} },
    label: 'W/L Preset ${index + 1}',
    keys: ['${index + 1}'],
  },`).join('\n') + '\n{ keys: ["z"], commandName: "setToolActive" }];');
  write('extensions/cornerstone/src/components/WindowLevelActionMenu/defaultWindowLevelPresets.ts', `const presets = {
  CT: [
    { id: 'ct-bone', window: '2500', level: '480' },
  ],
  PT: ['unchanged'],
};`);
  write('extensions/cornerstone/src/commandsModule.ts', `import {
  getEnabledElement,
} from '@cornerstonejs/core';
const { add, intersect, subtract, copy } = {};
const actions = {
    setWindowLevelPreset: ({ presetName, presetIndex }) => {},
};
const definitions = {
    setWindowLevelPreset: {
      commandFn: actions.setWindowLevelPreset,
    },
};`);
}

test('pinned patches preserve specialized groups, selectable tools, nonnumeric keys and modality presets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rispro-usability-'));
  try {
    usabilityFixture(root);
    configureUsability(root);
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const groups = vm.runInNewContext(read('modes/basic/src/initToolGroups.ts') + '; [initDefaultToolGroup(), initMPRToolGroup(), initSRToolGroup(), initVolume3DToolGroup()]', {
      toolNames: Object.fromEntries(['WindowLevel', 'StackScroll', 'Zoom', 'Pan', 'Length'].map(name => [name, name])),
      Enums: { MouseBindings: { Primary: 1, Auxiliary: 4, Secondary: 2, Wheel: 524288 } },
    });
    for (const group of groups.slice(0, 2)) {
      assert.equal(group.active.find(t => t.bindings.some(b => b.mouseButton === 1)).toolName, 'StackScroll');
      assert.equal(group.active.find(t => t.bindings.some(b => b.mouseButton === 4)).toolName, 'WindowLevel');
      assert.equal(group.active.find(t => t.bindings.some(b => b.mouseButton === 2)).toolName, 'Zoom');
      assert.ok(group.active.find(t => t.toolName === 'StackScroll').bindings.some(b => b.mouseButton === 524288));
      assert.deepEqual(Array.from(group.passive, t => t.toolName), ['Pan', 'Length']);
    }
    assert.deepEqual(Array.from(groups.slice(2)), ['SR unchanged', '3D unchanged']);
    const keys = vm.runInNewContext(read('platform/core/src/defaults/hotkeyBindings.ts') + '; bindings');
    assert.deepEqual(Array.from(keys.slice(0, 9), b => b.keys[0]), ['0','1','2','3','4','5','6','7','8']);
    assert.deepEqual(Array.from(keys.slice(2, 9), b => b.commandOptions.presetIndex), [0,1,2,3,4,5,6]);
    assert.equal(keys.at(-1).keys[0], 'z');
    const presets = vm.runInNewContext(read('extensions/cornerstone/src/components/WindowLevelActionMenu/defaultWindowLevelPresets.ts') + '; presets');
    assert.deepEqual(JSON.parse(JSON.stringify(presets.CT)), ctPresets);
    assert.equal(presets.PT[0], 'unchanged');
    assert.deepEqual(ctPresets.map(p => [p.description, Number(p.level), Number(p.window)]), [
      ['Abdomen',60,400], ['CT Angio',300,600], ['Bone',300,1500], ['Brain',40,80], ['Chest',40,400], ['Lung',-400,1500], ['Liver',90,150],
    ]);
    const source = read('extensions/cornerstone/src/commandsModule.ts');
    const actionSource = source.slice(source.indexOf('    risproWindowing:'), source.indexOf('    setWindowLevelPreset: ({'));
    const calls = [];
    class StackViewport {
      getCurrentImageId() { return 'loaded'; }
      getCornerstoneImage() { return { imageId: 'loaded', getPixelData: () => new Int16Array([-100, 300]), windowWidth: 80, windowCenter: 40 }; }
      setProperties(value) { calls.push(value); }
      render() { calls.push('render'); }
    }
    const viewport = new StackViewport();
    const instance = { Modality: 'CT' };
    const document = { activeElement: null };
    const context = {
      document, StackViewport, fullDynamicRange, isWindowingInput,
      viewportGridService: { getActiveViewportId: () => 'active' },
      toolGroupService: { getToolGroupForViewport: () => ({ id: 'default' }) },
      cornerstoneViewportService: { getCornerstoneViewport: id => { assert.equal(id, 'active'); return viewport; } },
      metaData: { get: type => type === 'instance' ? instance : { windowWidth: [400], windowCenter: [60], voiLUTFunction: 'LINEAR' } },
      CoreEnums: { VOILUTFunctionType: { LINEAR: 'LINEAR' } },
      csUtils: { windowLevel: {
        toWindowLevel: (lower, upper) => ({ windowWidth: upper - lower + 1, windowCenter: (lower + upper + 1) / 2 }),
        toLowHighRange: (w, c) => ({ lower: c - 0.5 - (w - 1) / 2, upper: c - 0.5 + (w - 1) / 2 }),
      } },
      actions: { setViewportWindowLevel: value => calls.push(value), setWindowLevelPreset: value => calls.push(value) },
    };
    const action = vm.runInNewContext('({' + actionSource + '}).risproWindowing', context);
    action({ mode: 'dynamic' });
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1])), { viewportId: 'active', windowWidth: 401, windowCenter: 100.5 });
    calls.length = 0;
    action({ mode: 'original' });
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ VOILUTFunction: 'LINEAR', voiRange: { lower: -140, upper: 259 } }, 'render']);
    calls.length = 0;
    action({ mode: 'preset', presetName: 'ct-liver', presetIndex: 6 });
    assert.equal(calls[1].presetName, 'ct-liver');
    assert.equal(calls[1].presetIndex, 6);
    calls.length = 0;
    instance.Modality = 'MR';
    action({ mode: 'preset', presetName: 'ct-liver' });
    assert.equal(calls.length, 0);
    document.activeElement = { closest: () => true };
    action({ mode: 'dynamic' });
    assert.equal(calls.length, 0);
    assert.throws(() => configureUsability(root), /Pinned OHIF diagnostic bindings changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('NCCB branding uses the existing header hook and static Docker asset', () => {
  const window = { location: { search: '' } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app-config.js'), 'utf8'), { window, URLSearchParams });
  const logo = window.config.whiteLabeling.createLogoComponentFn({ createElement: (tag, props, ...children) => ({ tag, props, children }) });
  assert.equal(logo.children[0].props.src, '/ohif/assets/nccb-logo.png');
  assert.equal(logo.children[1].children[0], 'NCCB');
  assert.match(fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8'), /COPY frontend\/public\/assets\/nccb-logo.png platform\/app\/public\/assets\/nccb-logo.png/);
});

test('active synthetic CT/MRI frames count cached successes, failures, eviction and series switching without loading images', () => {
  const target = new EventTarget();
  const events = Object.fromEntries(['IMAGE_LOADED','IMAGE_LOAD_FAILED','IMAGE_CACHE_IMAGE_ADDED','IMAGE_CACHE_IMAGE_REMOVED'].map(name => [name,name]));
  const cached = new Set(['ct1']);
  const cache = { isLoaded: id => cached.has(id), getImage: id => cached.has(id) ? { imageId: id } : undefined };
  const updates = [];
  const send = (type, id) => { const event = new Event(type); event.detail = { imageId: id }; target.dispatchEvent(event); };
  const stop = trackCachedFrames(['ct1','ct2','ct3'], cache, target, events, value => updates.push(value));
  assert.deepEqual(updates.at(-1), {loaded:1,total:3,failed:0});
  send(events.IMAGE_LOAD_FAILED,'ct2');
  assert.deepEqual(updates.at(-1), {loaded:1,total:3,failed:1});
  send(events.IMAGE_LOADED,'ct3'); // Load event alone is not proof of a cached frame.
  assert.equal(updates.at(-1).loaded,1);
  cached.add('ct3'); send(events.IMAGE_CACHE_IMAGE_ADDED,'ct3');
  assert.deepEqual(updates.at(-1), {loaded:2,total:3,failed:1});
  cached.add('ct2'); send(events.IMAGE_CACHE_IMAGE_ADDED,'ct2');
  assert.deepEqual(updates.at(-1), {loaded:3,total:3,failed:0});
  cached.delete('ct1'); send(events.IMAGE_CACHE_IMAGE_REMOVED,'ct1');
  assert.equal(updates.at(-1).loaded,2);
  stop();
  const count = updates.length;
  send(events.IMAGE_LOAD_FAILED,'ct3');
  assert.equal(updates.length,count);
  cached.add('mr1');
  const stopMR = trackCachedFrames(['mr1','mr2'],cache,target,events,value => updates.push(value));
  send(events.IMAGE_LOAD_FAILED,'ct1');
  assert.deepEqual(updates.at(-1), {loaded:1,total:2,failed:0});
  stopMR();
});

test('cold, warm, blank and volume readiness require a completed render and real pixels', () => {
  const viewport = { viewportStatus:'loading', getCurrentImageId: () => 'ct1',
    getCornerstoneImage: () => ({imageId:'ct1',getPixelData:() => new Uint16Array([1,2])}) };
  assert.equal(isDiagnosticReady(viewport,'rendered'),false);
  viewport.viewportStatus='rendered';
  assert.equal(isDiagnosticReady(viewport,'rendered'),true); // Also handles pre-listener render.
  viewport.getCurrentImageId=()=>'ct2';
  assert.equal(isDiagnosticReady(viewport,'rendered'),false);
  assert.equal(isDiagnosticReady({viewportStatus:'rendered',getImageData:()=>({scalarData:new Uint16Array([1])})},'rendered'),true);
  assert.equal(isDiagnosticReady({viewportStatus:'rendered',getImageData:()=>({})},'rendered'),false);
});

test('pinned loading patches fail closed if the upstream layout changes', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rispro-loading-test-'));
  try {
    fs.mkdirSync(path.join(root,'extensions/default/src/ViewerLayout'),{recursive:true});
    fs.writeFileSync(path.join(root,'extensions/default/src/ViewerLayout/index.tsx'),'upstream changed');
    assert.throws(()=>configureLoading(root),/Pinned OHIF loading integration changed/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('first-image readiness accepts any current acquisition and never a genuine prior', () => {
  const source=loadingSource.slice(loadingSource.indexOf('export function useFirstDiagnosticImage'),loadingSource.indexOf('export function InitialImageLoading')).replace('export function','function');
  for(const [study,expected] of [['1.2.1',true],['1.2.2',true],['1.2.9',false]]){
    const states=[];
    const viewport={viewportStatus:'rendered',getCurrentImageId:()=>study,getCornerstoneImage:()=>({imageId:study,getPixelData:()=>new Uint16Array([1])})};
    const servicesManager={services:{
      cornerstoneViewportService:{getCornerstoneViewport:()=>viewport,EVENTS:{VIEWPORT_DATA_CHANGED:'changed'},subscribe:()=>({unsubscribe(){}})},
      displaySetService:{getDisplaySetByUID:()=>({StudyInstanceUID:study,Modality:'MR'})},
    }};
    const hook=vm.runInNewContext(source+';useFirstDiagnosticImage',{
      useViewportGrid:()=>[{activeViewportId:'active',viewports:new Map([['active',{displaySetInstanceUIDs:['set']}]])}],
      useImageViewer:()=>({StudyInstanceUIDs:['1.2.1','1.2.2']}),useState:()=>['loading',s=>states.push(s)],useLayoutEffect:effect=>effect(),
      isDiagnosticReady,Enums:{ViewportStatus:{RENDERED:'rendered'},Events:{},ViewportType:{STACK:'stack'}},
      document:new EventTarget(),eventTarget:new EventTarget(),cache:{getImageLoadObject:()=>null},
      window:{config:{}},
    });
    hook(servicesManager,true);
    assert.equal(states.includes('ready'),expected);
  }
});

function firstImageHookFixture(progressive) {
  const target = new EventTarget(), eventTarget = new EventTarget(), states = [];
  const Enums = { ViewportStatus: { RENDERED: 'rendered' }, ViewportType: { STACK: 'stack' },
    Events: { IMAGE_RENDERED: 'render', IMAGE_LOAD_ERROR: 'error', IMAGE_LOAD_FAILED: 'failed' } };
  let rejectImage, cleanup;
  const imagePromise = new Promise((resolve, reject) => { rejectImage = reject; });
  const viewport = { type: 'stack', viewportStatus: 'loading', imageId: '/series/1/frames/1',
    getCurrentImageId() { return this.imageId; }, getImageIds() { return [this.imageId]; },
    getCornerstoneImage() { return { imageId: this.imageId, getPixelData: () => new Uint16Array([1]) }; } };
  const services = {
    cornerstoneViewportService: { getCornerstoneViewport: () => viewport,
      EVENTS: { VIEWPORT_DATA_CHANGED: 'changed' }, subscribe: () => ({ unsubscribe() {} }) },
    viewportGridService: { getActiveViewportId: () => 'active' },
    displaySetService: { getDisplaySetByUID: () => ({ StudyInstanceUID: 'study', Modality: 'MR' }),
      getActiveDisplaySets: () => ['1', '2'].map(SeriesInstanceUID => ({ SeriesInstanceUID, Modality: 'MR', numImageFrames: 10 })) },
    uiNotificationService: { show() {} },
  };
  const source = loadingSource.slice(loadingSource.indexOf('export function useFirstDiagnosticImage'), loadingSource.indexOf('export function InitialImageLoading')).replace('export function', 'function');
  const hook = vm.runInNewContext(source + ';useFirstDiagnosticImage', {
    useViewportGrid: () => [{ activeViewportId: 'active', viewports: new Map([['active', { displaySetInstanceUIDs: ['set'] }]]) }],
    useImageViewer: () => ({ StudyInstanceUIDs: ['study'] }), useState: () => ['loading', state => states.push(state)],
    useLayoutEffect: effect => { cleanup = effect(); }, isDiagnosticReady, Enums,
    window: { config: { risproProgressiveLoading: progressive } }, document: target, eventTarget,
    cache: { getImageLoadObject: () => ({ promise: imagePromise }) },
  });
  assert.equal(hook({ services }, true), 'loading');
  return { target, viewport, states, services, rejectImage, cleanup,
    core: { Enums, eventTarget }, state: () => states.at(-1) || 'loading' };
}

test('progressive overlay stays loading through a failed candidate and errors only on exhaustion', async () => {
  const previousDocument = global.document;
  try {
    for (const recover of [true, false]) {
      const f = firstImageHookFixture(true), applied = [];
      global.document = f.target;
      let exhausted = 0;
      f.target.addEventListener('rispro-initial-image-failed', () => exhausted++);
      const promises = ['1', '2'].map(SeriesInstanceUID => ({ metadata: { SeriesInstanceUID },
        start() { return this.internalPromise ||= Promise.resolve(); } }));
      const stop = await loadProgressively({ promises, services: f.services,
        apply: uid => { if (uid) { applied.push(uid); f.viewport.imageId = '/series/' + uid + '/frames/1'; } },
        waitForImage: (getViewport, uid) => waitForDiagnosticImage(getViewport, uid, f.core, v => isDiagnosticReady(v, 'rendered'), f.target),
        isReady: v => isDiagnosticReady(v, 'rendered') });
      try {
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(applied, ['1']);
        f.rejectImage(Error('selected frame failed'));
        f.core.eventTarget.dispatchEvent(new CustomEvent('failed', { detail: { imageId: f.viewport.imageId } }));
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(applied, ['1', '2']);
        assert.equal(f.state(), 'loading'); assert.equal(exhausted, 0);
        if (recover) {
          f.viewport.viewportStatus = 'rendered'; f.target.dispatchEvent(new Event('render'));
        } else f.target.dispatchEvent(new CustomEvent('error', { detail: { imageId: f.viewport.imageId } }));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.state(), recover ? 'ready' : 'error');
        assert.equal(exhausted, recover ? 0 : 1);
      } finally { stop(); f.cleanup(); }
    }
  } finally { global.document = previousDocument; }
});

test('non-progressive overlay retains individual frame-event and cached-promise errors', async () => {
  for (const failure of ['event', 'promise']) {
    const f = firstImageHookFixture(false);
    try {
      if (failure === 'event') f.target.dispatchEvent(new CustomEvent('error', { detail: { imageId: f.viewport.imageId } }));
      else f.rejectImage(Error('selected baseline frame failed'));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.state(), 'error');
    } finally { f.cleanup(); }
  }
});

test('all bootstrap scripts opt out of CDN script rewriting before src without changing their load order',()=>{
  const html='<script>window.x=1;</script><script src="app-config.js"></script><script type="module" src="init-service-worker.js"></script><script defer src="app.bundle.hash.js"></script>';
  const protectedHtml=protectBootstrapHtml(html);
  assert.equal((protectedHtml.match(/data-cfasync="false"/g)||[]).length,4);
  assert.equal(protectedHtml.replaceAll(' data-cfasync="false"',''),html);
  assert.equal(protectBootstrapHtml(protectedHtml),protectedHtml);
});

test('study browser loads session-scoped pages as summaries without image requests', async () => {
  const previousFetch = global.fetch;
  const urls = [], queries = [];
  const current = { studyInstanceUid: '1.2.1' };
  try {
    global.fetch = async url => { urls.push(url); return { ok: true, json: async () => url.endsWith('=0') ? { uids: ['1.2.1', '1.2.2'], nextOffset: 2 } : { uids: ['1.2.3'], nextOffset: null } }; };
    const source = { getConfig: () => ({ risproStudyListUrl: '/api/ohif/contexts/test/studies' }), query: { studies: { search: async query => { queries.push(query); return [{ studyInstanceUid: query.studyInstanceUid }]; } } } };
    const result = await getStudiesForPatientByMRN(source, [current]);
    assert.deepEqual(result.map(study => study.studyInstanceUid), ['1.2.1', '1.2.2', '1.2.3']);
    assert.deepEqual(queries, [{ studyInstanceUid: '1.2.2' }, { studyInstanceUid: '1.2.3' }]);
    assert.deepEqual(urls, ['/api/ohif/contexts/test/studies?offset=0', '/api/ohif/contexts/test/studies?offset=2']);
  } finally { global.fetch = previousFetch; }
});

test('study browser queries only explicit study selectors and reuses the primary QIDO result', async () => {
  const calls=[];
  const current={studyInstanceUid:'1.2.3',mrn:'SYNTHETIC'};
  const source={getConfig:()=>({risproStudyInstanceUIDs:['1.2.3','1.2.4','1.2.5']}),query:{studies:{search:async query=>{calls.push(query);return [{studyInstanceUid:query.studyInstanceUid}];}}}};
  const result=await getStudiesForPatientByMRN(source,[current]);
  assert.deepEqual(calls,[{studyInstanceUid:'1.2.4'},{studyInstanceUid:'1.2.5'}]);
  assert.equal(result[0],current);
  assert.deepEqual(result.map(s=>s.studyInstanceUid),['1.2.3','1.2.4','1.2.5']);
});
test('an unauthorized selector failure remains visible and never falls back to patient-wide search', async () => {
  const denied=Error('Synthetic exact-study denial');let calls=0;
  const source={getConfig:()=>({risproStudyInstanceUIDs:['9.9.9']}),query:{studies:{search:async query=>{calls++;assert.deepEqual(query,{studyInstanceUid:'9.9.9'});throw denied;}}}};
  await assert.rejects(getStudiesForPatientByMRN(source,[{studyInstanceUid:'1.2.3'}]),error=>error===denied);
  assert.equal(calls,1);
});
test('empty results and non-RISpro data sources retain the pinned discovery behavior', async () => {
  assert.deepEqual(await getStudiesForPatientByMRN({},[]),[]);
  const source={getConfig:()=>({}),query:{studies:{search:async query=>query}}};
  assert.deepEqual(await getStudiesForPatientByMRN(source,[{mrn:'SYNTHETIC'}]),{patientId:'SYNTHETIC',disableWildcard:true});
});
test('diagnostic preferences favor a multi-image CT/MRI over single-page documents and preserve explicit selection', () => {
  const preference=ds=>diagnosticSeriesRules.reduce((score,rule)=>score+(rule.constraint.equals?ds[rule.attribute]===rule.constraint.equals.value:ds[rule.attribute]>rule.constraint.greaterThan.value)*rule.weight,0);
  const documents={Modality:'OT',numImageFrames:1};
  assert.ok(preference({Modality:'MR',numImageFrames:800})>preference(documents));
  assert.ok(preference({Modality:'CT',numImageFrames:400})>preference(documents));
  assert.ok(preference({Modality:'MR',numImageFrames:800,SOPClassUID:'1.2.840.10008.5.1.4.1.1.4'})>preference({Modality:'MR',numImageFrames:20,SOPClassUID:'1.2.840.10008.5.1.4.1.1.7'}));
  assert.ok(preference({Modality:'MR',numImageFrames:4,SOPClassUID:'1.2.840.10008.5.1.4.1.1.4.1'})>preference(documents));
  assert.ok(preference(documents)+20>preference({Modality:'MR',numImageFrames:800}));
  assert.equal(diagnosticSeriesRules.some(rule=>rule.required),false);
});
