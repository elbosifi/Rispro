export type AnatomyVoxelData = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array | BigInt64Array | BigUint64Array;

export interface AnatomyNrrdGeometry {
  sizes: [number, number, number];
  coordinateSystem: "LPS" | "RAS";
  origin: [number, number, number];
  directions: [[number, number, number], [number, number, number], [number, number, number]];
}

export interface ParsedAnatomyNrrd {
  geometry: AnatomyNrrdGeometry;
  data: AnatomyVoxelData;
  type: string;
  slope: number;
  intercept: number;
}

export type AnatomyPlane = "axial" | "coronal" | "sagittal";

export interface AnatomyPlaneSpec {
  width: number;
  height: number;
  sliceCount: number;
  spacingX: number;
  spacingY: number;
  spacingNormal: number;
  uMin: number;
  vMin: number;
  normalMin: number;
  horizontal: [number, number, number];
  vertical: [number, number, number];
  normal: [number, number, number];
  leftMarker: "R" | "A";
  rightMarker: "L" | "P";
}

export interface ReslicedAnatomyPlane {
  width: number;
  height: number;
  spacingX: number;
  spacingY: number;
  values: Float32Array;
  validMask: Uint8Array;
  labels: Int32Array | null;
  markers: { left: "R" | "A"; right: "L" | "P" };
}

function fieldValue(header: Map<string, string>, key: string): string | undefined {
  return header.get(key.toLowerCase());
}

function parseNumberList(value: string | undefined, expected: number, field: string): number[] {
  if (!value) throw new Error(`NRRD ${field} metadata is missing.`);
  const values = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length !== expected || values.some((number) => !Number.isFinite(number))) {
    throw new Error(`NRRD ${field} metadata is invalid.`);
  }
  return values;
}

function parseDirectionVectors(value: string | undefined): AnatomyNrrdGeometry["directions"] {
  if (!value) throw new Error("NRRD space directions metadata is missing.");
  const tuples = Array.from(value.matchAll(/\(([^)]+)\)/g), (match) => parseNumberList(match[1], 3, "space directions"));
  if (tuples.length !== 3) throw new Error("The anatomy viewer requires three spatial NRRD direction vectors.");
  return tuples as AnatomyNrrdGeometry["directions"];
}

function parseTypedData(bytes: Uint8Array, type: string, endian: string, count: number): AnatomyVoxelData {
  const normalized = type.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
  const constructors: Record<string, { bytes: number; make: () => AnatomyVoxelData; read: (view: DataView, offset: number, little: boolean) => number | bigint }> = {
    "signed char": { bytes: 1, make: () => new Int8Array(count), read: (view, offset) => view.getInt8(offset) },
    char: { bytes: 1, make: () => new Int8Array(count), read: (view, offset) => view.getInt8(offset) },
    "unsigned char": { bytes: 1, make: () => new Uint8Array(count), read: (view, offset) => view.getUint8(offset) },
    uchar: { bytes: 1, make: () => new Uint8Array(count), read: (view, offset) => view.getUint8(offset) },
    short: { bytes: 2, make: () => new Int16Array(count), read: (view, offset, little) => view.getInt16(offset, little) },
    "unsigned short": { bytes: 2, make: () => new Uint16Array(count), read: (view, offset, little) => view.getUint16(offset, little) },
    ushort: { bytes: 2, make: () => new Uint16Array(count), read: (view, offset, little) => view.getUint16(offset, little) },
    int: { bytes: 4, make: () => new Int32Array(count), read: (view, offset, little) => view.getInt32(offset, little) },
    "signed int": { bytes: 4, make: () => new Int32Array(count), read: (view, offset, little) => view.getInt32(offset, little) },
    uint: { bytes: 4, make: () => new Uint32Array(count), read: (view, offset, little) => view.getUint32(offset, little) },
    "unsigned int": { bytes: 4, make: () => new Uint32Array(count), read: (view, offset, little) => view.getUint32(offset, little) },
    float: { bytes: 4, make: () => new Float32Array(count), read: (view, offset, little) => view.getFloat32(offset, little) },
    double: { bytes: 8, make: () => new Float64Array(count), read: (view, offset, little) => view.getFloat64(offset, little) },
    "long long": { bytes: 8, make: () => new BigInt64Array(count), read: (view, offset, little) => view.getBigInt64(offset, little) },
    "unsigned long long": { bytes: 8, make: () => new BigUint64Array(count), read: (view, offset, little) => view.getBigUint64(offset, little) },
  };
  const descriptor = constructors[normalized];
  if (!descriptor) throw new Error(`NRRD voxel type “${type}” is not supported by the anatomy viewer.`);
  if (bytes.byteLength !== count * descriptor.bytes) {
    throw new Error(`NRRD voxel data length is ${bytes.byteLength} bytes; expected ${count * descriptor.bytes}.`);
  }
  const little = endian !== "big";
  const output = descriptor.make();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < count; index += 1) {
    const value = descriptor.read(view, index * descriptor.bytes, little);
    if (output instanceof BigInt64Array) output[index] = BigInt(value);
    else if (output instanceof BigUint64Array) output[index] = BigInt(value);
    else (output as Exclude<AnatomyVoxelData, BigInt64Array | BigUint64Array>)[index] = Number(value);
  }
  return output;
}

async function decodePayload(payload: Uint8Array, encoding: string): Promise<Uint8Array> {
  const normalized = encoding.trim().toLowerCase();
  if (normalized === "raw") return payload;
  if (normalized === "gzip" || normalized === "gz") {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser does not support gzip compressed NRRD volumes.");
    const compressedBytes = new Uint8Array(payload.byteLength);
    compressedBytes.set(payload);
    const compressed = new Blob([compressedBytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(compressed).arrayBuffer());
  }
  throw new Error(`NRRD encoding “${encoding}” is not supported by the anatomy viewer.`);
}

export async function parseAnatomyNrrd(buffer: ArrayBuffer): Promise<ParsedAnatomyNrrd> {
  const source = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const searchLength = Math.min(source.length, 128 * 1024);
  let headerEnd = -1;
  let delimiterLength = 0;
  for (let index = 0; index < searchLength - 1; index += 1) {
    if (source[index] === 10 && source[index + 1] === 10) { headerEnd = index; delimiterLength = 2; break; }
    if (source[index] === 13 && source[index + 1] === 10 && source[index + 2] === 13 && source[index + 3] === 10) { headerEnd = index; delimiterLength = 4; break; }
  }
  if (headerEnd < 0) throw new Error("NRRD header is missing its data separator.");
  const headerText = decoder.decode(source.subarray(0, headerEnd));
  if (!headerText.startsWith("NRRD")) throw new Error("The anatomy file is not a NRRD volume.");
  const fields = new Map<string, string>();
  for (const line of headerText.split(/\r?\n/).slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const customSeparator = trimmed.indexOf(":=");
    const separator = customSeparator >= 0 ? customSeparator : trimmed.indexOf(":");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim().toLowerCase();
    fields.set(key, trimmed.slice(separator + (customSeparator >= 0 ? 2 : 1)).trim());
  }
  if (fieldValue(fields, "data file")) throw new Error("Detached NRRD data files are not supported; install the complete single-file NRRD volume.");
  if (Number(fieldValue(fields, "dimension")) !== 3) throw new Error("The anatomy viewer requires a 3D NRRD volume.");
  const sizes = parseNumberList(fieldValue(fields, "sizes"), 3, "sizes");
  if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1)) throw new Error("NRRD dimensions must be positive integers.");
  const space = fieldValue(fields, "space")?.toLowerCase();
  const coordinateSystem = space === "left-posterior-superior" || space === "lps" ? "LPS"
    : space === "right-anterior-superior" || space === "ras" ? "RAS"
      : null;
  if (!coordinateSystem) throw new Error(`NRRD spatial coordinate system “${space ?? "missing"}” is not supported; LPS or RAS is required.`);
  const originValue = fieldValue(fields, "space origin");
  const originTuple = originValue?.match(/^\(([^)]+)\)$/);
  const origin = parseNumberList(originTuple?.[1], 3, "space origin") as [number, number, number];
  const directions = parseDirectionVectors(fieldValue(fields, "space directions"));
  const elementCount = sizes.reduce((product, size) => product * size, 1);
  if (!Number.isSafeInteger(elementCount)) throw new Error("NRRD voxel count exceeds the supported range.");
  const payload = source.subarray(headerEnd + delimiterLength);
  const decoded = await decodePayload(payload, fieldValue(fields, "encoding") ?? "raw");
  const data = parseTypedData(decoded, fieldValue(fields, "type") ?? "", fieldValue(fields, "endian")?.toLowerCase() ?? "little", elementCount);
  const slope = Number(fieldValue(fields, "slope") ?? 1);
  const intercept = Number(fieldValue(fields, "intercept") ?? 0);
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) throw new Error("NRRD rescale slope or intercept metadata is invalid.");
  return {
    geometry: { sizes: sizes as [number, number, number], coordinateSystem, origin, directions },
    data,
    type: fieldValue(fields, "type") ?? "",
    slope,
    intercept,
  };
}

export function validateCompatibleAnatomyGeometry(image: AnatomyNrrdGeometry, labels: AnatomyNrrdGeometry): void {
  const close = (left: number, right: number) => Math.abs(left - right) <= 1e-4;
  if (image.sizes.some((size, index) => size !== labels.sizes[index])) throw new Error("The image and segmentation dimensions do not match.");
  if (image.coordinateSystem !== labels.coordinateSystem || image.origin.some((value, index) => !close(value, labels.origin[index]!))
    || image.directions.some((direction, axis) => direction.some((value, component) => !close(value, labels.directions[axis]![component]!)))) {
    throw new Error("The image and segmentation NRRD spatial transforms do not match.");
  }
}

function vectorLength(vector: readonly number[]): number {
  return Math.hypot(vector[0]!, vector[1]!, vector[2]!);
}

export function validateAxialAnatomyGeometry(geometry: AnatomyNrrdGeometry): void {
  const [x, y, z] = geometry.directions;
  const xLength = vectorLength(x);
  const yLength = vectorLength(y);
  const zLength = vectorLength(z);
  if (xLength === 0 || yLength === 0 || zLength === 0) throw new Error("NRRD spacing must be available and non-zero on all three axes.");
  const inPlaneCosine = (x[0] * y[0] + x[1] * y[1] + x[2] * y[2]) / (xLength * yLength);
  if (Math.abs(inPlaneCosine) > 0.01) throw new Error("The NRRD in-plane directions are skewed; a rectangular axial plane cannot faithfully represent this atlas.");
  const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const crossLength = vectorLength(cross);
  const normal = cross.map((component) => component / crossLength);
  const sliceAlignment = Math.abs(normal[0]! * z[0] / zLength + normal[1]! * z[1] / zLength + normal[2]! * z[2] / zLength);
  if (sliceAlignment < 0.99 || Math.abs(normal[2]!) < 0.95) {
    throw new Error("The installed NRRD slice axis is not aligned with axial patient space; the atlas cannot be displayed as an axial stack.");
  }
}

export function validateAnatomyGeometry(geometry: AnatomyNrrdGeometry): void {
  if (geometry.sizes.some((size) => !Number.isSafeInteger(size) || size < 1)
    || geometry.directions.some((direction) => direction.some((component) => !Number.isFinite(component)))) {
    throw new Error("The anatomy volume has invalid spatial dimensions or directions.");
  }
  const [x, y, z] = geometry.directions;
  const cross = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const determinant = x[0] * cross[0]! + x[1] * cross[1]! + x[2] * cross[2]!;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) {
    throw new Error("The anatomy volume spatial transform is singular.");
  }
}

function anatomyPlaneAxes(plane: AnatomyPlane): Pick<AnatomyPlaneSpec, "horizontal" | "vertical" | "normal" | "leftMarker" | "rightMarker"> {
  if (plane === "axial") return { horizontal: [1, 0, 0], vertical: [0, -1, 0], normal: [0, 0, -1], leftMarker: "R", rightMarker: "L" };
  if (plane === "coronal") return { horizontal: [1, 0, 0], vertical: [0, 0, 1], normal: [0, -1, 0], leftMarker: "R", rightMarker: "L" };
  return { horizontal: [0, 1, 0], vertical: [0, 0, 1], normal: [1, 0, 0], leftMarker: "A", rightMarker: "P" };
}

function toLps(point: readonly number[], coordinateSystem: "LPS" | "RAS"): [number, number, number] {
  return coordinateSystem === "RAS" ? [-point[0]!, -point[1]!, point[2]!] : [point[0]!, point[1]!, point[2]!];
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function projectedBounds(geometry: AnatomyNrrdGeometry, axis: readonly number[]): [number, number] {
  const values: number[] = [];
  for (const i of [0, geometry.sizes[0] - 1]) for (const j of [0, geometry.sizes[1] - 1]) for (const k of [0, geometry.sizes[2] - 1]) {
    const point = [0, 1, 2].map((component) => geometry.origin[component]!
      + geometry.directions[0][component]! * i + geometry.directions[1][component]! * j + geometry.directions[2][component]! * k);
    values.push(dot(toLps(point, geometry.coordinateSystem), axis));
  }
  return [Math.min(...values), Math.max(...values)];
}

function boundedGridSize(range: number, requestedSpacing: number): { count: number; spacing: number } {
  const count = Math.max(1, Math.min(1024, Math.ceil(range / requestedSpacing) + 1));
  return { count, spacing: count > 1 ? range / (count - 1) : requestedSpacing };
}

export function getAnatomyPlaneSpec(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane): AnatomyPlaneSpec {
  validateAnatomyGeometry(geometry);
  const axes = anatomyPlaneAxes(plane);
  const [uMin, uMax] = projectedBounds(geometry, axes.horizontal);
  const [vMin, vMax] = projectedBounds(geometry, axes.vertical);
  const [normalMin, normalMax] = projectedBounds(geometry, axes.normal);
  const voxelSpacing = Math.min(...geometry.directions.map((direction) => vectorLength(direction)));
  const normalSteps = geometry.directions.map((direction) => Math.abs(dot(toLps(direction, geometry.coordinateSystem), axes.normal)))
    .filter((step) => step > 1e-4);
  const requestedNormalSpacing = normalSteps.length ? Math.min(...normalSteps) : voxelSpacing;
  const horizontal = boundedGridSize(uMax - uMin, voxelSpacing);
  const vertical = boundedGridSize(vMax - vMin, voxelSpacing);
  const normal = boundedGridSize(normalMax - normalMin, requestedNormalSpacing);
  return {
    ...axes,
    width: horizontal.count,
    height: vertical.count,
    sliceCount: normal.count,
    spacingX: horizontal.spacing,
    spacingY: vertical.spacing,
    spacingNormal: normal.spacing,
    uMin,
    vMin,
    normalMin,
  };
}

function voxelCoordinatesFromLps(geometry: AnatomyNrrdGeometry, lpsPoint: readonly number[]): [number, number, number] {
  const origin = toLps(geometry.origin, geometry.coordinateSystem);
  const x = toLps(geometry.directions[0], geometry.coordinateSystem);
  const y = toLps(geometry.directions[1], geometry.coordinateSystem);
  const z = toLps(geometry.directions[2], geometry.coordinateSystem);
  const relative = [lpsPoint[0]! - origin[0], lpsPoint[1]! - origin[1], lpsPoint[2]! - origin[2]];
  const crossYZ = [y[1]! * z[2]! - y[2]! * z[1]!, y[2]! * z[0]! - y[0]! * z[2]!, y[0]! * z[1]! - y[1]! * z[0]!];
  const crossZX = [z[1]! * x[2]! - z[2]! * x[1]!, z[2]! * x[0]! - z[0]! * x[2]!, z[0]! * x[1]! - z[1]! * x[0]!];
  const crossXY = [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
  const determinant = dot(x, crossYZ);
  return [dot(relative, crossYZ) / determinant, dot(relative, crossZX) / determinant, dot(relative, crossXY) / determinant];
}

export function anatomyPlaneIndexFromWorldPoint(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, worldPointLps: readonly number[]): number {
  const spec = getAnatomyPlaneSpec(geometry, plane);
  return Math.max(0, Math.min(spec.sliceCount - 1, Math.round((dot(worldPointLps, spec.normal) - spec.normalMin) / spec.spacingNormal)));
}

export function anatomyVolumeCenterLps(geometry: AnatomyNrrdGeometry): [number, number, number] {
  return [0, 1, 2].map((axis) => {
    const point = geometry.origin[axis]! + geometry.directions[0][axis]! * (geometry.sizes[0] - 1) / 2 + geometry.directions[1][axis]! * (geometry.sizes[1] - 1) / 2 + geometry.directions[2][axis]! * (geometry.sizes[2] - 1) / 2;
    return geometry.coordinateSystem === "RAS" && axis < 2 ? -point : point;
  }) as [number, number, number];
}

export function anatomyWorldPointFromPlanePixel(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, sliceIndex: number, pixelX: number, pixelY: number): [number, number, number] {
  const spec = getAnatomyPlaneSpec(geometry, plane);
  const normal = spec.normalMin + sliceIndex * spec.spacingNormal;
  const horizontal = spec.uMin + Math.max(0, Math.min(spec.width - 1, pixelX)) * spec.spacingX;
  const vertical = spec.vMin + Math.max(0, Math.min(spec.height - 1, spec.height - 1 - pixelY)) * spec.spacingY;
  return [0, 1, 2].map((axis) => spec.horizontal[axis]! * horizontal + spec.vertical[axis]! * vertical + spec.normal[axis]! * normal) as [number, number, number];
}

/** Move the shared physical point along one plane normal without recentering its in-plane position. */
export function anatomyWorldPointOnPlaneAtIndex(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, sliceIndex: number, worldPointLps: readonly number[]): [number, number, number] {
  const spec = getAnatomyPlaneSpec(geometry, plane);
  if (!Number.isInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= spec.sliceCount) throw new Error("Anatomy plane index is outside the volume.");
  const normalCoordinate = spec.normalMin + sliceIndex * spec.spacingNormal;
  const horizontalCoordinate = dot(worldPointLps, spec.horizontal);
  const verticalCoordinate = dot(worldPointLps, spec.vertical);
  return [0, 1, 2].map((axis) => spec.horizontal[axis]! * horizontalCoordinate
    + spec.vertical[axis]! * verticalCoordinate + spec.normal[axis]! * normalCoordinate) as [number, number, number];
}

export function anatomyCrosshairPixel(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, worldPointLps: readonly number[]): { x: number; y: number } {
  const spec = getAnatomyPlaneSpec(geometry, plane);
  return { x: (dot(worldPointLps, spec.horizontal) - spec.uMin) / spec.spacingX, y: spec.height - 1 - (dot(worldPointLps, spec.vertical) - spec.vMin) / spec.spacingY };
}

export function anatomyPlaneWorldTransform(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, sliceIndex: number): {
  point: [number, number, number];
  horizontal: [number, number, number];
  vertical: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
  spacingX: number;
  spacingY: number;
} {
  const spec = getAnatomyPlaneSpec(geometry, plane);
  if (!Number.isInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= spec.sliceCount) throw new Error("Anatomy plane index is outside the volume.");
  const pointLps = [
    spec.horizontal[0] * (spec.uMin + (spec.width - 1) * spec.spacingX / 2)
      + spec.vertical[0] * (spec.vMin + (spec.height - 1) * spec.spacingY / 2)
      + spec.normal[0] * (spec.normalMin + sliceIndex * spec.spacingNormal),
    spec.horizontal[1] * (spec.uMin + (spec.width - 1) * spec.spacingX / 2)
      + spec.vertical[1] * (spec.vMin + (spec.height - 1) * spec.spacingY / 2)
      + spec.normal[1] * (spec.normalMin + sliceIndex * spec.spacingNormal),
    spec.horizontal[2] * (spec.uMin + (spec.width - 1) * spec.spacingX / 2)
      + spec.vertical[2] * (spec.vMin + (spec.height - 1) * spec.spacingY / 2)
      + spec.normal[2] * (spec.normalMin + sliceIndex * spec.spacingNormal),
  ] as [number, number, number];
  const fromLps = (vector: readonly number[]) => geometry.coordinateSystem === "RAS" ? [-vector[0]!, -vector[1]!, vector[2]!] as [number, number, number] : [vector[0]!, vector[1]!, vector[2]!] as [number, number, number];
  return {
    point: fromLps(pointLps),
    horizontal: fromLps(spec.horizontal),
    vertical: fromLps(spec.vertical),
    normal: fromLps(spec.normal),
    width: spec.width,
    height: spec.height,
    spacingX: spec.spacingX,
    spacingY: spec.spacingY,
  };
}

/** Physical rectangular section plane through the single shared LPS point. */
export function anatomyPlaneWorldTransformAtPoint(geometry: AnatomyNrrdGeometry, plane: AnatomyPlane, worldPointLps: readonly number[]): {
  point: [number, number, number];
  horizontal: [number, number, number];
  vertical: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
  spacingX: number;
  spacingY: number;
} {
  const spec = getAnatomyPlaneSpec(geometry, plane);
  const pointLps = [0, 1, 2].map((axis) => spec.horizontal[axis]! * dot(worldPointLps, spec.horizontal)
    + spec.vertical[axis]! * dot(worldPointLps, spec.vertical)
    + spec.normal[axis]! * dot(worldPointLps, spec.normal));
  const fromLps = (vector: readonly number[]) => geometry.coordinateSystem === "RAS"
    ? [-vector[0]!, -vector[1]!, vector[2]!] as [number, number, number]
    : [vector[0]!, vector[1]!, vector[2]!] as [number, number, number];
  return { point: fromLps(pointLps), horizontal: fromLps(spec.horizontal), vertical: fromLps(spec.vertical), normal: fromLps(spec.normal), width: spec.width, height: spec.height, spacingX: spec.spacingX, spacingY: spec.spacingY };
}

function sampleVoxel(data: AnatomyVoxelData, geometry: AnatomyNrrdGeometry, coordinates: readonly number[], nearest: boolean): { value: number; valid: boolean } {
  const [x, y, z] = coordinates;
  const [width, height, depth] = geometry.sizes;
  if (x! < 0 || y! < 0 || z! < 0 || x! > width - 1 || y! > height - 1 || z! > depth - 1) return { value: 0, valid: false };
  const index = (i: number, j: number, k: number) => i + width * (j + height * k);
  if (nearest) return { value: Number(data[index(Math.round(x!), Math.round(y!), Math.round(z!))]), valid: true };
  const x0 = Math.floor(x!); const y0 = Math.floor(y!); const z0 = Math.floor(z!);
  const x1 = Math.min(width - 1, x0 + 1); const y1 = Math.min(height - 1, y0 + 1); const z1 = Math.min(depth - 1, z0 + 1);
  const fx = x! - x0; const fy = y! - y0; const fz = z! - z0;
  const at = (i: number, j: number, k: number) => Number(data[index(i, j, k)]);
  const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
  const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
  const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
  const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return { value: c0 * (1 - fz) + c1 * fz, valid: true };
}

export function resliceAnatomyPlane(primary: ParsedAnatomyNrrd, segmentation: ParsedAnatomyNrrd | null, plane: AnatomyPlane, sliceIndex: number): ReslicedAnatomyPlane {
  if (segmentation) validateCompatibleAnatomyGeometry(primary.geometry, segmentation.geometry);
  const spec = getAnatomyPlaneSpec(primary.geometry, plane);
  if (!Number.isInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= spec.sliceCount) throw new Error("Anatomy plane index is outside the volume.");
  const values = new Float32Array(spec.width * spec.height);
  const validMask = new Uint8Array(spec.width * spec.height);
  const labels = segmentation ? new Int32Array(spec.width * spec.height) : null;
  const normalValue = spec.normalMin + sliceIndex * spec.spacingNormal;
  let outputIndex = 0;
  for (let y = 0; y < spec.height; y += 1) {
    const verticalValue = spec.vMin + (spec.height - 1 - y) * spec.spacingY;
    for (let x = 0; x < spec.width; x += 1) {
      const horizontalValue = spec.uMin + x * spec.spacingX;
      const worldLps = [0, 1, 2].map((component) => spec.horizontal[component]! * horizontalValue
        + spec.vertical[component]! * verticalValue + spec.normal[component]! * normalValue);
      const voxel = voxelCoordinatesFromLps(primary.geometry, worldLps);
      const imageSample = sampleVoxel(primary.data, primary.geometry, voxel, false);
      validMask[outputIndex] = imageSample.valid ? 1 : 0;
      values[outputIndex] = imageSample.valid ? imageSample.value * primary.slope + primary.intercept : 0;
      if (labels && segmentation && imageSample.valid) labels[outputIndex] = Math.round(sampleVoxel(segmentation.data, segmentation.geometry, voxel, true).value);
      outputIndex += 1;
    }
  }
  const axes = anatomyPlaneAxes(plane);
  return {
    width: spec.width,
    height: spec.height,
    spacingX: spec.spacingX,
    spacingY: spec.spacingY,
    values,
    validMask,
    labels,
    markers: { left: axes.leftMarker, right: axes.rightMarker },
  };
}

export function sliceIndexWorldPlane(geometry: AnatomyNrrdGeometry, sliceIndex: number): { point: [number, number, number]; normal: [number, number, number] } {
  if (!Number.isInteger(sliceIndex) || sliceIndex < 0 || sliceIndex >= geometry.sizes[2]) throw new Error("CT slice index is outside the volume.");
  const [x, y, z] = geometry.directions;
  const cross = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  const length = vectorLength(cross);
  return {
    point: [geometry.origin[0] + z[0] * sliceIndex, geometry.origin[1] + z[1] * sliceIndex, geometry.origin[2] + z[2] * sliceIndex],
    normal: [cross[0]! / length, cross[1]! / length, cross[2]! / length],
  };
}

export function validateStructureLabels(labels: AnatomyVoxelData, structures: Array<{ id: string; labelValue: number }>): void {
  const present = new Set<number>();
  for (let index = 0; index < labels.length; index += 1) present.add(Number(labels[index]));
  const missing = structures.filter((structure) => !present.has(structure.labelValue));
  if (missing.length > 0) throw new Error(`Atlas segmentation is missing declared label values for: ${missing.map(({ id }) => id).join(", ")}.`);
}

export function orientationMarkers(geometry: AnatomyNrrdGeometry): { left: string; right: string; flipX: boolean; flipY: boolean } {
  const [xDirection, yDirection] = geometry.directions;
  const toLps = (vector: readonly number[]) => geometry.coordinateSystem === "RAS" ? [-vector[0]!, -vector[1]!, vector[2]!] : vector;
  const xLps = toLps(xDirection);
  const yLps = toLps(yDirection);
  const flipX = xLps[0]! < 0;
  return {
    left: "R",
    right: "L",
    flipX,
    flipY: yLps[1]! < 0,
  };
}
