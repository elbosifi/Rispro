/**
 * Appointments V2 — Admin scheduling DTOs.
 */

export interface CreatePolicyDraftDto {
  policySetKey: string;
  changeNote?: string;
}

export interface SavePolicyDraftDto {
  configSnapshot: unknown;
}

export interface PublishPolicyDto {
  changeNote: string;
}

export interface PolicyVersionResponseDto {
  id: number;
  policySetKey: string;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface PolicyConfigSnapshotDto {
  versionId: number;
  versionNo: number;
  status: string;
  rules: unknown;
  configHash: string;
}
