const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { configureSeriesWindowing, dicomWindowProperties } = require('./configure-series-windowing.cjs');

const windowLevel = { toLowHighRange: (width, center, mode) => mode === 'LINEAR_EXACT' ?
  { lower: center - width / 2, upper: center + width / 2 } :
  { lower: center - width / 2, upper: center + width / 2 - 1 } };

test('DICOM default uses the first valid stored VOI and its LUT function without inspecting pixels', () => {
  for (const Modality of ['CT', 'MR']) {
    const metadata = { get: type => type === 'instance' ? { Modality } :
      { windowWidth: ['900', 1800], windowCenter: ['420', 700], voiLUTFunction: 'LINEAR_EXACT' } };
    assert.deepEqual(dicomWindowProperties('synthetic', metadata, windowLevel), {
      VOILUTFunction: 'LINEAR_EXACT', voiRange: { lower: -30, upper: 870 },
    });
  }
  for (const voi of [undefined, {}, { windowWidth: 0, windowCenter: 40 },
    { windowWidth: 400, windowCenter: null }, { windowWidth: Infinity, windowCenter: 40 },
    { windowWidth: 400, windowCenter: NaN }, { windowWidth: 400, windowCenter: 40, voiLUTFunction: 'unknown' }]) {
    assert.equal(dicomWindowProperties('synthetic', { get: type => type === 'instance' ? { Modality: 'CT' } : voi }, windowLevel), undefined);
  }
  assert.equal(dicomWindowProperties('synthetic', { get: () => ({ Modality: 'PT' }) }, windowLevel), undefined);
});

test('series opening replaces only VOI; same-series updates retain presentation and upstream drift fails closed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rispro-series-window-'));
  const file = path.join(root, 'extensions/cornerstone/src/services/ViewportService/CornerstoneViewportService.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `import {\n  cache,\n} from 'core';
const EVENTS = {};
async function set(viewport, viewportData, presentations) {
    const displaySetInstanceUIDs = viewportData.data.map(data => data.displaySetInstanceUID);
    const properties = { ...presentations.lutPresentation?.properties };
    const imageIds = ['synthetic'], initialImageIndexToUse = 0;
    return viewport.setStack(imageIds, initialImageIndexToUse).then(() => {
      viewport.setProperties(properties);
      this.setPresentations(viewport.id, presentations);
    });
}`);
  try {
    configureSeriesWindowing(root);
    const source = fs.readFileSync(file, 'utf8');
    const set = vm.runInNewContext(source.slice(source.indexOf('function dicomWindowProperties')) + '; set', {
      metaData: { get: type => type === 'instance' ? { Modality: 'CT' } : { windowWidth: [900], windowCenter: [420] } },
      csUtils: { windowLevel },
    });
    const properties = { voiRange: { lower: 1, upper: 50 }, VOILUTFunction: 'LINEAR_EXACT', invert: true, colormap: { name: 'gray' } };
    const presentations = { lutPresentation: { properties }, positionPresentation: { zoom: 2 }, segmentationPresentation: ['keep'] };
    for (const previous of ['other', 'series']) {
      let applied, restored;
      const viewport = { id: 'viewport', setStack: async () => {}, setProperties: value => { applied = value; } };
      await set.call({ viewportsDisplaySets: new Map([['viewport', [previous]]]), setPresentations: (_, value) => { restored = value; } },
        viewport, { data: [{ displaySetInstanceUID: 'series' }] }, presentations);
      assert.equal(applied.invert, true);
      assert.equal(applied.colormap, properties.colormap);
      assert.equal(restored.positionPresentation, presentations.positionPresentation);
      assert.equal(restored.segmentationPresentation, presentations.segmentationPresentation);
      assert.deepEqual(JSON.parse(JSON.stringify(applied.voiRange)), previous === 'series' ? properties.voiRange : { lower: -30, upper: 869 });
      assert.deepEqual(restored.lutPresentation.properties.voiRange, applied.voiRange);
    }
    assert.deepEqual(properties.voiRange, { lower: 1, upper: 50 }, 'Stored user presentation must remain untouched');
    assert.throws(() => configureSeriesWindowing(root), /Pinned OHIF series windowing anchor changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
