import type { SopCategory, SopStatus, SopSectionKey, SopVersionStatus } from "./constants.js";

export type JsonRecord = Record<string, unknown>;

export interface SopSectionDocument {
  key: SopSectionKey;
  title: string;
  required: boolean;
  content: JsonRecord;
}

export interface SopDocument {
  type: "sop";
  version: 1;
  sections: SopSectionDocument[];
}

export interface SopVersion {
  id: number;
  sopId: number;
  version: string;
  status: SopVersionStatus;
  contentJson: SopDocument;
  changeSummary: string;
  effectiveDate: string | null;
  createdByUserId: number;
  createdByName: string | null;
  createdByUsername: string | null;
  createdAt: string;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedAt: string;
  publishedByUserId: number | null;
  publishedByName: string | null;
  publishedByUsername: string | null;
  publishedAt: string | null;
}

export interface SopSummary {
  id: number;
  code: string;
  title: string;
  category: SopCategory;
  status: SopStatus;
  currentVersion: string | null;
  draftVersion: string | null;
  currentEffectiveDate: string | null;
  createdByUserId: number;
  createdByName: string | null;
  createdAt: string;
  updatedByUserId: number | null;
  updatedByName: string | null;
  updatedAt: string;
}

export interface SopDetail {
  sop: SopSummary;
  versions: SopVersion[];
}

export interface SopFilters {
  search?: string | null;
  category?: string | null;
  status?: string | null;
}
