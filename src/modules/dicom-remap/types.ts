export type DicomRemapJobStatus =
  | "uploaded"
  | "processing"
  | "awaiting_confirmation"
  | "remapped"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface DicomRemapUploadFileInput {
  fileName?: unknown;
  mimeType?: unknown;
  fileContentBase64?: unknown;
}
