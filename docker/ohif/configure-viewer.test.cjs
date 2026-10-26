const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getStudiesForPatientByMRN, diagnosticSeriesRules } = require('./configure-viewer.cjs');
const { protectBootstrapHtml } = require('./verify-browser-build.cjs');
const { configureLoading, trackCachedFrames, isDiagnosticReady } = require('./configure-viewer.cjs');
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

test('all bootstrap scripts opt out of CDN script rewriting before src without changing their load order',()=>{
  const html='<script>window.x=1;</script><script src="app-config.js"></script><script type="module" src="init-service-worker.js"></script><script defer src="app.bundle.hash.js"></script>';
  const protectedHtml=protectBootstrapHtml(html);
  assert.equal((protectedHtml.match(/data-cfasync="false"/g)||[]).length,4);
  assert.equal(protectedHtml.replaceAll(' data-cfasync="false"',''),html);
  assert.equal(protectBootstrapHtml(protectedHtml),protectedHtml);
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
