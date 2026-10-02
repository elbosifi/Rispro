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

export function validateCompatibleAnatomyGeometry(ct: AnatomyNrrdGeometry, labels: AnatomyNrrdGeometry): void {
  const close = (left: number, right: number) => Math.abs(left - right) <= 1e-4;
  if (ct.sizes.some((size, index) => size !== labels.sizes[index])) throw new Error("The CT and segmentation dimensions do not match.");
  if (ct.coordinateSystem !== labels.coordinateSystem || ct.origin.some((value, index) => !close(value, labels.origin[index]!))
    || ct.directions.some((direction, axis) => direction.some((value, component) => !close(value, labels.directions[axis]![component]!)))) {
    throw new Error("The CT and segmentation NRRD spatial transforms do not match.");
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
