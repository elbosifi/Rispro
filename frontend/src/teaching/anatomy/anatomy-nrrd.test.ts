import { describe, expect, it } from "vitest";
import { orientationMarkers, parseAnatomyNrrd, sliceIndexWorldPlane, validateAxialAnatomyGeometry, validateCompatibleAnatomyGeometry, validateStructureLabels } from "./anatomy-nrrd";

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
});
