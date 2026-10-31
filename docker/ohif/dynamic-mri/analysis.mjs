// Single-series temporal MR only. Metadata and decoded pixels stay in the viewer.
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const mid = (a, b) => a.map((value, i) => (value + b[i]) / 2);
const norm = a => Math.hypot(...a);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(v => v !== '' && Number.isFinite(Number(v))) ? value.map(Number) : null;
const scalar = value => value == null || value === '' ? undefined : Number([].concat(value)[0]);
const near = (a, b, tolerance) => a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

export function geometry(instance) {
  const orientation = vector(instance?.ImageOrientationPatient, 6);
  const origin = vector(instance?.ImagePositionPatient, 3);
  const spacing = vector(instance?.PixelSpacing, 2);
  const rows = Number(instance?.Rows), columns = Number(instance?.Columns);
  if (!orientation || !origin || !spacing || spacing.some(v => v <= 0) ||
      !Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || !instance.FrameOfReferenceUID) return null;
  const row = orientation.slice(0, 3), column = orientation.slice(3);
  if (Math.abs(norm(row) - 1) > 1e-4 || Math.abs(norm(column) - 1) > 1e-4 || Math.abs(dot(row, column)) > 1e-4) return null;
  return { row, column, normal: cross(row, column), origin, spacing, rows, columns, frameOfReferenceUID: instance.FrameOfReferenceUID };
}

export function samePlane(a, b) {
  return !!a && !!b && a.frameOfReferenceUID === b.frameOfReferenceUID && a.rows === b.rows && a.columns === b.columns &&
    near(a.row, b.row, 1e-4) && near(a.column, b.column, 1e-4) && near(a.spacing, b.spacing, 1e-4) && near(a.origin, b.origin, 0.1);
}

function acquisitionSeconds(instance) {
  const dateTime = instance.FrameAcquisitionDateTime || instance.AcquisitionDateTime ||
    (instance.AcquisitionDate && instance.AcquisitionTime ? instance.AcquisitionDate + instance.AcquisitionTime : '');
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?([+-]\d{4})?$/.exec(dateTime);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const stamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(stamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const zone = match[8];
  const offset = zone ? (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(3))) * (zone[0] === '+' ? 1 : -1) : 0;
  if (zone && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(3)) > 59)) return null;
  return { seconds: stamp / 1000 + Number(match[7] || 0) - offset * 60, zone: zone ? 'offset' : 'local' };
}

export function temporalContext(displaySets, volume, getInstance) {
  if (displaySets?.length !== 1) return null;
  const ds = displaySets[0], groups = ds.dynamicVolumeInfo?.timePoints;
  if (ds.Modality !== 'MR' || !ds.isDynamicVolume || !volume?.isDynamicVolume?.() ||
      !Array.isArray(groups) || groups.length < 2 || volume.numDimensionGroups !== groups.length ||
      !['TemporalPositionIdentifier', 'TemporalPositionIndex', 'TimeSlotVector'].includes(ds.dynamicVolumeInfo.splittingTag)) return null;
  const frames = groups.map(group => Array.isArray(group) ? group.map(id => {
    const instance = getInstance(id);
    return { id, instance, geometry: geometry(instance), time: instance && acquisitionSeconds(instance) };
  }) : []);
  const all = frames.flat(), ids = all.map(frame => frame.id);
  if (!frames[0].length || frames.some(group => group.length !== frames[0].length) || new Set(ids).size !== ids.length ||
      all.some(frame => !frame.geometry || frame.instance.Modality !== 'MR' || frame.instance.SeriesInstanceUID !== ds.SeriesInstanceUID || frame.instance.StudyInstanceUID !== ds.StudyInstanceUID)) return null;
  const idSet = new Set(ids);
  if (volume.imageIds?.length !== ids.length || volume.imageIds.some(id => !idSet.has(id))) return null;
  const current = volume.getCurrentDimensionGroupImageIds?.();
  if (!current || current.length !== groups[volume.dimensionGroupNumber - 1]?.length || current.some(id => !groups[volume.dimensionGroupNumber - 1].includes(id))) return null;
  // Reject diffusion/echo dimensions even when a vendor also supplies a TPI.
  const echoes = new Set(), echoNumbers = new Set();
  for (const { instance } of all) {
    if (/DIFFUSION|\bADC\b/i.test([].concat(instance.ImageType || [], instance.FrameType || []).join(' ')) || scalar(instance.DiffusionBValue) > 0) return null;
    const echo = scalar(instance.EffectiveEchoTime ?? instance.EchoTime), number = scalar(instance.EchoNumbers ?? instance.EchoNumber);
    if (Number.isFinite(echo)) echoes.add(echo);
    if (Number.isFinite(number)) echoNumbers.add(number);
  }
  if (echoes.size > 1 || echoNumbers.size > 1) return null;
  const temporalIds = frames.map(group => new Set(group.map(frame => scalar(frame.instance.TemporalPositionIdentifier ?? frame.instance.TemporalPositionIndex))));
  const explicitTemporal = temporalIds.every(set => set.size === 1 && Number.isInteger([...set][0]) && [...set][0] > 0) &&
    temporalIds.every((set, i) => !i || [...set][0] > [...temporalIds[i - 1]][0]);
  const orderedTimes = frames.every(group => group.every(frame => frame.time)) &&
    new Set(all.map(frame => frame.time?.zone)).size === 1 && frames.every((group, i) => !i || Math.min(...group.map(f => f.time.seconds)) > Math.max(...frames[i - 1].map(f => f.time.seconds)));
  if (!explicitTemporal && !orderedTimes) return null;
  // Match every anatomical plane by patient geometry, never group array index.
  for (const reference of frames[0]) {
    const first = frames[0][0].geometry, g = reference.geometry;
    if (g.frameOfReferenceUID !== first.frameOfReferenceUID || g.rows !== first.rows || g.columns !== first.columns ||
        !near(g.row, first.row, 1e-4) || !near(g.column, first.column, 1e-4) || !near(g.spacing, first.spacing, 1e-4)) return null;
    if (frames.some(group => group.filter(frame => samePlane(reference.geometry, frame.geometry)).length !== 1)) return null;
  }
  return { displaySet: ds, volume, frames, ids, frameOfReferenceUID: frames[0][0].geometry.frameOfReferenceUID };
}

export function roiPlane(context, annotation) {
  const points = annotation?.data?.handles?.points;
  if (annotation?.metadata?.toolName !== 'EllipticalROI' || annotation.metadata.FrameOfReferenceUID !== context.frameOfReferenceUID ||
      !context.ids.includes(annotation.metadata.referencedImageId) || !Array.isArray(points) || points.length !== 4 || points.some(p => !vector(p, 3))) throw Error('ROI geometry unavailable for this dynamic series.');
  const center = mid(points[0], points[1]), otherCenter = mid(points[2], points[3]);
  const a = sub(points[1], points[0]).map(v => v / 2), b = sub(points[3], points[2]).map(v => v / 2);
  if (!near(center, otherCenter, 0.01) || norm(a) < 1e-4 || norm(b) < 1e-4 || Math.abs(dot(a, b) / norm(a) / norm(b)) > 1e-3) throw Error('ROI must be a valid planar ellipse.');
  const candidates = context.frames[0].filter(frame => points.every(point => Math.abs(dot(sub(point, frame.geometry.origin), frame.geometry.normal)) <= 0.1));
  if (candidates.length !== 1) throw Error('ROI is not on one verified acquisition plane. Oblique or unmatched planes are unavailable.');
  const reference = candidates[0];
  return { points, center, a, b, reference, frames: context.frames.map(group => group.find(frame => samePlane(reference.geometry, frame.geometry))) };
}

export function meanSignal(frame, ellipse, image, worldToIndex) {
  const g = frame.geometry, instance = frame.instance;
  if (!image) throw Error('Decoded phase image unavailable.');
  if (image.color || image.numberOfComponents > 1 || instance.SamplesPerPixel > 1 ||
      (instance.PhotometricInterpretation && !/^MONOCHROME[12]$/.test(instance.PhotometricInterpretation))) throw Error('Color or multi-component MRI pixels are unsupported.');
  if (image.rows !== g.rows || image.columns !== g.columns) throw Error('Decoded image dimensions do not match source geometry.');
  const modalityLut = instance.ModalityLUTSequence;
  if (modalityLut != null && (!Array.isArray(modalityLut) || modalityLut.length)) throw Error('Nonlinear modality LUT is unsupported.');
  const realWorld = instance.RealWorldValueMappingSequence;
  if (realWorld != null && (!Array.isArray(realWorld) || realWorld.some(item => !item ||
      item.RealWorldValueLUTData != null || !Number.isFinite(scalar(item.RealWorldValueSlope)) ||
      !Number.isFinite(scalar(item.RealWorldValueIntercept))))) throw Error('Nonlinear or incomplete real-world value mapping is unsupported.');
  // SI uses Cornerstone's modality signal, as the existing ROI tool does.
  // Real-world mapping is a separate DICOM transform, never another rescale.
  const pixels = image.getPixelData?.();
  if (!pixels || pixels.length !== g.rows * g.columns) throw Error('Decoded phase pixels unavailable.');
  const toPixel = point => {
    const delta = sub(point, g.origin);
    // DICOM: column index follows IOP's row vector and PixelSpacing[1].
    const xy = [dot(delta, g.row) / g.spacing[1], dot(delta, g.column) / g.spacing[0]];
    if (worldToIndex) {
      const verified = worldToIndex(point);
      if (!verified || !near(xy, verified.slice(0, 2), 1e-3)) throw Error('ROI pixel transform does not match source geometry.');
      return verified.slice(0, 2);
    }
    return xy;
  };
  const center = toPixel(ellipse.center), handles = ellipse.points.map(toPixel);
  const low = [Math.min(...handles.map(p => p[0])), Math.min(...handles.map(p => p[1]))];
  const high = [Math.max(...handles.map(p => p[0])), Math.max(...handles.map(p => p[1]))];
  // A rotated ellipse can extend beyond its four axis endpoints.
  const radiusX = Math.hypot((handles[1][0] - handles[0][0]) / 2, (handles[3][0] - handles[2][0]) / 2);
  const radiusY = Math.hypot((handles[1][1] - handles[0][1]) / 2, (handles[3][1] - handles[2][1]) / 2);
  low[0] = center[0] - radiusX; low[1] = center[1] - radiusY;
  high[0] = center[0] + radiusX; high[1] = center[1] + radiusY;
  const scaling = image.preScale?.scalingParameters;
  const slope = Number(scaling?.rescaleSlope ?? image.slope ?? instance.RescaleSlope ?? 1);
  const intercept = Number(scaling?.rescaleIntercept ?? image.intercept ?? instance.RescaleIntercept ?? 0);
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) throw Error('Pixel rescale unavailable.');
  const scaled = image.preScale?.scaled === true;
  const padding = scalar(instance.PixelPaddingValue), paddingLimit = scalar(instance.PixelPaddingRangeLimit) ?? padding;
  const paddingA = padding * (scaled ? slope : 1) + (scaled ? intercept : 0);
  const paddingB = paddingLimit * (scaled ? slope : 1) + (scaled ? intercept : 0);
  const aa = dot(ellipse.a, ellipse.a), bb = dot(ellipse.b, ellipse.b);
  let sum = 0; const validIndices = [];
  for (let y = Math.max(0, Math.ceil(low[1])); y <= Math.min(g.rows - 1, Math.floor(high[1])); y++) {
    for (let x = Math.max(0, Math.ceil(low[0])); x <= Math.min(g.columns - 1, Math.floor(high[0])); x++) {
      const world = g.origin.map((value, i) => value + x * g.spacing[1] * g.row[i] + y * g.spacing[0] * g.column[i]);
      const delta = sub(world, ellipse.center);
      if ((dot(delta, ellipse.a) / aa) ** 2 + (dot(delta, ellipse.b) / bb) ** 2 > 1 + 1e-8) continue;
      const index = y * g.columns + x, raw = pixels[index];
      if (!Number.isFinite(raw) || (padding !== undefined && raw >= Math.min(paddingA, paddingB) && raw <= Math.max(paddingA, paddingB))) continue;
      const value = scaled ? raw : raw * slope + intercept;
      if (!Number.isFinite(value)) continue;
      sum += value; validIndices.push(index);
    }
  }
  if (!validIndices.length) throw Error('No valid ROI pixels in this phase.');
  return { mean: sum / validIndices.length, count: validIndices.length, validIndices, units: instance.RescaleType || 'a.u.' };
}

export async function sampleCurve(context, annotation, { loadImage, worldToIndex, cancelled = () => false, onPhase = () => {} }) {
  const ellipse = roiPlane(context, annotation), results = [];
  for (let index = 0; index < ellipse.frames.length; index++) {
    if (cancelled()) return null;
    const frame = ellipse.frames[index];
    try {
      const image = await loadImage(frame.id);
      if (cancelled()) return null;
      results.push({ phase: index + 1, ...meanSignal(frame, ellipse, image, worldToIndex), time: frame.time });
    } catch (error) { results.push({ phase: index + 1, mean: null, count: 0, error: error?.message || 'Phase image could not be loaded.' }); }
    onPhase([...results]);
  }
  return results;
}

export function curveStatus(results) {
  const failures = results.filter(result => result.error);
  if (!failures.length) return '';
  const reasons = new Map();
  for (const result of failures) {
    if (!reasons.has(result.error)) reasons.set(result.error, []);
    reasons.get(result.error).push(result.phase);
  }
  const details = [...reasons].map(([reason, phases]) => {
    const consecutive = phases.every((phase, i) => !i || phase === phases[i - 1] + 1);
    const label = phases.length === 1 ? `Phase ${phases[0]}` :
      `Phases ${consecutive ? `${phases[0]}–${phases.at(-1)}` : phases.join(', ')}`;
    return `${label}: ${reason}`;
  });
  return `Incomplete curve: ${failures.length}/${results.length} phases unavailable. ${details.join(' ')}`;
}

export function curveValues(results, mode, baselinePhase) {
  if (mode === 'signal') return results.map(result => result.mean);
  const baseline = results.find(result => result.phase === Number(baselinePhase));
  if (!baseline || !Number.isFinite(baseline.mean) || baseline.mean === 0) throw Error('Select a valid nonzero baseline phase. Precontrast is not assumed.');
  return results.map(result => {
    if (!Number.isFinite(result.mean)) return null;
    if (result.units !== baseline.units || result.validIndices.length !== baseline.validIndices.length || result.validIndices.some((value, i) => value !== baseline.validIndices[i])) return null;
    return 100 * (result.mean - baseline.mean) / baseline.mean;
  });
}

export function timeAxis(results) {
  const reliable = results.every(result => result.time) && new Set(results.map(result => result.time.zone)).size === 1 &&
    results.every((result, i) => !i || result.time.seconds > results[i - 1].time.seconds);
  return { label: reliable ? 'Time (s)' : 'Phase', values: results.map(result => reliable ? result.time.seconds - results[0].time.seconds : result.phase) };
}
