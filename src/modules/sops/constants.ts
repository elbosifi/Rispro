export const SOP_STATUSES = ["draft", "published", "archived"] as const;
export type SopStatus = (typeof SOP_STATUSES)[number];

export const SOP_VERSION_STATUSES = ["draft", "published", "superseded"] as const;
export type SopVersionStatus = (typeof SOP_VERSION_STATUSES)[number];

export const SOP_CATEGORIES = [
  "General",
  "CT",
  "MRI",
  "Ultrasound",
  "Mammography",
  "X-Ray",
  "Interventional Radiology",
  "Patient Safety",
  "PACS / IT",
  "Reception / Registration",
  "Administrative",
] as const;
export type SopCategory = (typeof SOP_CATEGORIES)[number];

export const SOP_SECTION_DEFINITIONS = [
  { key: "purpose", title: "Purpose", required: true },
  { key: "scope", title: "Scope", required: true },
  { key: "responsibilities", title: "Responsibilities", required: true },
  { key: "definitions", title: "Definitions / Abbreviations", required: false },
  { key: "safety", title: "Safety / Precautions", required: false },
  { key: "procedure", title: "Procedure", required: true },
  { key: "documentation", title: "Documentation / Records", required: false },
  { key: "references", title: "References", required: false },
] as const;

export type SopSectionKey = (typeof SOP_SECTION_DEFINITIONS)[number]["key"];

export const SOP_MANAGEMENT_ROLES = ["supervisor", "super_admin"] as const;
