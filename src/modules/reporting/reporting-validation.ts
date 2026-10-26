import sharp from "sharp";
import { HttpError } from "../../utils/http-error.js";
import { isValidDicomUid } from "../ohif-viewer/validation.js";

export const SECTION_NAMES = ["clinicalHistory", "comparison", "technique", "findings", "impression"] as const;
export type ReportSections = Record<typeof SECTION_NAMES[number], string>;
export const EMPTY_SECTIONS: ReportSections = { clinicalHistory: "", comparison: "", technique: "", findings: "", impression: "" };
export function sections(value: unknown): ReportSections {
  if (!value || typeof value !== "object") throw new HttpError(400, "Report sections are required.");
  const input = value as Record<string, unknown>;
  const result = { ...EMPTY_SECTIONS };
  for (const name of SECTION_NAMES) {
    if (typeof input[name] !== "string" || input[name].length > 100_000) throw new HttpError(400, `Invalid ${name}.`);
    result[name] = input[name];
  }
  return result;
}
export function uuid(value: unknown): string {
  const result = String(value || "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result)) throw new HttpError(400, "A valid request/context identifier is required.");
  return result;
}
export function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new HttpError(400, "Expected revision is required.");
  return Number(value);
}
export interface CaptureProvenance {
  studyInstanceUid: string; seriesInstanceUid: string; sopInstanceUid: string | null; frameNumber: number | null;
  frameOfReferenceUid: string | null; viewportType: "stack" | "mpr" | "mip";
  display: Record<string, unknown>; camera: Record<string, unknown>;
  slabThickness: number | null; blendMode: number | string | null;
}
export function provenance(value: unknown): CaptureProvenance {
  const p = value as CaptureProvenance;
  if (!p || !isValidDicomUid(p.studyInstanceUid) || !isValidDicomUid(p.seriesInstanceUid)
    || !["stack", "mpr", "mip"].includes(p.viewportType)) throw new HttpError(400, "Capture source is invalid.");
  if (p.viewportType === "stack" && (!isValidDicomUid(p.sopInstanceUid) || !Number.isSafeInteger(p.frameNumber) || Number(p.frameNumber) < 1))
    throw new HttpError(400, "Stack captures require the original SOP and one-based DICOM frame number.");
  if (p.viewportType !== "stack" && (p.sopInstanceUid != null || p.frameNumber != null)) throw new HttpError(400, "Reconstructed captures cannot claim one source SOP/frame.");
  for (const key of ["viewPlaneNormal", "viewUp", "position", "focalPoint"]) {
    const vector = p.camera?.[key];
    if (!Array.isArray(vector) || vector.length !== 3 || !vector.every(Number.isFinite)) throw new HttpError(400, "Capture camera geometry is required.");
  }
  if (!p.display || typeof p.display !== "object" || JSON.stringify(p).length > 20000) throw new HttpError(400, "Capture display parameters are invalid.");
  if (p.viewportType !== "stack" && (!Number.isFinite(p.slabThickness) || Number(p.slabThickness) < 0 || p.blendMode == null)) throw new HttpError(400, "Volume slab and blend mode are required.");
  return { studyInstanceUid: p.studyInstanceUid, seriesInstanceUid: p.seriesInstanceUid,
    sopInstanceUid: p.viewportType === "stack" ? p.sopInstanceUid : null, frameNumber: p.viewportType === "stack" ? p.frameNumber : null,
    frameOfReferenceUid: isValidDicomUid(p.frameOfReferenceUid) ? p.frameOfReferenceUid : null,
    viewportType: p.viewportType, display: p.display, camera: p.camera, slabThickness: p.slabThickness ?? null, blendMode: p.blendMode ?? null };
}
export async function validatePng(bytes: Buffer) {
  if (!bytes.length || bytes.length > 12 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new HttpError(400, "A PNG snapshot of at most 12 MB is required.");
  try {
    const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: "warning" });
    const m = await image.metadata();
    if (m.format !== "png" || !m.width || !m.height || m.width < 32 || m.height < 32 || m.width > 4096 || m.height > 4096 || (m.pages ?? 1) > 1) throw Error();
    await image.raw().toBuffer(); // Validate actual compressed pixels, not just the header.
    return { width: m.width, height: m.height };
  } catch { throw new HttpError(400, "The PNG snapshot is corrupt or has unsupported dimensions."); }
}
