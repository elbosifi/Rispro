/**
 * Appointments V2 — Policy snapshot model.
 *
 * Represents a frozen view of all rules at a specific version.
 */

export interface PolicySnapshot {
  policySetKey: string;
  versionId: number;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
}
