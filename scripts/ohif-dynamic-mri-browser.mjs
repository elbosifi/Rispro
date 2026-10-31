// Runs inside the existing disposable Orthanc/authenticated reporting harness.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installProbe } from './ohif-native-benchmark.mjs';
const require = createRequire(import.meta.url), dcmjs = require('dcmjs');

async function dynamicFixture(c, archiveRequest) {
  const size = 96, slices = 8, values = [100, 150, 125];
  const instances = [];
  async function upload(ds) {
    const dict = new dcmjs.data.DicomDict(dcmjs.data.DicomMetaDictionary.denaturalizeDataset({ MediaStorageSOPClassUID: ds.SOPClassUID, MediaStorageSOPInstanceUID: ds.SOPInstanceUID, TransferSyntaxUID: '1.2.840.10008.1.2.1', ImplementationClassUID: '2.25.202610310001' }));
    dict.dict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(ds);
    assert.equal((await archiveRequest('/instances', { method: 'POST', headers: { 'Content-Type': 'application/dicom' }, body: Buffer.from(dict.write()) })).status, 200);
  }
  for (let phase = 0; phase < 3; phase++) for (let slice = 0; slice < slices; slice++) {
    const pixels = new Uint16Array(size * size).fill(values[phase]);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (x < 16 || x > 80 || y < 16 || y > 80) pixels[y * size + x] = (x + y) % 8 < 4 ? 0 : 250;
    const sopClass = '1.2.840.10008.5.1.4.1.1.4', sop = c.study + '.10.' + (phase * slices + slice + 1);
    const ds = { _vrMap: { PixelData: 'OW' }, SOPClassUID: sopClass, SOPInstanceUID: sop, StudyInstanceUID: c.study,
      SeriesInstanceUID: c.study + '.10', FrameOfReferenceUID: c.study + '.99', PatientName: 'SYNTHETIC^DYNAMIC', PatientID: c.identifier, PatientBirthDate: '19860101', PatientSex: 'O',
      StudyDate: '20261031', StudyTime: '120000', StudyDescription: 'SYNTHETIC DYNAMIC MR', AccessionNumber: 'V2-' + String(c.appointmentId).padStart(6, '0'),
      Modality: 'MR', SeriesNumber: 10, SeriesDescription: 'SYNTHETIC THREE TEMPORAL PHASES', InstanceNumber: phase * slices + slice + 1,
      TemporalPositionIdentifier: phase + 1, NumberOfTemporalPositions: 3, AcquisitionDateTime: `202610311200${String(phase * 10).padStart(2, '0')}`,
      ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'], ScanningSequence: 'GR', SequenceVariant: 'NONE', ScanOptions: '', MRAcquisitionType: '3D', RepetitionTime: 6, EchoTime: 2, EchoNumbers: 1,
      Rows: size, Columns: size, SamplesPerPixel: 1, PhotometricInterpretation: 'MONOCHROME2', BitsAllocated: 16, BitsStored: 16, HighBit: 15, PixelRepresentation: 0,
      ImageOrientationPatient: [1, 0, 0, 0, 1, 0], ImagePositionPatient: [0, 0, slice * 2], PixelSpacing: [1, 1], SliceThickness: 2, SpacingBetweenSlices: 2,
      WindowCenter: 125, WindowWidth: 250, RescaleIntercept: 0, RescaleSlope: 1, PixelData: pixels.buffer };
    // Valid optional linear mapping used by real MR objects. SI stays on the
    // existing modality-rescale path, not this independent real-world mapping.
    ds.RealWorldValueMappingSequence = [{ RealWorldValueSlope: 0.5, RealWorldValueIntercept: 7,
      RealWorldValueFirstValueMapped: 0, RealWorldValueLastValueMapped: 65535, LUTLabel: 'SYNTHETIC',
      MeasurementUnitsCodeSequence: [{ CodeValue: '1', CodingSchemeDesignator: 'UCUM', CodeMeaning: 'no units' }] }];
    instances.push(ds); await upload(ds);
  }
  // Exercise the pinned loader's supported multiframe TimeSlotVector path.
  // This explicit synthetic compatibility layout does not claim support for all enhanced-MR dimension layouts.
  const enhanced = { ...instances[0], SOPClassUID: '1.2.840.10008.5.1.4.1.1.4.1', SOPInstanceUID: c.study + '.11.1', SeriesInstanceUID: c.study + '.11', SeriesNumber: 11,
    SeriesDescription: 'SYNTHETIC ENHANCED TEMPORAL COMPATIBILITY', NumberOfFrames: instances.length, NumberOfSlices: slices, NumberOfTimeSlots: 3,
    TimeSlotVector: instances.map(ds => ds.TemporalPositionIdentifier), SliceVector: instances.map(ds => Number(ds.ImagePositionPatient[2]) / 2 + 1),
    SharedFunctionalGroupsSequence: [{ PixelMeasuresSequence: [{ PixelSpacing: [1, 1], SliceThickness: 2, SpacingBetweenSlices: 2 }], PlaneOrientationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0] }] }],
    PerFrameFunctionalGroupsSequence: instances.map(ds => ({ PlanePositionSequence: [{ ImagePositionPatient: ds.ImagePositionPatient }], FrameContentSequence: [{ TemporalPositionIndex: ds.TemporalPositionIdentifier, FrameAcquisitionDateTime: ds.AcquisitionDateTime, InStackPositionNumber: ds.ImagePositionPatient[2] / 2 + 1, StackID: '1', DimensionIndexValues: [ds.TemporalPositionIdentifier, ds.ImagePositionPatient[2] / 2 + 1] }] })),
    PixelData: Buffer.concat(instances.map(ds => Buffer.from(ds.PixelData))).buffer };
  // Buffer can have an offset into a larger allocation; retain only the frame payload.
  const payload = Buffer.concat(instances.map(ds => Buffer.from(ds.PixelData))); enhanced.PixelData = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
  delete enhanced.TemporalPositionIdentifier; delete enhanced.AcquisitionDateTime; delete enhanced.ImagePositionPatient;
  await upload(enhanced);
}

export async function runDynamicMriAcceptance({ context: parentContext, cases, origin, temp, archiveRequest, launch }) {
  // Exercise mouse and native touch input in the same touch-capable browser.
  const context = await parentContext.browser().newContext({ viewport: { width: 1600, height: 1000 }, hasTouch: true });
  await context.addCookies(await parentContext.cookies());
  const checks = [], c = cases.find(item => item.modality === 'MR');
  await dynamicFixture(c, archiveRequest);
  await context.addInitScript(installProbe);
  const page = await context.newPage(), errors = [];
  let rejectBrowser;
  const browserFailure = new Promise((_, reject) => { rejectBrowser = reject; });
  browserFailure.catch(() => {});
  page.on('pageerror', error => { errors.push(error.stack); rejectBrowser(error); });
  const save = () => writeFileSync(join(temp, 'dynamic-mri-results.json'), JSON.stringify({ checks, errors, environment: 'Production pinned OHIF, Chromium, disposable Orthanc, synthetic pixels only' }, null, 2));
  const launched = await launch(c);
  const response = await context.request.get(origin + launched.launchUrl, { maxRedirects: 0 });
  const url = new URL(response.headers().location, origin);
  url.searchParams.set('initialSeriesInstanceUID', c.study + '.10');
  url.searchParams.set('risproLoadingProfile', 'progressive');
  const state = () => page.evaluate(() => {
    const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
    const ds = s.displaySetService.getDisplaySetsForSeries(v.getCurrentImageId().match(/\/series\/([^/]+)/)[1])[0];
    const volume = window.cornerstone.cache.getVolume(ds.displaySetInstanceUID, true);
    return { phase: volume.dimensionGroupNumber, camera: v.getCamera(), properties: v.getProperties(), slice: v.getCurrentImageIdIndex?.(), position: v.getCamera().focalPoint,
      pixel: window.cornerstone.cache.getImage(volume.getCurrentDimensionGroupImageIds()[0])?.getPixelData()[48 * 96 + 48] };
  });
  const tool = name => page.evaluate(name => { const s = window.services, id = s.viewportGridService.getActiveViewportId(); window.commandsManager.runCommand('setToolActive', { toolName: name, toolGroupId: s.toolGroupService.getToolGroupForViewport(id).id }); }, name);
  const primary = () => page.evaluate(() => { const s = window.services; return s.toolGroupService.getToolGroupForViewport(s.viewportGridService.getActiveViewportId()).getActivePrimaryMouseButtonTool(); });
  const roiUID = () => page.getByRole('region', { name: 'MRI enhancement curve' }).getAttribute('data-roi-uid');
  const roiState = uid => page.evaluate(uid => {
    const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), tools = window.cornerstoneTools;
    return { points: tools.annotation.state.getAnnotation(uid)?.data.handles.points, uids: tools.annotation.state.getAnnotations('EllipticalROI', v.element).map(a => a.annotationUID), camera: v.getCamera() };
  }, uid);
  const visibleRoi = async uid => {
    await page.waitForFunction(uid => {
      if (document.querySelectorAll(`ellipse[data-id="${uid}-ellipse"]`).length !== 1) return false;
      const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const points = window.cornerstoneTools.annotation.state.getAnnotation(uid).data.handles.points.map(p => v.worldToCanvas(p));
      const [bottom, top, left, right] = points, shape = document.querySelector(`ellipse[data-id="${uid}-ellipse"]`);
      const expected = { cx: (left[0] + right[0]) / 2, cy: (top[1] + bottom[1]) / 2, rx: Math.hypot(left[0] - right[0], left[1] - right[1]) / 2, ry: Math.hypot(top[0] - bottom[0], top[1] - bottom[1]) / 2 };
      return Math.max(...Object.entries(expected).map(([key, value]) => Math.abs(Number(shape.getAttribute(key)) - value))) < .5;
    }, uid);
  };
  const drawMouse = async (center, corner) => {
    const rect = await page.locator('.cornerstone-viewport-element').first().boundingBox();
    const points = await page.evaluate(({ center, corner }) => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), z = v.getCamera().focalPoint[2]; return [center, corner].map(p => v.worldToCanvas([p[0], p[1], z])); }, { center, corner });
    await page.mouse.move(rect.x + points[0][0], rect.y + points[0][1]); await page.mouse.down();
    await page.mouse.move(rect.x + points[1][0], rect.y + points[1][1], { steps: 10 }); await page.mouse.up();
  };
  try {
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await Promise.race([page.getByRole('button', { name: 'Enhancement Curve', exact: true }).waitFor({ timeout: 120000 }), browserFailure]);
    await page.waitForFunction(() => { const s = window.services, ds = s.displaySetService.getActiveDisplaySets().find(d => d.isDynamicVolume); const v = window.cornerstone.cache.getVolume(ds?.displaySetInstanceUID, true); return v?.loadStatus.loaded; }, null, { timeout: 90000 });
    checks.push('eligible dynamic MRI controls default ON');
    await tool('StackScroll');
    const element = page.locator('.cornerstone-viewport-element').first(), box = await element.boundingBox();
    const start = { x: box.x + box.width * .4, y: box.y + box.height * .5 };
    const before = await state();
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 27, start.y, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(() => window.cornerstone.cache.getVolumes().some(v => v.isDynamicVolume?.() && v.dimensionGroupNumber === 2));
    const horizontal = await state(); assert.equal(horizontal.phase, 2); assert.deepEqual(horizontal.camera, before.camera); assert.deepEqual(horizontal.properties, before.properties);
    checks.push('horizontal drag changes phase and preserves camera, slice and VOI');
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x, start.y + 220, { steps: 12 }); await page.mouse.up();
    const vertical = await state(); assert.equal(vertical.phase, 2); assert.notDeepEqual(vertical.position, horizontal.position);
    await page.mouse.wheel(0, -150);
    await page.waitForFunction(position => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); return JSON.stringify(v.getCamera().focalPoint) !== JSON.stringify(position); }, vertical.position);
    assert.equal((await state()).phase, 2); checks.push('vertical drag and wheel retain anatomical navigation');
    await page.mouse.wheel(25, 0); assert.equal((await state()).phase, 3);
    checks.push('horizontal trackpad wheel changes phase');
    await page.evaluate(() => window.services.cineService.setIsCineEnabled(true));
    const cine = page.locator('[data-cy="cine-player-close"]').locator('..').locator('..');
    const slider = cine.getByRole('slider'); await slider.waitFor();
    const firstPhase = async () => {
      const track = await slider.locator('..').locator('..').boundingBox();
      await page.mouse.click(track.x + 2, track.y + track.height / 2);
      await page.waitForFunction(() => window.cornerstone.cache.getVolumes().some(v => v.isDynamicVolume?.() && v.dimensionGroupNumber === 1));
    };
    await slider.focus(); await slider.press('Home');
    await page.waitForFunction(() => window.cornerstone.cache.getVolumes().some(v => v.isDynamicVolume?.() && v.dimensionGroupNumber === 1));
    await slider.press('ArrowRight');
    await page.waitForFunction(() => window.cornerstone.cache.getVolumes().some(v => v.isDynamicVolume?.() && v.dimensionGroupNumber === 2));
    await page.mouse.move(start.x, start.y); await page.mouse.wheel(25, 0);
    await page.waitForFunction(() => document.querySelector('[role="slider"]')?.getAttribute('aria-valuenow') === '3');
    checks.push('existing Cine slider and horizontal navigation synchronize in both directions');
    // Select the center anatomical plane for a native-space ROI.
    await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); const camera = v.getCamera(), offset = 6 - camera.focalPoint[2]; v.setCamera({ focalPoint: [camera.focalPoint[0], camera.focalPoint[1], 6], position: [camera.position[0], camera.position[1], camera.position[2] + offset] }); v.render(); });
    await page.getByRole('button', { name: 'Enhancement Curve', exact: true }).click();
    const corners = await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); return [[38, 38, 6], [58, 58, 6]].map(p => v.worldToCanvas(p)); });
    await page.mouse.move(box.x + corners[0][0], box.y + corners[0][1]); await page.mouse.down(); await page.mouse.move(box.x + corners[1][0], box.y + corners[1][1], { steps: 12 }); await page.mouse.up();
    const chart = page.locator('.rispro-dynamic-mri svg[data-values]');
    await chart.waitFor({ timeout: 30000 });
    assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [100, 150, 125]);
    const initialUID = await roiUID(); assert.ok(initialUID); assert.equal(await primary(), 'StackScroll');
    assert.deepEqual((await roiState(initialUID)).uids, [initialUID]);
    const originalRoi = await roiState(initialUID);
    await firstPhase(); await visibleRoi(initialUID);
    for (const phase of [2, 3]) {
      await page.mouse.move(box.x + box.width * .15, box.y + box.height * .75); await page.mouse.down();
      await page.mouse.move(box.x + box.width * .15 + 27, box.y + box.height * .75, { steps: 6 }); await page.mouse.up();
      assert.equal((await state()).phase, phase); await visibleRoi(initialUID);
      assert.deepEqual((await roiState(initialUID)).points, originalRoi.points);
      assert.deepEqual((await roiState(initialUID)).uids, [initialUID]);
    }
    const acquisitionPlane = originalRoi.points[0][2];
    await page.evaluate(z => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), camera = v.getCamera(); v.setCamera({ focalPoint: [camera.focalPoint[0], camera.focalPoint[1], z + 2], position: [camera.position[0], camera.position[1], camera.position[2] + z + 2 - camera.focalPoint[2]] }); v.render(); }, acquisitionPlane);
    await page.waitForFunction(uid => !document.querySelector(`ellipse[data-id="${uid}-ellipse"]`), initialUID);
    await page.evaluate(camera => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); v.setCamera(camera); v.render(); }, originalRoi.camera);
    await visibleRoi(initialUID);
    await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), camera = v.getCamera(); v.setCamera({ parallelScale: camera.parallelScale * .8, focalPoint: [camera.focalPoint[0] + 3, camera.focalPoint[1] + 2, camera.focalPoint[2]], position: [camera.position[0] + 3, camera.position[1] + 2, camera.position[2]] }); v.render(); });
    await visibleRoi(initialUID); assert.deepEqual((await roiState(initialUID)).points, originalRoi.points);
    await page.evaluate(camera => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); v.setCamera(camera); v.render(); }, originalRoi.camera);
    checks.push('completion selects StackScroll; mouse phase drags retain one native ROI on its plane through phase/zoom/pan changes');
    assert.equal(await page.evaluate(() => {
      const core = window.cornerstone, ds = window.services.displaySetService.getActiveDisplaySets().find(ds => ds.isDynamicVolume);
      return ds.dynamicVolumeInfo.timePoints.flat().every(id => core.metaData.get('instance', id).RealWorldValueMappingSequence?.[0]?.RealWorldValueSlope === 0.5);
    }), true);
    checks.push('linear real-world mapping survives DICOM delivery without rejecting or changing modality SI');
    assert.equal((await state()).phase, 3); checks.push('real Elliptical ROI drawing produces 100/150/125 without changing phase');
    await page.getByRole('combobox', { name: 'Baseline phase' }).click(); await page.getByRole('option', { name: 'Baseline: phase 1', exact: true }).click();
    assert.match(await page.getByRole('combobox', { name: 'Baseline phase' }).innerText(), /Baseline: phase 1/);
    await page.getByRole('combobox', { name: 'Curve measurement' }).click(); await page.getByRole('option', { name: 'Enhancement (%)', exact: true }).click();
    assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [0, 50, 25]); checks.push('explicit baseline gives 0/50/25 enhancement');
    const summary = await page.getByTestId('roi-summary').innerText(); assert.match(summary, /Valid pixels: [1-9]/); assert.match(summary, /phase 1, 100/);
    // Move the ROI with the actual mouse. Frame pixels remain constant within this region.
    const boundary = await page.evaluate(() => {
      const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const points = window.cornerstoneTools.annotation.state.getAnnotations('EllipticalROI', v.element)[0].data.handles.points;
      const center = points[0].map((value, i) => (value + points[1][i]) / 2);
      return v.worldToCanvas(center.map((value, i) => value + ((points[1][i] - points[0][i]) + (points[3][i] - points[2][i])) / (2 * Math.SQRT2)));
    });
    await page.mouse.move(box.x + boundary[0], box.y + boundary[1]); await page.mouse.down(); await page.mouse.move(box.x + boundary[0] + 12, box.y + boundary[1], { steps: 5 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.rispro-dynamic-mri svg[data-values]')?.getAttribute('data-values') === '[0,50,25]');
    assert.equal((await state()).phase, 3);
    assert.equal(await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); return window.cornerstoneTools.annotation.state.getAnnotations('EllipticalROI', v.element).length; }), 1);
    checks.push('ROI modification keeps phase fixed and updates curve');
    await tool('StackScroll'); await page.mouse.move(start.x, start.y); await page.mouse.wheel(-25, 0);
    await page.waitForFunction(() => document.querySelector('.rispro-dynamic-mri circle[data-phase="2"]')?.getAttribute('data-current') === 'true');
    checks.push('phase event immediately updates the curve marker');
    assert.equal(await page.evaluate(() => {
      const core = window.cornerstone, ds = window.services.displaySetService.getActiveDisplaySets().find(ds => ds.isDynamicVolume);
      return ds.dynamicVolumeInfo.timePoints.every((ids, phase) => ids.every(id => {
        const pixels = core.cache.getImage(id)?.getPixelData();
        return pixels?.length === 96 * 96 && pixels.every((value, i) => {
          const x = i % 96, y = Math.floor(i / 96);
          return value === (x < 16 || x > 80 || y < 16 || y > 80 ? (x + y) % 8 < 4 ? 0 : 250 : [100, 150, 125][phase]);
        });
      }));
    }), true); checks.push('every decoded diagnostic pixel remains identical to the synthetic source');
    const modify = async invalid => page.evaluate(invalid => {
      const s = window.services, core = window.cornerstone, tools = window.cornerstoneTools;
      const v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const annotation = tools.annotation.state.getAnnotations('EllipticalROI', v.element)[0];
      annotation.data.handles.points[0][2] += invalid ? 1 : -1;
      core.utilities.triggerEvent(core.eventTarget, tools.Enums.Events.ANNOTATION_MODIFIED, { annotation, viewportId: v.id, changeType: tools.Enums.ChangeTypes.HandlesUpdated });
    }, invalid);
    await modify(true);
    await page.getByRole('status').filter({ hasText: 'Measurement unavailable' }).waitFor();
    assert.equal(await chart.count(), 0);
    await modify(false);
    await chart.waitFor(); assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [0, 50, 25]);
    checks.push('invalid ROI plane gives an explicit unavailable state and recovers after correction');
    const nonlinear = async enabled => page.evaluate(enabled => {
      const s = window.services, core = window.cornerstone, tools = window.cornerstoneTools;
      const v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const ds = s.displaySetService.getActiveDisplaySets().find(ds => ds.isDynamicVolume);
      for (const id of ds.dynamicVolumeInfo.timePoints.flat()) {
        const instance = core.metaData.get('instance', id);
        if (enabled) instance.ModalityLUTSequence = [{ LUTDescriptor: [3, 0, 16], LUTData: [0, 1, 4] }];
        else delete instance.ModalityLUTSequence;
      }
      const annotation = tools.annotation.state.getAnnotations('EllipticalROI', v.element)[0];
      core.utilities.triggerEvent(core.eventTarget, tools.Enums.Events.ANNOTATION_MODIFIED, { annotation, viewportId: v.id, changeType: tools.Enums.ChangeTypes.HandlesUpdated });
    }, enabled);
    await nonlinear(true);
    const groupedError = page.getByRole('status').filter({ hasText: '3/3 phases unavailable' });
    await groupedError.waitFor();
    assert.equal((await groupedError.innerText()).split('Nonlinear modality LUT').length - 1, 1);
    assert.equal(await chart.count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobilePanel = await page.getByRole('region', { name: 'MRI enhancement curve' }).boundingBox();
    assert.ok(mobilePanel.x >= 0 && mobilePanel.x + mobilePanel.width <= 390 && mobilePanel.y + mobilePanel.height <= 844);
    assert.ok((await groupedError.boundingBox()).height < 100, 'Repeated phase failures must remain compact on a narrow viewport');
    await page.screenshot({ path: join(temp, 'dynamic-mri-compact-errors-mobile.png') });
    checks.push('compact shared failure stays within a 390px portrait viewport');
    await page.setViewportSize({ width: 1600, height: 1000 });
    await nonlinear(false); await chart.waitFor();
    assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [0, 50, 25]);
    checks.push('unsupported mapping stays rejected with one compact shared reason, then recovers');
    const missingId = await page.evaluate(() => {
      const core = window.cornerstone, s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const ds = s.displaySetService.getActiveDisplaySets().find(ds => ds.isDynamicVolume);
      const plane = window.cornerstoneTools.annotation.state.getAnnotations('EllipticalROI', v.element)[0].data.handles.points[0][2];
      const id = ds.dynamicVolumeInfo.timePoints[1].find(id => Math.abs(Number(core.metaData.get('instance', id).ImagePositionPatient[2]) - plane) < .1);
      core.cache.removeImageLoadObject(id, { force: true }); return id.replace(/^wadors:/, '');
    });
    const missingURL = new URL(missingId, page.url()).href;
    await page.route(missingURL, route => route.abort());
    await page.evaluate(() => {
      const s = window.services, tools = window.cornerstoneTools, core = window.cornerstone, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId());
      const annotation = tools.annotation.state.getAnnotations('EllipticalROI', v.element)[0];
      core.utilities.triggerEvent(core.eventTarget, tools.Enums.Events.ANNOTATION_MODIFIED, { annotation, viewportId: v.id, changeType: tools.Enums.ChangeTypes.HandlesUpdated });
    });
    await page.getByRole('status').filter({ hasText: 'Incomplete curve' }).waitFor({ timeout: 30000 });
    assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [0, null, 25]);
    await page.unroute(missingURL);
    await modify(true); await modify(false);
    await page.waitForFunction(() => document.querySelector('.rispro-dynamic-mri svg[data-values]')?.getAttribute('data-values') === '[0,50,25]');
    checks.push('unavailable phase is visibly incomplete, never zero, and recovers via authorized loader');
    // Ownership is established only by the explicit curve drawing action.
    const originalUID = await roiUID(), oldCount = await page.getByTestId('roi-summary').innerText();
    const beforeOrdinary = (await roiState(originalUID)).uids;
    await tool('EllipticalROI'); await drawMouse([72, 22], [75, 25]);
    const ordinaryUID = (await roiState(originalUID)).uids.find(uid => !beforeOrdinary.includes(uid));
    assert.ok(ordinaryUID); assert.equal(await roiUID(), originalUID); assert.equal(await primary(), 'EllipticalROI');
    const ordinaryPoints = (await roiState(ordinaryUID)).points;
    await tool('StackScroll'); checks.push('normal toolbar ROI remains independent of curve selection and tool restoration');
    await page.getByRole('button', { name: 'Replace ROI', exact: true }).click();
    await page.evaluate(uid => {
      const s = window.services, core = window.cornerstone, tools = window.cornerstoneTools;
      core.utilities.triggerEvent(core.eventTarget, tools.Enums.Events.ANNOTATION_ADDED, { annotation: tools.annotation.state.getAnnotation(uid), viewportId: s.viewportGridService.getActiveViewportId() });
    }, ordinaryUID);
    await page.getByRole('button', { name: 'Cancel drawing', exact: true }).click();
    assert.deepEqual((await roiState(ordinaryUID)).points, ordinaryPoints); assert.equal(await roiUID(), originalUID);
    checks.push('external annotation-added events during replacement cannot transfer ownership or delete ordinary measurements');
    await page.getByRole('button', { name: 'Replace ROI', exact: true }).click();
    assert.ok((await roiState(originalUID)).points); await drawMouse([60, 60], [65, 65]);
    await page.waitForFunction(previous => { const uid = document.querySelector('[aria-label="MRI enhancement curve"]')?.getAttribute('data-roi-uid'); return uid && uid !== previous; }, originalUID);
    let replacementUID = await roiUID(); assert.equal(await primary(), 'StackScroll');
    const replaced = await roiState(replacementUID);
    assert.deepEqual(replaced.uids.sort(), [replacementUID, ordinaryUID].sort());
    assert.notEqual(await page.getByTestId('roi-summary').innerText(), oldCount);
    assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [0, 50, 25]);
    checks.push('validated replacement removes only the previous curve-owned UID and updates measurements');
    await page.getByRole('button', { name: 'Replace ROI', exact: true }).click();
    const cancelRect = await element.boundingBox();
    await page.mouse.move(cancelRect.x + cancelRect.width * .2, cancelRect.y + cancelRect.height * .7); await page.mouse.down();
    await page.mouse.move(cancelRect.x + cancelRect.width * .2 + 12, cancelRect.y + cancelRect.height * .7 + 12, { steps: 3 });
    await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal(await roiUID(), replacementUID); assert.deepEqual((await roiState(replacementUID)).uids.sort(), [replacementUID, ordinaryUID].sort());
    assert.equal(await primary(), 'StackScroll'); checks.push('Escape cancels an unfinished replacement without deleting the original or unrelated ROI');
    await page.getByRole('button', { name: 'Replace ROI', exact: true }).click();
    const invalidPoints = await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), z = v.getCamera().focalPoint[2]; return [[25, 65, z], [30, 70, z]].map(p => v.worldToCanvas(p)); });
    await page.mouse.move(cancelRect.x + invalidPoints[0][0], cancelRect.y + invalidPoints[0][1]); await page.mouse.down();
    await page.mouse.move(cancelRect.x + invalidPoints[1][0], cancelRect.y + invalidPoints[1][1], { steps: 6 });
    await page.evaluate(existing => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); const candidate = window.cornerstoneTools.annotation.state.getAnnotations('EllipticalROI', v.element).find(a => !existing.includes(a.annotationUID)); candidate.data.handles.points[0][2] += 1; }, [replacementUID, ordinaryUID]);
    await page.mouse.up(); await page.getByRole('status').filter({ hasText: 'Original ROI retained' }).waitFor();
    assert.equal(await roiUID(), replacementUID); assert.deepEqual((await roiState(replacementUID)).uids.sort(), [replacementUID, ordinaryUID].sort());
    checks.push('invalid replacement retains the original geometry and curve');
    await page.getByRole('button', { name: 'Close enhancement curve' }).click();
    await page.getByRole('button', { name: 'Enhancement Curve', exact: true }).click();
    await chart.waitFor(); assert.equal(await roiUID(), replacementUID);
    assert.deepEqual((await roiState(replacementUID)).uids.sort(), [replacementUID, ordinaryUID].sort());
    checks.push('close and reopen reuse the same curve ROI without duplication');
    await page.getByRole('button', { name: 'Delete ROI', exact: true }).click();
    assert.equal(await roiUID(), null); assert.equal(await chart.count(), 0); assert.deepEqual((await roiState(ordinaryUID)).uids, [ordinaryUID]);
    await page.getByRole('button', { name: 'Draw ROI', exact: true }).click(); await drawMouse([60, 60], [65, 65]);
    await chart.waitFor(); replacementUID = await roiUID(); assert.ok(replacementUID); assert.equal(await primary(), 'StackScroll');
    checks.push('mouse Delete removes only the selected ROI and Draw ROI starts a fresh single-ROI analysis');
    await page.setViewportSize({ width: 1024, height: 768 });
    const touch = await context.newCDPSession(page);
    await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await page.evaluate(() => {
      window.__curveTouchEvents = [];
      document.addEventListener('touchmove', event => window.__curveTouchEvents.push({ trusted: event.isTrusted, fingers: event.touches.length, target: event.target.className }), true);
      document.addEventListener('CORNERSTONE_TOOLS_TOUCH_DRAG', event => window.__curveTouchEvents.push({ canvas: event.detail.currentPoints.canvas, start: event.detail.startPoints.canvas, fingers: event.detail.event.touches.length, interacting: window.cornerstoneTools.state.isInteractingWithTool }), true);
      for (const name of ['touchstart', 'touchend', 'click']) document.addEventListener(name, event => { if (event.target.closest?.('.rispro-dynamic-mri')) window.__curveTouchEvents.push({ type: name, text: event.target.textContent, trusted: event.isTrusted }); }, true);
    });
    const swipe = async (x, y, dx, dy, fingers = 1) => {
      const points = (deltaX, deltaY) => Array.from({ length: fingers }, (_, i) => ({ x: x + deltaX + i * 40, y: y + deltaY, id: i + 1, radiusX: 1, radiusY: 1, force: 1 }));
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0, 0) });
      for (let i = 1; i <= 8; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(dx * i / 8, dy * i / 8) });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const navigationRect = await element.boundingBox(), navX = navigationRect.x + navigationRect.width * .12, navY = navigationRect.y + navigationRect.height * .75;
    await firstPhase();
    // Pinned preventGhostClick.js deliberately suppresses the other input type
    // for 2000ms. Respect that guard when switching from mouse to touch tests.
    await page.waitForTimeout(2100);
    const touchCamera = (await state()).camera, touchPoints = (await roiState(replacementUID)).points;
    for (const phase of [2, 3]) { await swipe(navX, navY, 27, 0); assert.equal((await state()).phase, phase); await visibleRoi(replacementUID); }
    assert.deepEqual((await roiState(replacementUID)).points, touchPoints); assert.deepEqual((await state()).camera, touchCamera);
    assert.deepEqual((await roiState(replacementUID)).uids.sort(), [replacementUID, ordinaryUID].sort());
    await swipe(navX, navY - 250, 0, 220); assert.equal((await state()).phase, 3); assert.notDeepEqual((await state()).position, touchCamera.focalPoint);
    await page.waitForFunction(uid => !document.querySelector(`ellipse[data-id="${uid}-ellipse"]`), replacementUID);
    await page.evaluate(camera => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); v.setCamera(camera); v.render(); }, touchCamera);
    await visibleRoi(replacementUID);
    const pinchBefore = (await state()).camera;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: navX, y: navY, id: 1 }, { x: navX + 80, y: navY, id: 2 }] });
    for (let i = 1; i <= 8; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: navX - 2.5 * i, y: navY, id: 1 }, { x: navX + 80 + 2.5 * i, y: navY, id: 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal((await state()).phase, 3); assert.notEqual((await state()).camera.parallelScale, pinchBefore.parallelScale);
    await visibleRoi(replacementUID); assert.deepEqual((await roiState(replacementUID)).points, touchPoints);
    assert.equal(await page.evaluate(() => window.__curveTouchEvents.some(event => event.trusted && event.fingers === 1)), true);
    checks.push('trusted single-finger touch changes phases/slices without drawing; two-finger zoom retains native behavior');
    await page.getByRole('button', { name: 'Delete ROI', exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await roiUID(), null); assert.equal(await chart.count(), 0);
    assert.deepEqual((await roiState(ordinaryUID)).uids, [ordinaryUID]); assert.deepEqual((await roiState(ordinaryUID)).points, ordinaryPoints);
    await page.getByRole('button', { name: 'Draw ROI', exact: true }).waitFor();
    checks.push('keyboard/desktop deletion clears owned ROI, measurements and baseline while preserving ordinary annotations');
    await page.setViewportSize({ width: 1024, height: 768 });
    const drawButton = await page.getByRole('button', { name: 'Draw ROI', exact: true }).boundingBox();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: drawButton.x + drawButton.width / 2, y: drawButton.y + drawButton.height / 2, id: 1 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const touchDrawRect = await element.boundingBox();
    const touchDrawPoints = await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), z = v.getCamera().focalPoint[2]; return [[30, 50, z], [35, 55, z]].map(p => v.worldToCanvas(p)); });
    await swipe(touchDrawRect.x + touchDrawPoints[0][0], touchDrawRect.y + touchDrawPoints[0][1], touchDrawPoints[1][0] - touchDrawPoints[0][0], touchDrawPoints[1][1] - touchDrawPoints[0][1]);
    await chart.waitFor(); assert.equal(await primary(), 'StackScroll');
    const mobileUID = await roiUID(); assert.ok(mobileUID); await visibleRoi(mobileUID);
    const beforeTouchEdit = await roiState(mobileUID), editPhase = (await state()).phase;
    const editPoint = await page.evaluate(({ uid, rect }) => {
      const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), p = window.cornerstoneTools.annotation.state.getAnnotation(uid).data.handles.points;
      // A horizontal handle changes width under horizontal input; a top/bottom
      // handle intentionally ignores that direction. Avoid the floating panel.
      return [p[2], p[3]].map(point => v.worldToCanvas(point)).find(point => document.elementFromPoint(rect.x + point[0], rect.y + point[1])?.classList.contains('cornerstone-canvas'));
    }, { uid: mobileUID, rect: touchDrawRect });
    assert.ok(editPoint, 'A native ROI width handle is reachable outside the panel');
    await swipe(touchDrawRect.x + editPoint[0], touchDrawRect.y + editPoint[1], -30, 0);
    assert.equal((await state()).phase, editPhase); assert.notDeepEqual((await roiState(mobileUID)).points, beforeTouchEdit.points);
    await visibleRoi(mobileUID); assert.deepEqual((await roiState(mobileUID)).uids.sort(), [mobileUID, ordinaryUID].sort());
    checks.push('single-finger ROI editing retains priority over phase navigation');
    const deleteButton = await page.getByRole('button', { name: 'Delete ROI', exact: true }).boundingBox();
    assert.ok(deleteButton.width >= 44 && deleteButton.height >= 44);
    await swipe(deleteButton.x + deleteButton.width / 2, deleteButton.y + deleteButton.height / 2, deleteButton.width + 20, 0);
    assert.equal(await roiUID(), mobileUID);
    checks.push('dragging away from Delete does not delete the ROI');
    await page.getByRole('button', { name: 'Delete ROI', exact: true }).tap();
    await page.waitForFunction(() => !document.querySelector('[aria-label="MRI enhancement curve"]')?.getAttribute('data-roi-uid'));
    assert.equal(await chart.count(), 0); assert.deepEqual((await roiState(ordinaryUID)).uids, [ordinaryUID]);
    assert.deepEqual((await roiState(ordinaryUID)).points, ordinaryPoints);
    checks.push('real touch drawing returns to StackScroll and a 44px touch Delete button removes only the curve ROI');
    await touch.detach();
    await page.screenshot({ path: join(temp, 'dynamic-mri-desktop.png') });
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: join(temp, 'dynamic-mri-ipad.png') });
    const panel = await page.getByRole('region', { name: 'MRI enhancement curve' }).boundingBox(); assert.ok(panel.x >= 0 && panel.x + panel.width <= 1024 && panel.y + panel.height <= 768);
    const phaseSlider = await slider.boundingBox(); assert.ok(panel.y >= phaseSlider.y + phaseSlider.height + 8, 'Analysis panel must not cover Cine phase controls');
    checks.push('iPad landscape panel remains within viewport');
    await page.getByRole('button', { name: 'Close enhancement curve' }).click();
    assert.equal(await page.evaluate(() => { const s = window.services; return s.toolGroupService.getToolGroupForViewport(s.viewportGridService.getActiveViewportId()).getActivePrimaryMouseButtonTool(); }), 'StackScroll');
    checks.push('closing restores previous interaction tool without deleting annotations');
    // Troubleshooting override disables only this component; ordinary dynamic navigation remains upstream.
    url.searchParams.set('risproDynamicMri', 'off'); await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.services?.displaySetService.getActiveDisplaySets().some(ds => ds.isDynamicVolume), null, { timeout: 90000 });
    assert.equal(await page.getByRole('button', { name: 'Enhancement Curve', exact: true }).count(), 0);
    checks.push('per-tab OFF preserves upstream dynamic viewport');
    url.searchParams.delete('risproDynamicMri'); url.searchParams.set('initialSeriesInstanceUID', c.study + '.11');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Enhancement Curve', exact: true }).waitFor({ timeout: 90000 });
    await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); const camera = v.getCamera(), offset = 6 - camera.focalPoint[2]; v.setCamera({ focalPoint: [camera.focalPoint[0], camera.focalPoint[1], 6], position: [camera.position[0], camera.position[1], camera.position[2] + offset] }); v.render(); });
    await page.getByRole('button', { name: 'Enhancement Curve', exact: true }).click();
    const enhancedBox = await page.locator('.cornerstone-viewport-element').first().boundingBox();
    const enhancedCorners = await page.evaluate(() => { const s = window.services, v = s.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); const z = v.getCamera().focalPoint[2]; return [[38, 38, z], [58, 58, z]].map(p => v.worldToCanvas(p)); });
    await page.mouse.move(enhancedBox.x + enhancedCorners[0][0], enhancedBox.y + enhancedCorners[0][1]); await page.mouse.down();
    await page.mouse.move(enhancedBox.x + enhancedCorners[1][0], enhancedBox.y + enhancedCorners[1][1], { steps: 10 }); await page.mouse.up();
    await chart.waitFor({ timeout: 30000 }); assert.deepEqual(JSON.parse(await chart.getAttribute('data-values')), [100, 150, 125]);
    checks.push('supported enhanced multiframe compatibility layout samples the corresponding native frame per phase');
    url.searchParams.delete('risproDynamicMri'); url.searchParams.set('initialSeriesInstanceUID', c.study + '.2');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => { try { const s = window.services, v = s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()); return v?.getCurrentImageId?.()?.includes('.2/instances/'); } catch { return false; } }, null, { timeout: 90000 });
    assert.equal(await page.getByRole('button', { name: 'Enhancement Curve', exact: true }).count(), 0); checks.push('ordinary MRI has unchanged controls');
    assert.deepEqual(errors, []); save(); console.log(JSON.stringify({ dynamicMri: 'PASS', checks }));
  } catch (error) {
    checks.push('FAIL: ' + error.message); save();
    writeFileSync(join(temp, 'dynamic-mri-state.json'), JSON.stringify(await page.evaluate(() => {
      const s = window.services, core = window.cornerstone;
      const v = s?.cornerstoneViewportService.getCornerstoneViewport(s.viewportGridService.getActiveViewportId()), group = s?.toolGroupService.getToolGroupForViewport(v?.id);
      return { touchEvents: window.__curveTouchEvents, toolOptions: group?.toolOptions, toolState: { interacting: window.cornerstoneTools?.state.isInteractingWithTool, multipart: window.cornerstoneTools?.state.isMultiPartToolActive }, camera: v?.getCamera(), touchAction: v && getComputedStyle(v.element).touchAction,
        annotations: v && window.cornerstoneTools.annotation.state.getAnnotations('EllipticalROI', v.element).map(a => ({ uid: a.annotationUID, points: a.data.handles.points })),
        displaySets: s?.displaySetService.getActiveDisplaySets().map(ds => ({ uid: ds.displaySetInstanceUID, series: ds.SeriesInstanceUID, dynamic: ds.isDynamicVolume, reconstructable: ds.isReconstructable, info: ds.dynamicVolumeInfo })),
        volumes: core?.cache.getVolumes().map(v => ({ id: v.volumeId, loaded: v.loadStatus, phase: v.dimensionGroupNumber, groups: v.numDimensionGroups, imageIds: v.imageIds.length })) };
    }).catch(() => null), null, 2));
    await page.screenshot({ path: join(temp, 'dynamic-mri-failure.png') }).catch(() => {});
    writeFileSync(join(temp, 'dynamic-mri-failure.txt'), await page.locator('body').innerText().catch(() => ''));
    throw error;
  } finally { await context.close(); }
}
