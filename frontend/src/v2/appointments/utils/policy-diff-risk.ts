import type {
  PolicyDisplayLookupsDto,
  PolicyExamMixQuotaRuleDto,
  PolicyExamTypeRuleDto,
  PolicyModalityBlockedRuleDto,
  PolicySnapshotDto,
} from "../types";

export interface PolicyDiffRiskWarning {
  section: string;
  message: string;
  ruleId?: number | string;
}

export interface PolicyDiffRiskSummary {
  affectedSections: string[];
  highRiskWarnings: PolicyDiffRiskWarning[];
}

interface DiffRows<T extends { id: number }> {
  added: T[];
  removed: T[];
  matched: Array<{ published: T; draft: T }>;
  ambiguousKeys: string[];
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function sortedNumbers(values: number[] | undefined): number[] {
  return [...(values ?? [])].map(Number).filter((value) => Number.isInteger(value)).sort((a, b) => a - b);
}

function normalized(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function modalityLabel(modalityId: number, lookups?: PolicyDisplayLookupsDto): string {
  const modality = lookups?.modalities.find((row) => Number(row.id) === Number(modalityId));
  if (!modality) return `Modality ${modalityId}`;
  return modality.code ? `${modality.nameEn || modality.name} (${modality.code})` : modality.nameEn || modality.name;
}

function examTypeLabel(examTypeId: number, lookups?: PolicyDisplayLookupsDto): string {
  const examType = lookups?.examTypes.find((row) => Number(row.id) === Number(examTypeId));
  if (!examType) return `Exam type ${examTypeId}`;
  return examType.code ? `${examType.nameEn || examType.name} (${examType.code})` : examType.nameEn || examType.name;
}

function userLabel(userId: number, lookups?: PolicyDisplayLookupsDto): string {
  const user = lookups?.users.find((row) => Number(row.id) === Number(userId));
  return user ? user.fullName || user.username : `User ${userId}`;
}

function ruleTypeLabel(ruleType: string): string {
  if (ruleType === "date_range") return "Date range";
  if (ruleType === "weekly_recurrence") return "Weekly recurrence";
  if (ruleType === "yearly_recurrence") return "Yearly recurrence";
  return "Specific date";
}

function effectLabel(effectMode: string): string {
  return effectMode === "hard_restriction" ? "Hard restriction" : "Supervisor-overridable restriction";
}

function scheduleSummary(row: {
  ruleType: string;
  specificDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  weekday?: number | null;
  alternateWeeks?: boolean;
  recurrenceAnchorDate?: string | null;
  recurStartMonth?: number | null;
  recurStartDay?: number | null;
  recurEndMonth?: number | null;
  recurEndDay?: number | null;
}): string {
  if (row.ruleType === "date_range") return `Date range ${row.startDate ?? "-"} to ${row.endDate ?? "-"}`;
  if (row.ruleType === "weekly_recurrence") {
    const weekday = row.weekday == null ? "weekday not set" : weekdays[row.weekday] ?? "weekday not set";
    return `Weekly recurrence ${weekday}${row.alternateWeeks ? " alternate weeks" : ""}`;
  }
  if (row.ruleType === "yearly_recurrence") {
    return `Yearly recurrence ${row.recurStartMonth ?? "-"}/${row.recurStartDay ?? "-"} to ${row.recurEndMonth ?? "-"}/${row.recurEndDay ?? "-"}`;
  }
  return `Specific date ${row.specificDate ?? "-"}`;
}

function examSelectionSummary(examTypeIds: number[], lookups?: PolicyDisplayLookupsDto): string {
  const ids = sortedNumbers(examTypeIds);
  if (ids.length === 0) return "0 selected exams";
  const names = ids.slice(0, 3).map((id) => examTypeLabel(id, lookups)).join(", ");
  const suffix = ids.length > 3 ? `, +${ids.length - 3} more` : "";
  return `${ids.length} selected exam${ids.length === 1 ? "" : "s"} (${names}${suffix})`;
}

function examRuleIdentity(row: PolicyExamTypeRuleDto, lookups?: PolicyDisplayLookupsDto): string {
  const title = row.title?.trim() || `Exam restriction rule #${row.id}`;
  return `${modalityLabel(row.modalityId, lookups)} - ${title} - ${ruleTypeLabel(row.ruleType)} - ${scheduleSummary(row)}`;
}

function examMixIdentity(row: PolicyExamMixQuotaRuleDto, lookups?: PolicyDisplayLookupsDto): string {
  const title = row.title?.trim() || `Exam mix group #${row.id}`;
  return `${modalityLabel(row.modalityId, lookups)} - ${title} - ${ruleTypeLabel(row.ruleType)} - ${scheduleSummary(row)}`;
}

function blockedIdentity(row: PolicyModalityBlockedRuleDto, lookups?: PolicyDisplayLookupsDto): string {
  const title = row.title?.trim() || `Blocked date rule #${row.id}`;
  return `${modalityLabel(row.modalityId, lookups)} - ${title} - ${ruleTypeLabel(row.ruleType)} - ${scheduleSummary(row)}`;
}

function exactFingerprint(section: string, row: unknown): string {
  const value = row as Record<string, unknown>;
  const withoutId = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id"));
  if (Array.isArray(withoutId.examTypeIds)) withoutId.examTypeIds = sortedNumbers(withoutId.examTypeIds as number[]);
  if (Array.isArray(withoutId.allowedUserIds)) withoutId.allowedUserIds = sortedNumbers(withoutId.allowedUserIds as number[]);
  return `${section}:${normalized(withoutId)}`;
}

function diffRows<T extends { id: number }>(
  publishedRows: T[],
  draftRows: T[],
  section: string,
  identityKey: (row: T) => string
): DiffRows<T> {
  const unmatchedPublished = [...publishedRows];
  const unmatchedDraft = [...draftRows];
  const matched: Array<{ published: T; draft: T }> = [];

  for (let draftIndex = unmatchedDraft.length - 1; draftIndex >= 0; draftIndex--) {
    const fingerprint = exactFingerprint(section, unmatchedDraft[draftIndex]);
    const publishedIndex = unmatchedPublished.findIndex((row) => exactFingerprint(section, row) === fingerprint);
    if (publishedIndex >= 0) {
      unmatchedDraft.splice(draftIndex, 1);
      unmatchedPublished.splice(publishedIndex, 1);
    }
  }

  const draftKeyCounts = countKeys(unmatchedDraft, identityKey);
  const publishedKeyCounts = countKeys(unmatchedPublished, identityKey);
  const ambiguousKeys: string[] = [];

  for (let draftIndex = unmatchedDraft.length - 1; draftIndex >= 0; draftIndex--) {
    const draft = unmatchedDraft[draftIndex];
    const key = identityKey(draft);
    if (!key) continue;
    const draftCount = draftKeyCounts.get(key) ?? 0;
    const publishedCount = publishedKeyCounts.get(key) ?? 0;
    if (draftCount !== 1 || publishedCount !== 1) {
      if (draftCount > 0 && publishedCount > 0) ambiguousKeys.push(key);
      continue;
    }
    const publishedIndex = unmatchedPublished.findIndex((row) => identityKey(row) === key);
    if (publishedIndex >= 0) {
      matched.push({ published: unmatchedPublished[publishedIndex], draft });
      unmatchedDraft.splice(draftIndex, 1);
      unmatchedPublished.splice(publishedIndex, 1);
    }
  }

  return { added: unmatchedDraft, removed: unmatchedPublished, matched, ambiguousKeys: [...new Set(ambiguousKeys)] };
}

function countKeys<T>(rows: T[], identityKey: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = identityKey(row);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function getPolicyDiffRiskSummary(
  publishedSnapshot: PolicySnapshotDto | undefined,
  draftSnapshot: PolicySnapshotDto | undefined,
  displayLookups?: PolicyDisplayLookupsDto
): PolicyDiffRiskSummary {
  if (!publishedSnapshot || !draftSnapshot) return { affectedSections: [], highRiskWarnings: [] };

  const affected = new Set<string>();
  const highRiskWarnings: PolicyDiffRiskWarning[] = [];

  const categories = diffRows(
    publishedSnapshot.categoryDailyLimits,
    draftSnapshot.categoryDailyLimits,
    "Daily category limits",
    (row) => `${row.modalityId}|${row.caseCategory}`
  );
  if (categories.added.length || categories.removed.length || categories.matched.length) affected.add("Daily category limits");
  for (const { published, draft } of categories.matched) {
    if (Number(draft.dailyLimit) < Number(published.dailyLimit)) {
      highRiskWarnings.push({
        section: "Daily category limits",
        ruleId: draft.id,
        message: `Category daily limit reduced: ${modalityLabel(draft.modalityId, displayLookups)} - ${draft.caseCategory} - daily limit ${published.dailyLimit} -> ${draft.dailyLimit}.`,
      });
    }
  }

  const blocked = diffRows(
    publishedSnapshot.modalityBlockedRules,
    draftSnapshot.modalityBlockedRules,
    "Blocked dates",
    (row) => `${row.modalityId}|${row.ruleType}|${row.specificDate ?? ""}|${row.startDate ?? ""}|${row.endDate ?? ""}|${row.recurStartMonth ?? ""}|${row.recurStartDay ?? ""}|${row.recurEndMonth ?? ""}|${row.recurEndDay ?? ""}`
  );
  if (blocked.added.length || blocked.removed.length || blocked.matched.length) affected.add("Blocked dates");
  for (const row of blocked.removed) {
    if (row.isActive) {
      highRiskWarnings.push({ section: "Blocked dates", ruleId: row.id, message: `Active blocked date removed: ${blockedIdentity(row, displayLookups)}.` });
    }
  }

  const examRules = diffRows(
    publishedSnapshot.examTypeRules,
    draftSnapshot.examTypeRules,
    "Exam restriction rules",
    (row) => row.title?.trim()
      ? `${row.modalityId}|title|${normalizeText(row.title)}`
      : `${row.modalityId}|${row.ruleType}|${row.specificDate ?? ""}|${row.startDate ?? ""}|${row.endDate ?? ""}|${row.weekday ?? ""}|${row.alternateWeeks}|${row.recurrenceAnchorDate ?? ""}`
  );
  if (examRules.added.length || examRules.removed.length || examRules.matched.length) affected.add("Exam restriction rules");
  for (const row of examRules.removed) {
    if (row.isActive) {
      highRiskWarnings.push({
        section: "Exam restriction rules",
        ruleId: row.id,
        message: `Exam restriction rule removed: ${examRuleIdentity(row, displayLookups)} - ${effectLabel(row.effectMode)} - ${examSelectionSummary(row.examTypeIds, displayLookups)}.`,
      });
    }
  }
  for (const { published, draft } of examRules.matched) {
    if (published.examTypeIds.length > 0 && draft.examTypeIds.length === 0) {
      highRiskWarnings.push({
        section: "Exam restriction rules",
        ruleId: draft.id,
        message: `Exam selection cleared: ${examRuleIdentity(draft, displayLookups)} - ${examSelectionSummary(published.examTypeIds, displayLookups)} removed.`,
      });
    }
    if (published.effectMode === "restriction_overridable" && draft.effectMode === "hard_restriction") {
      highRiskWarnings.push({
        section: "Exam restriction rules",
        ruleId: draft.id,
        message: `Exam restriction changed: ${examRuleIdentity(draft, displayLookups)} - ${effectLabel(published.effectMode)} -> ${effectLabel(draft.effectMode)}.`,
      });
    }
  }

  const mixes = diffRows(
    publishedSnapshot.examMixQuotaRules ?? [],
    draftSnapshot.examMixQuotaRules ?? [],
    "Exam mix quota groups",
    (row) => row.title?.trim()
      ? `${row.modalityId}|title|${normalizeText(row.title)}`
      : `${row.modalityId}|${row.ruleType}|${row.specificDate ?? ""}|${row.startDate ?? ""}|${row.endDate ?? ""}|${row.weekday ?? ""}|${row.alternateWeeks}|${row.recurrenceAnchorDate ?? ""}`
  );
  if (mixes.added.length || mixes.removed.length || mixes.matched.length) affected.add("Exam mix quota groups");
  for (const row of mixes.removed) {
    if (row.isActive) {
      highRiskWarnings.push({
        section: "Exam mix quota groups",
        ruleId: row.id,
        message: `Exam mix group removed: ${examMixIdentity(row, displayLookups)} - daily limit ${row.dailyLimit} - ${examSelectionSummary(row.examTypeIds, displayLookups)}.`,
      });
    }
  }
  for (const { published, draft } of mixes.matched) {
    if (published.examTypeIds.length > 0 && draft.examTypeIds.length === 0) {
      highRiskWarnings.push({
        section: "Exam mix quota groups",
        ruleId: draft.id,
        message: `Exam selection cleared: ${examMixIdentity(draft, displayLookups)} - ${examSelectionSummary(published.examTypeIds, displayLookups)} removed.`,
      });
    }
    if (Number(draft.dailyLimit) < Number(published.dailyLimit)) {
      highRiskWarnings.push({
        section: "Exam mix quota groups",
        ruleId: draft.id,
        message: `Exam mix quota reduced: ${examMixIdentity(draft, displayLookups)} - daily limit ${published.dailyLimit} -> ${draft.dailyLimit}.`,
      });
    }
  }

  const quotas = diffRows(
    publishedSnapshot.specialQuotaRules,
    draftSnapshot.specialQuotaRules,
    "Special quotas",
    (row) => String(row.logicalKey)
  );
  if (quotas.added.length || quotas.removed.length || quotas.matched.length) affected.add("Special quotas");
  for (const { published, draft } of quotas.matched) {
    if (Number(draft.dailyExtraSlots) < Number(published.dailyExtraSlots)) {
      highRiskWarnings.push({
        section: "Special quotas",
        ruleId: draft.id,
        message: `Special Quota reduced: ${draft.title || draft.logicalKey} - extra slots ${published.dailyExtraSlots} -> ${draft.dailyExtraSlots}.`,
      });
    }
    const removedExams = sortedNumbers(published.examTypeIds).filter((id) => !draft.examTypeIds.map(Number).includes(id));
    const addedExams = sortedNumbers(draft.examTypeIds).filter((id) => !published.examTypeIds.map(Number).includes(id));
    const removedUsers = sortedNumbers(published.allowedUserIds).filter((id) => !draft.allowedUserIds.map(Number).includes(id));
    const addedUsers = sortedNumbers(draft.allowedUserIds).filter((id) => !published.allowedUserIds.map(Number).includes(id));
    if (removedExams.length > 0) highRiskWarnings.push({ section: "Special quotas", ruleId: draft.id, message: `Exams removed from ${draft.title || draft.logicalKey}: ${removedExams.map((id) => examTypeLabel(id, displayLookups)).join(", ")}.` });
    if (addedExams.length > 0) highRiskWarnings.push({ section: "Special quotas", ruleId: draft.id, message: `Exams added to ${draft.title || draft.logicalKey}: ${addedExams.map((id) => examTypeLabel(id, displayLookups)).join(", ")}.` });
    if (removedUsers.length > 0) highRiskWarnings.push({ section: "Special quotas", ruleId: draft.id, message: `Users removed from ${draft.title || draft.logicalKey}: ${removedUsers.map((id) => userLabel(id, displayLookups)).join(", ")}.` });
    if (addedUsers.length > 0) highRiskWarnings.push({ section: "Special quotas", ruleId: draft.id, message: `Users added to ${draft.title || draft.logicalKey}: ${addedUsers.map((id) => userLabel(id, displayLookups)).join(", ")}.` });
    if (published.isActive && !draft.isActive) highRiskWarnings.push({ section: "Special quotas", ruleId: draft.id, message: `Special Quota disabled: ${draft.title || draft.logicalKey}.` });
  }

  const ambiguous = [...categories.ambiguousKeys, ...blocked.ambiguousKeys, ...examRules.ambiguousKeys, ...mixes.ambiguousKeys, ...quotas.ambiguousKeys];
  if (ambiguous.length > 0) {
    highRiskWarnings.push({
      section: "Diff identity",
      message: "Ambiguous rule identity; shown as added/removed instead of modified.",
    });
  }

  return { affectedSections: [...affected], highRiskWarnings };
}
