import { describe, expect, it } from "vitest";
import {
  anatomyCrosshairPixel,
  anatomyPlaneIndexFromWorldPoint,
  anatomyPlaneWorldTransformAtPoint,
  anatomyWorldPointFromPlanePixel,
  anatomyWorldPointOnPlaneAtIndex,
  getAnatomyPlaneSpec,
  resliceAnatomyPlane,
  type AnatomyNrrdGeometry,
  type ParsedAnatomyNrrd,
} from "../anatomy/anatomy-nrrd";

const anisotropicRasGeometry: AnatomyNrrdGeometry = {
  sizes: [3, 4, 5],
  coordinateSystem: "RAS",
  origin: [10, 20, 30],
  directions: [[2, 0, 0], [0, 3, 0], [0, 0, 4]],
};
const worldPointLps: [number, number, number] = [-12, -26, 38];

describe("physical MPR geometry", () => {
  it("projects one LPS point to axial, coronal and sagittal indices in anisotropic RAS volumes", () => {
    expect(anatomyPlaneIndexFromWorldPoint(anisotropicRasGeometry, "axial", worldPointLps)).toBe(2);
    expect(anatomyPlaneIndexFromWorldPoint(anisotropicRasGeometry, "coronal", worldPointLps)).toBe(2);
    expect(anatomyPlaneIndexFromWorldPoint(anisotropicRasGeometry, "sagittal", worldPointLps)).toBe(1);
  });

  it("scrolls only along a selected plane normal and preserves its in-plane crosshair", () => {
    expect(anatomyWorldPointOnPlaneAtIndex(anisotropicRasGeometry, "axial", 3, worldPointLps)).toEqual([-12, -26, 34]);
    expect(anatomyWorldPointOnPlaneAtIndex(anisotropicRasGeometry, "coronal", 3, worldPointLps)).toEqual([-12, -29, 38]);
    expect(anatomyWorldPointOnPlaneAtIndex(anisotropicRasGeometry, "sagittal", 2, worldPointLps)).toEqual([-10, -26, 38]);
  });

  it("projects clicks and crosshairs through the same physical image-plane coordinates", () => {
    const spec = getAnatomyPlaneSpec(anisotropicRasGeometry, "coronal");
    const point = anatomyWorldPointFromPlanePixel(anisotropicRasGeometry, "coronal", 2, spec.width - 1, 0);
    const crosshair = anatomyCrosshairPixel(anisotropicRasGeometry, "coronal", point);
    expect(crosshair.x).toBeCloseTo(spec.width - 1, 4);
    expect(crosshair.y).toBeCloseTo(0, 4);
  });

  it("places all three 3D physical section planes through the same LPS world point", () => {
    for (const plane of ["axial", "sagittal", "coronal"] as const) {
      const transform = anatomyPlaneWorldTransformAtPoint(anisotropicRasGeometry, plane, worldPointLps);
      expect(transform.point).toEqual([12, 26, 38]);
      expect(Math.hypot(...transform.normal)).toBeCloseTo(1, 8);
    }
  });

  it("distinguishes valid CT water from invalid outside-volume background and leaves labels empty outside", () => {
    const geometry: AnatomyNrrdGeometry = {
      sizes: [2, 2, 2],
      coordinateSystem: "LPS",
      origin: [0, 0, 0],
      directions: [[1, 1, 0], [-1, 1, 0], [0, 0, 2]],
    };
    const primary: ParsedAnatomyNrrd = { geometry, data: new Int16Array(8).fill(0), type: "short", slope: 1, intercept: 0 };
    const segmentation: ParsedAnatomyNrrd = { geometry, data: new Int16Array(8).fill(33), type: "short", slope: 1, intercept: 0 };
    const slice = resliceAnatomyPlane(primary, segmentation, "axial", 0);
    expect([...slice.validMask]).toContain(0);
    expect([...slice.validMask]).toContain(1);
    expect(slice.values[0]).toBe(0);
    expect(slice.validMask[0]).toBe(0);
    expect(slice.labels?.[0]).toBe(0);
    expect(slice.values.some((value, index) => value === 0 && slice.validMask[index] === 1)).toBe(true);
  });
});
