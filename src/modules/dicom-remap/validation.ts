import { HttpError } from "../../utils/http-error.js";
import type { DicomRemapUploadFileInput } from "./types.js";

export function validateDicomRemapUploadFilesInput(value: unknown): DicomRemapUploadFileInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "files must be a non-empty array.");
  }
  return value as DicomRemapUploadFileInput[];
}

export function validateExplicitConfirm(value: unknown): boolean {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}
