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

export type DicomRemapOrthancRecoveryStage =
  | "validating_staging"
  | "uploading_source"
  | "verifying_source"
  | "modifying"
  | "verifying_modified"
  | "completed"
  | "failed";

export interface DicomRemapUploadFileInput {
  fileName?: unknown;
  mimeType?: unknown;
  fileContentBase64?: unknown;
}
