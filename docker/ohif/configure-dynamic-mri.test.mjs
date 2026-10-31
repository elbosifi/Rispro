import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { temporalContext, roiPlane, meanSignal, sampleCurve, curveStatus, curveValues, timeAxis } from './dynamic-mri/analysis.mjs';
import { installPhaseNavigation } from './dynamic-mri/navigation.mjs';
const require = createRequire(import.meta.url);

test('dynamic diagnostic readiness uses loaded voxels without requesting unsupported scalarData', () => {
  const { isDiagnosticReady } = require('./configure-viewer.cjs');
  let value = null;
  const data = { dimensions: [96, 96, 8], imageData: { worldToIndex: p => p },
    voxelManager: { getCurrentDimensionGroupNumber: () => 1, getAtIJKPoint: () => value },
    get scalarData() { throw Error('No scalar data available'); } };
  const viewport = { viewportStatus: 'rendered', getImageData: () => data, getCamera: () => ({ focalPoint: [48, 48, 3] }) };
  assert.equal(isDiagnosticReady(viewport, 'rendered'), false);
  value = 100; assert.equal(isDiagnosticReady(viewport, 'rendered'), true);
  viewport.viewportStatus = 'loading'; assert.equal(isDiagnosticReady(viewport, 'rendered'), false);
});

function fixture(enhanced = false) {
  const metadata = {}, groups = Array.from({ length: 3 }, (_, p) => Array.from({ length: 3 }, (_, z) => {
    const id = enhanced ? `wadors:instance/frames/${p * 3 + z + 1}` : `wadors:${p}-${z}`;
    metadata[id] = { Modality: 'MR', SeriesInstanceUID: 'series', StudyInstanceUID: 'study', FrameOfReferenceUID: 'frame',
      Rows: 12, Columns: 12, ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, z * 3], PixelSpacing: [2, 1],
      [enhanced ? 'TemporalPositionIndex' : 'TemporalPositionIdentifier']: p + 1, AcquisitionDateTime: `202610311200${String(p * 10).padStart(2, '0')}`, EchoTime: 10 };
    return id;
  }));
  groups[1].reverse(); // Correspondence must not depend on array indices.
  const ds = { Modality: 'MR', SeriesInstanceUID: 'series', StudyInstanceUID: 'study', isDynamicVolume: true,
    dynamicVolumeInfo: { timePoints: groups, splittingTag: enhanced ? 'TemporalPositionIndex' : 'TemporalPositionIdentifier' } };
  const volume = { isDynamicVolume: () => true, numDimensionGroups: 3, dimensionGroupNumber: 1, imageIds: groups.flat(), getCurrentDimensionGroupImageIds() { return groups[this.dimensionGroupNumber - 1]; } };
  const context = () => temporalContext([ds], volume, id => metadata[id]);
  const annotation = { metadata: { toolName: 'EllipticalROI', FrameOfReferenceUID: 'frame', referencedImageId: groups[0][1] },
    data: { handles: { points: [[5, 4, 3], [5, 16, 3], [2, 10, 3], [8, 10, 3]] } } };
  const image = (value, extra = {}) => ({ rows: 12, columns: 12, getPixelData: () => new Int16Array(144).fill(value), ...extra });
  return { metadata, groups, ds, volume, context, annotation, image };
}

test('single-series temporal MR gate rejects diffusion, echo, unknown dimensions and missing geometry', () => {
  const f = fixture(); assert.ok(f.context());
  for (const tag of ['DiffusionBValue', 'EchoNumber', 'CardiacTriggerTime', 'Unknown']) {
    f.ds.dynamicVolumeInfo.splittingTag = tag; assert.equal(f.context(), null);
  }
  f.ds.dynamicVolumeInfo.splittingTag = 'TemporalPositionIdentifier';
  f.metadata[f.groups[1][0]].EchoTime = 20; assert.equal(f.context(), null);
  f.metadata[f.groups[1][0]].EchoTime = 10;
  f.metadata[f.groups[1][0]].DiffusionBValue = 800; assert.equal(f.context(), null);
  delete f.metadata[f.groups[1][0]].DiffusionBValue;
  delete f.metadata[f.groups[1][0]].PixelSpacing; assert.equal(f.context(), null);
  assert.equal(temporalContext([f.ds, f.ds], f.volume, () => null), null);
  f.ds.Modality = 'CT'; assert.equal(f.context(), null);
});

for (const enhanced of [false, true]) test(`${enhanced ? 'enhanced frame metadata' : 'multi-instance'}: matched planes yield 100/150/125 and explicit baseline 0/50/25`, async () => {
  const f = fixture(enhanced), loaded = [];
  const results = await sampleCurve(f.context(), f.annotation, { loadImage: async id => {
    loaded.push(id); return f.image([100, 150, 125][f.groups.findIndex(group => group.includes(id))]);
  } });
  assert.deepEqual(curveValues(results, 'signal'), [100, 150, 125]);
  assert.deepEqual(curveValues(results, 'enhancement', 1), [0, 50, 25]);
  assert.throws(() => curveValues(results, 'enhancement', 'none'), /baseline/);
  assert.equal(loaded.length, 3);
  assert.ok(loaded.every(id => f.metadata[id].ImagePositionPatient[2] === 3));
  assert.ok(results.every(r => r.count > 15 && r.count === results[0].count));
  assert.deepEqual(timeAxis(results), { label: 'Time (s)', values: [0, 10, 20] });
});

test('patient-space ellipse maps anisotropic/rotated pixels, excludes padding and scales exactly once', () => {
  const f = fixture(), context = f.context(), ellipse = roiPlane(context, f.annotation), frame = ellipse.frames[0];
  frame.instance.RescaleSlope = 2; frame.instance.RescaleIntercept = -10; frame.instance.PixelPaddingValue = -100;
  const raw = new Int16Array(144).fill(100); raw[5 * 12 + 5] = -100;
  const a = meanSignal(frame, ellipse, f.image(0, { getPixelData: () => raw }));
  assert.equal(a.mean, 190);
  const prescaled = Float32Array.from(raw, value => value * 2 - 10);
  const b = meanSignal(frame, ellipse, f.image(0, { preScale: { scaled: true, scalingParameters: { rescaleSlope: 2, rescaleIntercept: -10 } }, getPixelData: () => prescaled }));
  assert.deepEqual(a, b);
  assert.equal(raw[5 * 12 + 5], -100); // Input pixels unchanged.
  assert.throws(() => meanSignal(frame, ellipse, f.image(100), () => [50, 50, 0]), /transform/);
  const rotate = p => [-p[1], p[0], p[2]];
  for (const instance of Object.values(f.metadata)) { instance.ImageOrientationPatient = [0, 1, 0, -1, 0, 0]; instance.ImagePositionPatient = rotate(instance.ImagePositionPatient); }
  f.annotation.data.handles.points = f.annotation.data.handles.points.map(rotate);
  const rotated = roiPlane(f.context(), f.annotation);
  assert.equal(meanSignal(rotated.frames[0], rotated, f.image(125)).mean, 240);
});

test('empty optional LUT sequences do not reject decoded scalar MR pixels', () => {
  const f = fixture(), ellipse = roiPlane(f.context(), f.annotation), frame = ellipse.frames[0];
  Object.assign(frame.instance, { ModalityLUTSequence: [], RealWorldValueMappingSequence: [] });
  assert.equal(meanSignal(frame, ellipse, f.image(100)).mean, 100);
});

test('linear real-world mapping does not reject or double-scale the modality signal', () => {
  const f = fixture(), ellipse = roiPlane(f.context(), f.annotation), frame = ellipse.frames[0];
  Object.assign(frame.instance, { RescaleSlope: 2, RescaleIntercept: -10,
    RealWorldValueMappingSequence: [{ RealWorldValueSlope: 0.5, RealWorldValueIntercept: 7,
      RealWorldValueFirstValueMapped: 0, RealWorldValueLastValueMapped: 4095 }] });
  const raw = f.image(100);
  assert.equal(meanSignal(frame, ellipse, raw).mean, 190);
  const scaled = f.image(190, { preScale: { scaled: true, scalingParameters: { rescaleSlope: 2, rescaleIntercept: -10 } } });
  assert.equal(meanSignal(frame, ellipse, scaled).mean, 190);
  assert.equal(raw.getPixelData()[0], 100);
});

test('unsupported pixel layouts and nonlinear mappings retain specific rejection reasons', () => {
  const f = fixture(), ellipse = roiPlane(f.context(), f.annotation), frame = ellipse.frames[0];
  for (const sequence of [[{ RealWorldValueLUTData: [0, 1, 4] }], [{}], [{ RealWorldValueSlope: NaN, RealWorldValueIntercept: 0 }], {}]) {
    frame.instance.RealWorldValueMappingSequence = sequence;
    assert.throws(() => meanSignal(frame, ellipse, f.image(100)), /real-world value mapping/);
  }
  delete frame.instance.RealWorldValueMappingSequence;
  frame.instance.ModalityLUTSequence = [{ LUTDescriptor: [3, 0, 16], LUTData: [0, 1, 4] }];
  assert.throws(() => meanSignal(frame, ellipse, f.image(100)), /Nonlinear modality LUT/);
  delete frame.instance.ModalityLUTSequence;
  assert.throws(() => meanSignal(frame, ellipse, f.image(100, { color: true })), /Color or multi-component/);
  assert.throws(() => meanSignal(frame, ellipse, f.image(100, { rows: 6 })), /dimensions/);
});

test('twenty identical phase failures produce one compact reason and no fabricated measurements', () => {
  const reason = 'Nonlinear modality LUT is unsupported.';
  const results = Array.from({ length: 20 }, (_, i) => ({ phase: i + 1, mean: null, error: reason }));
  const status = curveStatus(results);
  assert.match(status, /20\/20 phases unavailable/);
  assert.match(status, /Phases 1–20/);
  assert.equal(status.split(reason).length - 1, 1);
  assert.ok(status.length < 140);
  assert.deepEqual(curveValues(results, 'signal'), new Array(20).fill(null));
  assert.equal(curveStatus([]), '');
  assert.equal(curveStatus([{ phase: 1, mean: 100 }]), '');
  assert.match(curveStatus([{ phase: 1, mean: 100 }, { phase: 2, error: reason }, { phase: 3, error: reason }]), /Phases 2–3/);
});

test('incompatible, oblique, missing and unavailable data never become zero measurements', async () => {
  const f = fixture(); const context = f.context();
  f.annotation.data.handles.points[0][2] += 1;
  assert.throws(() => roiPlane(context, f.annotation), /planar|plane|ellipse/);
  f.annotation.data.handles.points[0][2] -= 1;
  const results = await sampleCurve(context, f.annotation, { loadImage: async id => { if (f.groups[1].includes(id)) throw { status: 404 }; return f.image(100); } });
  assert.deepEqual(results.map(r => r.mean), [100, null, 100]);
  assert.match(results[1].error, /could not be loaded/);
  assert.deepEqual(timeAxis(results).label, 'Phase');
  f.metadata[f.groups[2][1]].FrameOfReferenceUID = 'other'; assert.equal(f.context(), null);
  assert.throws(() => curveValues([{ phase: 1, mean: 0 }], 'enhancement', 1), /nonzero/);
});

test('relative enhancement rejects changed valid-pixel masks or units; signed pixels remain signed', async () => {
  const f = fixture();
  const results = await sampleCurve(f.context(), f.annotation, { loadImage: async () => f.image(-30) });
  assert.deepEqual(curveValues(results, 'signal'), [-30, -30, -30]);
  results[1].validIndices = results[1].validIndices.slice(1); results[2].units = 'different';
  assert.deepEqual(curveValues(results, 'enhancement', 1), [-0, null, null]);
  const context = f.context(), ellipse = roiPlane(context, f.annotation);
  assert.throws(() => meanSignal(ellipse.frames[0], ellipse, f.image(0, { getPixelData: () => new Float32Array(144).fill(NaN) })), /No valid ROI pixels/);
});

test('gesture threshold, direction lock, clamping, tool ownership and cleanup preserve upstream slice scrolling', () => {
  const window = new EventTarget(), element = new EventTarget(); element.ownerDocument = { defaultView: window };
  const calls = [], tool = { mouseDragCallback: event => calls.push(event.detail.deltaPoints.canvas) }, original = tool.mouseDragCallback;
  let active = 'StackScroll', editing = false;
  const volume = { dimensionGroupNumber: 1, numDimensionGroups: 3 };
  const cleanup = installPhaseNavigation({ element, viewportId: 'v', volume, toolGroup: { getToolInstance: () => tool, getActivePrimaryMouseButtonTool: () => active }, interacting: () => editing });
  const drag = (x, y, dy = y) => tool.mouseDragCallback({ detail: { viewportId: 'v', startPoints: { canvas: [0, 0] }, currentPoints: { canvas: [x, y] }, deltaPoints: { canvas: [x, dy] } } });
  drag(7, 0); assert.equal(volume.dimensionGroupNumber, 1);
  drag(26, 1); assert.equal(volume.dimensionGroupNumber, 2); assert.equal(calls.length, 0);
  drag(200, 1); assert.equal(volume.dimensionGroupNumber, 3);
  window.dispatchEvent(new Event('mouseup')); drag(0, 30); drag(30, 60, 30);
  assert.deepEqual(calls, [[0, 30], [30, 30]]); assert.equal(volume.dimensionGroupNumber, 3);
  window.dispatchEvent(new Event('pointercancel')); active = 'EllipticalROI'; drag(-60, 0); assert.equal(volume.dimensionGroupNumber, 3);
  active = 'StackScroll'; editing = true; drag(-60, 0); assert.equal(volume.dimensionGroupNumber, 3);
  editing = false;
  const wheel = (dx, dy, ctrlKey = false) => { const event = new Event('wheel', { cancelable: true }); Object.assign(event, { deltaX: dx, deltaY: dy, deltaMode: 0, ctrlKey }); element.dispatchEvent(event); return event.defaultPrevented; };
  assert.equal(wheel(0, 50), false); assert.equal(wheel(-25, 0, true), false); assert.equal(wheel(-25, 0), true); assert.equal(volume.dimensionGroupNumber, 2);
  cleanup(); assert.equal(tool.mouseDragCallback, original); assert.equal(wheel(25, 0), false);
});

test('guarded pinned viewport patch copies helpers and fails on upstream drift', () => {
  const root = mkdtempSync(join(tmpdir(), 'dynamic-mri-unit-'));
  try {
    const folder = join(root, 'extensions/cornerstone/src/Viewport'); mkdirSync(folder, { recursive: true });
    const file = join(folder, 'OHIFCornerstoneViewport.tsx');
    writeFileSync(file, "import CinePlayer from '../components/CinePlayer';\n          <CinePlayer\n");
    const { configureDynamicMri } = require('./configure-dynamic-mri.cjs'); configureDynamicMri(root);
    assert.match(readFileSync(file, 'utf8'), /<DynamicMri /);
    assert.match(readFileSync(join(root, 'extensions/cornerstone/src/components/RisproDynamicMri/DynamicMri.tsx'), 'utf8'), /ANNOTATION_COMPLETED/);
    assert.throws(() => configureDynamicMri(root), /Pinned/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
