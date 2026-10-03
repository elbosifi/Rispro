const HEADER_SCAN_LIMIT = 128 * 1024;

function readLine(buffer, offset) {
  const end = buffer.indexOf(0x0a, offset);
  if (end < 0 || end - offset > 4096) throw new Error("Legacy VTK header line is missing or too long.");
  return { line: buffer.toString("ascii", offset, end).replace(/\r$/, "").trim(), nextOffset: end + 1 };
}

function skipArrayDelimiter(buffer, offset) {
  if (buffer[offset] === 0x0d && buffer[offset + 1] === 0x0a) return offset + 2;
  if (buffer[offset] === 0x0a || buffer[offset] === 0x0d) return offset + 1;
  return offset;
}

function parseCellArray(buffer, offset, cellCount, wordCount, kind, pointCount) {
  if (!Number.isSafeInteger(cellCount) || cellCount < 0 || !Number.isSafeInteger(wordCount) || wordCount < cellCount || offset + wordCount * 4 > buffer.length) {
    throw new Error(`Legacy VTK ${kind} cell array has invalid dimensions.`);
  }
  const triangleIndices = new Uint32Array(wordCount * 3);
  let triangleIndexCount = 0;
  let wordOffset = offset;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    if (wordOffset + 4 > offset + wordCount * 4) throw new Error(`Legacy VTK ${kind} cell array ended early.`);
    const vertexCount = buffer.readInt32BE(wordOffset);
    wordOffset += 4;
    if (vertexCount < 0 || vertexCount > pointCount || wordOffset + vertexCount * 4 > offset + wordCount * 4) {
      throw new Error(`Legacy VTK ${kind} cell contains an invalid vertex count.`);
    }
    const indices = new Array(vertexCount);
    for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
      const pointIndex = buffer.readInt32BE(wordOffset);
      wordOffset += 4;
      if (pointIndex < 0 || pointIndex >= pointCount) throw new Error(`Legacy VTK ${kind} cell references an unknown point.`);
      indices[vertexIndex] = pointIndex;
    }
    if (kind === "POLYGONS") {
      for (let index = 1; index < indices.length - 1; index += 1) {
        triangleIndices[triangleIndexCount++] = indices[0];
        triangleIndices[triangleIndexCount++] = indices[index];
        triangleIndices[triangleIndexCount++] = indices[index + 1];
      }
    } else if (kind === "TRIANGLE_STRIPS") {
      for (let index = 2; index < indices.length; index += 1) {
        triangleIndices[triangleIndexCount++] = index % 2 === 0 ? indices[index - 2] : indices[index - 1];
        triangleIndices[triangleIndexCount++] = index % 2 === 0 ? indices[index - 1] : indices[index - 2];
        triangleIndices[triangleIndexCount++] = indices[index];
      }
    }
  }
  if (wordOffset !== offset + wordCount * 4) throw new Error(`Legacy VTK ${kind} cell array size does not match its declaration.`);
  return { triangleIndices: triangleIndices.subarray(0, triangleIndexCount), nextOffset: skipArrayDelimiter(buffer, wordOffset) };
}

function parseBinaryPolyData(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 80) throw new Error("Legacy VTK model is too short.");
  let offset = 0;
  let binary = false;
  let polyData = false;
  let points = null;
  let pointCount = 0;
  while (offset < Math.min(buffer.length, HEADER_SCAN_LIMIT)) {
    const { line, nextOffset } = readLine(buffer, offset);
    offset = nextOffset;
    if (line.toUpperCase() === "BINARY") binary = true;
    if (line.toUpperCase() === "DATASET POLYDATA") polyData = true;
    const pointMatch = line.match(/^POINTS\s+(\d+)\s+(float|double)$/i);
    if (!pointMatch) continue;
    if (!binary || !polyData) throw new Error("Legacy VTK model must declare BINARY DATASET POLYDATA before its points.");
    pointCount = Number(pointMatch[1]);
    const bytesPerValue = pointMatch[2].toLowerCase() === "float" ? 4 : 8;
    const pointBytes = pointCount * 3 * bytesPerValue;
    if (!Number.isSafeInteger(pointCount) || pointCount < 3 || pointBytes > buffer.length - offset) throw new Error("Legacy VTK point array has invalid dimensions.");
    points = new Float64Array(pointCount * 3);
    for (let index = 0; index < points.length; index += 1) {
      points[index] = bytesPerValue === 4 ? buffer.readFloatBE(offset + index * 4) : buffer.readDoubleBE(offset + index * 8);
      if (!Number.isFinite(points[index])) throw new Error("Legacy VTK point array contains a non-finite coordinate.");
    }
    offset = skipArrayDelimiter(buffer, offset + pointBytes);
    break;
  }
  if (!points) throw new Error("Legacy VTK model has no supported binary POINTS array.");

  const triangleArrays = [];
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let index = 0; index < points.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = points[index + axis];
      bounds.min[axis] = Math.min(bounds.min[axis], value);
      bounds.max[axis] = Math.max(bounds.max[axis], value);
    }
  }

  while (offset < buffer.length) {
    const { line, nextOffset } = readLine(buffer, offset);
    offset = nextOffset;
    if (!line) continue;
    const cellMatch = line.match(/^(POLYGONS|TRIANGLE_STRIPS|VERTICES|LINES)\s+(\d+)\s+(\d+)$/i);
    if (!cellMatch) break;
    const kind = cellMatch[1].toUpperCase();
    const parsed = parseCellArray(buffer, offset, Number(cellMatch[2]), Number(cellMatch[3]), kind, pointCount);
    if (parsed.triangleIndices.length) triangleArrays.push(parsed.triangleIndices);
    offset = parsed.nextOffset;
  }
  const triangleIndexCount = triangleArrays.reduce((total, array) => total + array.length, 0);
  if (triangleIndexCount === 0 || triangleIndexCount % 3 !== 0) throw new Error("Legacy VTK model has no polygon or triangle-strip surfaces.");
  const triangleIndices = new Uint32Array(triangleIndexCount);
  let triangleOffset = 0;
  for (const array of triangleArrays) { triangleIndices.set(array, triangleOffset); triangleOffset += array.length; }
  return { points, triangleIndices, bounds };
}

function triangleNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const length = Math.hypot(...cross);
  return length > 1e-12 ? cross.map((value) => value / length) : null;
}

export function convertLegacyVtkPolyDataToBinaryStl(buffer) {
  const parsed = parseBinaryPolyData(buffer);
  const triangles = [];
  const triangleCount = parsed.triangleIndices.length / 3;
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const indices = parsed.triangleIndices.subarray(triangleIndex * 3, triangleIndex * 3 + 3);
    const a = [0, 1, 2].map((axis) => parsed.points[indices[0] * 3 + axis]);
    const b = [0, 1, 2].map((axis) => parsed.points[indices[1] * 3 + axis]);
    const c = [0, 1, 2].map((axis) => parsed.points[indices[2] * 3 + axis]);
    const normal = triangleNormal(a, b, c);
    if (normal) triangles.push({ normal, vertices: [a, b, c] });
  }
  if (triangles.length === 0 || triangles.length > 0xffffffff) throw new Error("Legacy VTK surface has no usable triangles or exceeds the STL triangle limit.");
  const output = Buffer.alloc(84 + triangles.length * 50);
  output.write("RISpro normalized educational atlas mesh", 0, "ascii");
  output.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const triangle of triangles) {
    for (const value of triangle.normal) { output.writeFloatLE(value, offset); offset += 4; }
    for (const vertex of triangle.vertices) for (const value of vertex) { output.writeFloatLE(value, offset); offset += 4; }
    output.writeUInt16LE(0, offset);
    offset += 2;
  }
  return { stl: output, triangleCount: triangles.length, bounds: parsed.bounds, points: parsed.points };
}
