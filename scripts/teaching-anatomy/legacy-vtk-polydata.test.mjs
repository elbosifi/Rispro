import assert from "node:assert/strict";
import test from "node:test";
import { convertLegacyVtkPolyDataToBinaryStl } from "./legacy-vtk-polydata.mjs";

function createVtk(kind, cells, points) {
  const pointCount = points.length;
  const pointCountBytes = Buffer.alloc(4);
  pointCountBytes.writeFloatBE(pointCount, 0);
  const pointBytes = Buffer.alloc(pointCount * 3 * 4);
  points.flat().forEach((value, index) => pointBytes.writeFloatBE(value, index * 4));
  const cellWords = cells.flatMap((cell) => [cell.length, ...cell]);
  const cellBytes = Buffer.alloc(cellWords.length * 4);
  cellWords.forEach((value, index) => cellBytes.writeInt32BE(value, index * 4));
  const header = Buffer.from(`# vtk DataFile Version 4.0\nsynthetic surface\nBINARY\nDATASET POLYDATA\nPOINTS ${pointCount} float\n`);
  const section = Buffer.from(`${kind} ${cells.length} ${cellWords.length}\n`);
  return Buffer.concat([header, pointBytes, Buffer.from("\n"), section, cellBytes, Buffer.from("\n")]);
}

test("converts binary VTK triangle strips to a valid binary STL surface", () => {
  const source = createVtk("TRIANGLE_STRIPS", [[0, 1, 2, 3]], [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]);
  const result = convertLegacyVtkPolyDataToBinaryStl(source);
  assert.equal(result.triangleCount, 2);
  assert.equal(result.stl.length, 84 + 2 * 50);
  assert.equal(result.stl.readUInt32LE(80), 2);
  assert.deepEqual(result.bounds, { min: [0, 0, 0], max: [1, 1, 0] });
  assert.equal(result.stl.readFloatLE(84 + 12), 0);
});

test("triangulates binary VTK polygons and rejects invalid point references", () => {
  const source = createVtk("POLYGONS", [[0, 1, 2, 3]], [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
  assert.equal(convertLegacyVtkPolyDataToBinaryStl(source).triangleCount, 2);
  const invalid = createVtk("POLYGONS", [[0, 1, 4]], [[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  assert.throws(() => convertLegacyVtkPolyDataToBinaryStl(invalid), /unknown point/i);
});
