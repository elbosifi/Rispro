import { describe, expect, it } from "vitest";
import { anatomyPlaneWorldTransform, getAnatomyPlaneSpec, orientationMarkers, parseAnatomyNrrd, resliceAnatomyPlane, sliceIndexWorldPlane, validateAnatomyGeometry, validateAxialAnatomyGeometry, validateCompatibleAnatomyGeometry, validateStructureLabels } from "./anatomy-nrrd";

function makeNrrd(values: number[], origin = "(10, 20, 30)") {
  const header = new TextEncoder().encode([
    "NRRD0005",
    "type: short",
    "dimension: 3",
    "space: left-posterior-superior",
    "sizes: 2 2 3",
    "space directions: (0.8,0,0) (0,0.8,0) (0,0,2.5)",
    `space origin: ${origin}`,
    "encoding: raw",
    "endian: little",
    "",
    "",
  ].join("\n"));
  const data = new Uint8Array(values.length * 2);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => view.setInt16(index * 2, value, true));
  const bytes = new Uint8Array(header.length + data.length);
  bytes.set(header);
  bytes.set(data, header.length);
  return bytes.buffer;
}

describe("Teaching anatomy NRRD geometry", () => {
  it("parses real physical increments and calculates a slice plane from origin plus direction", async () => {
    const parsed = await parseAnatomyNrrd(makeNrrd(Array.from({ length: 12 }, (_, index) => index)));
    expect(parsed.geometry.sizes).toEqual([2, 2, 3]);
    expect(parsed.geometry.directions[2]).toEqual([0, 0, 2.5]);
    expect(sliceIndexWorldPlane(parsed.geometry, 2)).toEqual({ point: [10, 20, 35], normal: [0, 0, 1] });
    validateAxialAnatomyGeometry(parsed.geometry);
  });

  it("rejects CT and label-map geometry that differs in origin, direction, dimensions, or space", async () => {
    const ct = await parseAnatomyNrrd(makeNrrd(Array(12).fill(0)));
    const same = await parseAnatomyNrrd(makeNrrd(Array(12).fill(0)));
    expect(() => validateCompatibleAnatomyGeometry(ct.geometry, same.geometry)).not.toThrow();
    const shifted = await parseAnatomyNrrd(makeNrrd(Array(12).fill(0), "(10, 20, 31)"));
    expect(() => validateCompatibleAnatomyGeometry(ct.geometry, shifted.geometry)).toThrow(/spatial transforms do not match/i);
  });

  it("validates declared segmentation values including Segment VIII label 33", async () => {
    const labels = await parseAnatomyNrrd(makeNrrd([0, 33, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(() => validateStructureLabels(labels.data, [{ id: "segment-viii", labelValue: 33 }])).not.toThrow();
    expect(() => validateStructureLabels(labels.data, [{ id: "segment-viii", labelValue: 33 }, { id: "missing", labelValue: 999 }])).toThrow(/missing declared label values.*missing/i);
  });

  it("derives left and right orientation markers from patient-space direction", () => {
    const parsedGeometry = {
      sizes: [2, 2, 3] as [number, number, number], coordinateSystem: "LPS" as const,
      origin: [0, 0, 0] as [number, number, number],
      directions: [[0.8, 0, 0], [0, 0.8, 0], [0, 0, 2.5]] as [[number, number, number], [number, number, number], [number, number, number]],
    };
    expect(orientationMarkers(parsedGeometry)).toMatchObject({ left: "R", right: "L", flipX: false });
  });

  it("calculates axial, coronal, and sagittal grids from voxel spacing and world bounds", () => {
    const geometry = {
      sizes: [2, 3, 4] as [number, number, number], coordinateSystem: "LPS" as const,
      origin: [0, 0, 0] as [number, number, number],
      directions: [[1, 0, 0], [0, 2, 0], [0, 0, 3]] as [[number, number, number], [number, number, number], [number, number, number]],
    };
    expect(getAnatomyPlaneSpec(geometry, "axial")).toMatchObject({ width: 2, height: 5, sliceCount: 4, leftMarker: "R", rightMarker: "L" });
    expect(getAnatomyPlaneSpec(geometry, "coronal")).toMatchObject({ width: 2, height: 10, sliceCount: 3, leftMarker: "R", rightMarker: "L" });
    expect(getAnatomyPlaneSpec(geometry, "sagittal")).toMatchObject({ width: 5, height: 10, sliceCount: 2, leftMarker: "A", rightMarker: "P" });
    expect(anatomyPlaneWorldTransform(geometry, "axial", 0).point).toEqual([0.5, 2, 9]);
    expect(anatomyPlaneWorldTransform(geometry, "coronal", 0).point).toEqual([0.5, 4, 4.5]);
    expect(anatomyPlaneWorldTransform(geometry, "sagittal", 0).point).toEqual([0, 2, 4.5]);
  });

  it("reslices each orthogonal plane through the volume affine and keeps label sampling aligned", () => {
    const makeVolume = (values: number[]) => ({
      geometry: { sizes: [2, 2, 2] as [number, number, number], coordinateSystem: "LPS" as const,
        origin: [0, 0, 0] as [number, number, number],
        directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [[number, number, number], [number, number, number], [number, number, number]] },
      data: new Int16Array(values), type: "short", slope: 1, intercept: 0,
    });
    const values = Array.from({ length: 8 }, (_, index) => {
      const x = index % 2; const y = Math.floor(index / 2) % 2; const z = Math.floor(index / 4);
      return x + 10 * y + 100 * z;
    });
    const image = makeVolume(values);
    const labels = makeVolume(values.map((value) => value + 1));
    expect(Array.from(resliceAnatomyPlane(image, labels, "axial", 0).values)).toEqual([100, 101, 110, 111]);
    expect(Array.from(resliceAnatomyPlane(image, labels, "axial", 0).labels ?? [])).toEqual([101, 102, 111, 112]);
    expect(Array.from(resliceAnatomyPlane(image, labels, "coronal", 0).values)).toEqual([110, 111, 10, 11]);
    expect(Array.from(resliceAnatomyPlane(image, labels, "sagittal", 0).values)).toEqual([100, 110, 0, 10]);
    expect(() => resliceAnatomyPlane(image, null, "axial", 2)).toThrow(/outside the volume/i);
  });

  it("accepts non-axial but invertible image affines and rejects singular volume transforms", () => {
    const oblique = {
      sizes: [2, 2, 2] as [number, number, number], coordinateSystem: "LPS" as const,
      origin: [0, 0, 0] as [number, number, number],
      directions: [[0, 1, 0], [0, 0, 1], [1, 0, 0]] as [[number, number, number], [number, number, number], [number, number, number]],
    };
    expect(() => validateAnatomyGeometry(oblique)).not.toThrow();
    expect(() => validateAxialAnatomyGeometry(oblique)).toThrow(/not aligned with axial/i);
    expect(() => validateAnatomyGeometry({ ...oblique, directions: [[1, 0, 0], [2, 0, 0], [0, 0, 1]] })).toThrow(/singular/i);
  });
});
