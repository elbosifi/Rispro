export type DicomRemapJobStatus =
  | "uploaded"
  | "processing"
  | "awaiting_confirmation"
  | "remapped"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type DicomRemapOrthancRecoveryStatus =
  | "none"
  | "available"
  | "processing"
  | "failed"
  | "completed";

export interface DicomRemapUploadFileInput {
  fileName?: unknown;
  mimeType?: unknown;
  fileContentBase64?: unknown;
}
