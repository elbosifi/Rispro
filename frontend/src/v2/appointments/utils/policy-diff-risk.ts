import type { PolicyDisplayLookupsDto, PolicySnapshotDto } from "../types";

export interface PolicyDiffRiskWarning {
  section: string;
  message: string;
  ruleId?: number | string;
}

export interface PolicyDiffRiskSummary {
  affectedSections: string[];
  highRiskWarnings: PolicyDiffRiskWarning[];
}

const sectionLabels = {
  categoryDailyLimits: "Daily category limits",
  modalityBlockedRules: "Blocked dates",
  examTypeRules: "Exam restriction rules",
  examMixQuotaRules: "Exam mix quota groups",
  examTypeSpecialQuotas: "Special quotas",
  specialReasonCodes: "Special reason codes",
} as const;

function byId<T extends { id: number }>(rows: T[] | undefined): Map<number, T> {
  return new Map((rows ?? []).map((row) => [Number(row.id), row]));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function pushAffected(affected: Set<string>, section: keyof typeof sectionLabels, published: unknown, draft: unknown): void {
  if (!sameJson(published, draft)) affected.add(sectionLabels[section]);
}

function hasId(ids: number[], value: number): boolean {
  return ids.map(Number).includes(Number(value));
}

function collectExamTypeIds(snapshot: PolicySnapshotDto): number[] {
  return [
    ...snapshot.examTypeRules.flatMap((row) => row.examTypeIds.map(Number)),
    ...(snapshot.examMixQuotaRules ?? []).flatMap((row) => row.examTypeIds.map(Number)),
    ...snapshot.examTypeSpecialQuotas.map((row) => Number(row.examTypeId)),
  ].filter((id) => Number.isInteger(id) && id > 0);
}

function collectModalityIds(snapshot: PolicySnapshotDto): number[] {
  return [
    ...snapshot.categoryDailyLimits.map((row) => Number(row.modalityId)),
    ...snapshot.modalityBlockedRules.map((row) => Number(row.modalityId)),
    ...snapshot.examTypeRules.map((row) => Number(row.modalityId)),
    ...(snapshot.examMixQuotaRules ?? []).map((row) => Number(row.modalityId)),
  ].filter((id) => Number.isInteger(id) && id > 0);
}

function collectUserIds(snapshot: PolicySnapshotDto): number[] {
  return snapshot.examTypeSpecialQuotas
    .flatMap((row) => (row.allowedUserIds ?? []).map(Number))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export function getPolicyDiffRiskSummary(
  publishedSnapshot: PolicySnapshotDto | undefined,
  draftSnapshot: PolicySnapshotDto | undefined,
  displayLookups?: PolicyDisplayLookupsDto
): PolicyDiffRiskSummary {
  const affected = new Set<string>();
  const highRiskWarnings: PolicyDiffRiskWarning[] = [];
  if (!publishedSnapshot || !draftSnapshot) return { affectedSections: [], highRiskWarnings };

  pushAffected(affected, "categoryDailyLimits", publishedSnapshot.categoryDailyLimits, draftSnapshot.categoryDailyLimits);
  pushAffected(affected, "modalityBlockedRules", publishedSnapshot.modalityBlockedRules, draftSnapshot.modalityBlockedRules);
  pushAffected(affected, "examTypeRules", publishedSnapshot.examTypeRules, draftSnapshot.examTypeRules);
  pushAffected(affected, "examMixQuotaRules", publishedSnapshot.examMixQuotaRules ?? [], draftSnapshot.examMixQuotaRules ?? []);
  pushAffected(affected, "examTypeSpecialQuotas", publishedSnapshot.examTypeSpecialQuotas, draftSnapshot.examTypeSpecialQuotas);
  pushAffected(affected, "specialReasonCodes", publishedSnapshot.specialReasonCodes, draftSnapshot.specialReasonCodes);

  for (const [section, publishedRows, draftRows] of [
    ["Exam restriction rules", publishedSnapshot.examTypeRules, draftSnapshot.examTypeRules],
    ["Exam mix quota groups", publishedSnapshot.examMixQuotaRules ?? [], draftSnapshot.examMixQuotaRules ?? []],
    ["Blocked dates", publishedSnapshot.modalityBlockedRules, draftSnapshot.modalityBlockedRules],
  ] as const) {
    const draftById = byId(draftRows);
    for (const row of publishedRows) {
      if (row.isActive && !draftById.has(Number(row.id))) {
        highRiskWarnings.push({ section, ruleId: row.id, message: "Active rule removed." });
      }
    }
  }

  for (const publishedRow of publishedSnapshot.examTypeRules) {
    const draftRow = byId(draftSnapshot.examTypeRules).get(Number(publishedRow.id));
    if (!draftRow) continue;
    if (publishedRow.examTypeIds.length > 0 && draftRow.examTypeIds.length === 0) {
      highRiskWarnings.push({ section: "Exam restriction rules", ruleId: draftRow.id, message: "Exam selection cleared." });
    }
    if (publishedRow.effectMode === "restriction_overridable" && draftRow.effectMode === "hard_restriction") {
      highRiskWarnings.push({
        section: "Exam restriction rules",
        ruleId: draftRow.id,
        message: "Restriction changed from supervisor-overridable to hard restriction.",
      });
    }
    if (Number(publishedRow.modalityId) !== Number(draftRow.modalityId)) {
      highRiskWarnings.push({ section: "Exam restriction rules", ruleId: draftRow.id, message: "Modality changed." });
    }
  }

  for (const publishedRow of publishedSnapshot.categoryDailyLimits) {
    const draftRow = byId(draftSnapshot.categoryDailyLimits).get(Number(publishedRow.id));
    if (draftRow && Number(draftRow.dailyLimit) < Number(publishedRow.dailyLimit)) {
      highRiskWarnings.push({ section: "Daily category limits", ruleId: draftRow.id, message: "Category daily limit reduced." });
    }
  }

  for (const publishedRow of publishedSnapshot.examMixQuotaRules ?? []) {
    const draftRow = byId(draftSnapshot.examMixQuotaRules ?? []).get(Number(publishedRow.id));
    if (!draftRow) continue;
    if (publishedRow.examTypeIds.length > 0 && draftRow.examTypeIds.length === 0) {
      highRiskWarnings.push({ section: "Exam mix quota groups", ruleId: draftRow.id, message: "Exam selection cleared." });
    }
    if (Number(draftRow.dailyLimit) < Number(publishedRow.dailyLimit)) {
      highRiskWarnings.push({ section: "Exam mix quota groups", ruleId: draftRow.id, message: "Exam mix quota daily limit reduced." });
    }
    if (Number(publishedRow.modalityId) !== Number(draftRow.modalityId)) {
      highRiskWarnings.push({ section: "Exam mix quota groups", ruleId: draftRow.id, message: "Modality changed." });
    }
  }

  for (const publishedRow of publishedSnapshot.examTypeSpecialQuotas) {
    const draftRow = byId(draftSnapshot.examTypeSpecialQuotas).get(Number(publishedRow.id));
    if (draftRow && Number(draftRow.dailyExtraSlots) < Number(publishedRow.dailyExtraSlots)) {
      highRiskWarnings.push({ section: "Special quotas", ruleId: draftRow.id, message: "Special quota extra slots reduced." });
    }
  }

  const publishedModalityIds = collectModalityIds(publishedSnapshot);
  const publishedExamTypeIds = collectExamTypeIds(publishedSnapshot);
  const publishedUserIds = collectUserIds(publishedSnapshot);

  const modalityById = new Map((displayLookups?.modalities ?? []).map((row) => [Number(row.id), row]));
  const examTypeById = new Map((displayLookups?.examTypes ?? []).map((row) => [Number(row.id), row]));
  const userById = new Map((displayLookups?.users ?? []).map((row) => [Number(row.id), row]));

  for (const modalityId of collectModalityIds(draftSnapshot)) {
    if (hasId(publishedModalityIds, modalityId)) continue;
    const modality = modalityById.get(modalityId);
    if (!modality) highRiskWarnings.push({ section: "References", message: `Unknown modality reference introduced: ${modalityId}.` });
    else if (modality.isActive === false) highRiskWarnings.push({ section: "References", message: `Inactive modality reference introduced: ${modality.nameEn || modality.name}.` });
  }
  for (const examTypeId of collectExamTypeIds(draftSnapshot)) {
    if (hasId(publishedExamTypeIds, examTypeId)) continue;
    const examType = examTypeById.get(examTypeId);
    if (!examType) highRiskWarnings.push({ section: "References", message: `Unknown exam type reference introduced: ${examTypeId}.` });
    else if (examType.isActive === false) highRiskWarnings.push({ section: "References", message: `Inactive exam type reference introduced: ${examType.nameEn || examType.name}.` });
  }
  for (const userId of collectUserIds(draftSnapshot)) {
    if (hasId(publishedUserIds, userId)) continue;
    const user = userById.get(userId);
    if (!user) highRiskWarnings.push({ section: "References", message: `Unknown user reference introduced: ${userId}.` });
    else if (user.isActive === false) highRiskWarnings.push({ section: "References", message: `Inactive user reference introduced: ${user.fullName || user.username}.` });
  }

  return { affectedSections: [...affected], highRiskWarnings };
}
