import type { PolicyDisplayLookupsDto, PolicySnapshotDto } from "../types";

export interface PolicyAdminValidationItem {
  section: string;
  message: string;
  ruleId?: number | string;
}

export interface PolicyAdminValidationResult {
  errors: PolicyAdminValidationItem[];
  warnings: PolicyAdminValidationItem[];
}

const SECTION = {
  categoryLimits: "Daily category limits",
  blockedDates: "Blocked dates",
  examRules: "Exam restriction rules",
  examMix: "Exam mix quota groups",
  specialQuotas: "Special quotas",
} as const;

function isValidDateRange(startDate: string | null, endDate: string | null): boolean {
  return Boolean(startDate && endDate && startDate <= endDate);
}

function isValidWeekday(weekday: number | null): boolean {
  return typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6;
}

function isValidMonth(month: number | null): boolean {
  return typeof month === "number" && Number.isInteger(month) && month >= 1 && month <= 12;
}

function isValidDay(day: number | null): boolean {
  return typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 31;
}

function examTypeLabel(id: number, lookups: PolicyDisplayLookupsDto): string {
  const examType = lookups.examTypes.find((item) => item.id === id);
  return examType?.nameEn || examType?.name || examType?.code || `Exam type ID ${id}`;
}

function userLabel(id: number, lookups: PolicyDisplayLookupsDto): string {
  const user = lookups.users.find((item) => item.id === id);
  return user?.fullName || user?.username || `User ID ${id}`;
}

export function validatePolicyDraftForAdmin(
  snapshot: PolicySnapshotDto | null | undefined,
  displayLookups: PolicyDisplayLookupsDto | null | undefined
): PolicyAdminValidationResult {
  const errors: PolicyAdminValidationItem[] = [];
  const warnings: PolicyAdminValidationItem[] = [];
  if (!snapshot) return { errors, warnings };

  const lookups = displayLookups ?? { modalities: [], examTypes: [], users: [] };
  const examTypeById = new Map(lookups.examTypes.map((item) => [Number(item.id), item]));
  const userById = new Map(lookups.users.map((item) => [Number(item.id), item]));
  const modalityById = new Map(lookups.modalities.map((item) => [Number(item.id), item]));

  const seenCategoryLimits = new Set<string>();
  for (const row of snapshot.categoryDailyLimits) {
    if (!row.isActive) continue;
    const key = `${row.modalityId}:${row.caseCategory}`;
    if (seenCategoryLimits.has(key)) {
      errors.push({
        section: SECTION.categoryLimits,
        ruleId: row.id,
        message: "Duplicate active limit for the same modality and category.",
      });
    }
    seenCategoryLimits.add(key);
    const modality = modalityById.get(Number(row.modalityId));
    if (modality?.isActive === false) {
      warnings.push({
        section: SECTION.categoryLimits,
        ruleId: row.id,
        message: `${modality.nameEn || modality.name || modality.code} is inactive.`,
      });
    }
  }

  for (const row of snapshot.modalityBlockedRules) {
    if (!row.isActive) continue;
    const modality = modalityById.get(Number(row.modalityId));
    if (modality?.isActive === false) {
      warnings.push({
        section: SECTION.blockedDates,
        ruleId: row.id,
        message: `${modality.nameEn || modality.name || modality.code} is inactive.`,
      });
    }
    if (row.ruleType === "date_range" && !isValidDateRange(row.startDate, row.endDate)) {
      errors.push({
        section: SECTION.blockedDates,
        ruleId: row.id,
        message: "Date range must include start and end dates, and the start date must be before or equal to the end date.",
      });
    }
    if (
      row.ruleType === "yearly_recurrence" &&
      (!isValidMonth(row.recurStartMonth) ||
        !isValidDay(row.recurStartDay) ||
        !isValidMonth(row.recurEndMonth) ||
        !isValidDay(row.recurEndDay))
    ) {
      errors.push({
        section: SECTION.blockedDates,
        ruleId: row.id,
        message: "Yearly recurrence must use valid recurrence months and days.",
      });
    }
  }

  for (const row of snapshot.examTypeRules) {
    if (!row.isActive) continue;
    if (row.examTypeIds.length === 0) {
      errors.push({
        section: SECTION.examRules,
        ruleId: row.id,
        message: "Active exam restriction rule must select at least one exam.",
      });
    }
    if (row.ruleType === "date_range" && !isValidDateRange(row.startDate, row.endDate)) {
      errors.push({
        section: SECTION.examRules,
        ruleId: row.id,
        message: "Date range must include start and end dates, and the start date must be before or equal to the end date.",
      });
    }
    if (row.ruleType === "weekly_recurrence" && !isValidWeekday(row.weekday)) {
      errors.push({
        section: SECTION.examRules,
        ruleId: row.id,
        message: "Weekly recurrence must select a weekday.",
      });
    }
    for (const examTypeId of row.examTypeIds) {
      const examType = examTypeById.get(Number(examTypeId));
      if (!examType) {
        errors.push({
          section: SECTION.examRules,
          ruleId: row.id,
          message: `Unknown exam type ID ${examTypeId}.`,
        });
      } else if (examType.isActive === false) {
        warnings.push({
          section: SECTION.examRules,
          ruleId: row.id,
          message: `${examTypeLabel(examTypeId, lookups)} is inactive.`,
        });
      }
    }
  }

  for (const row of snapshot.examMixQuotaRules ?? []) {
    if (!row.isActive) continue;
    if (row.examTypeIds.length === 0) {
      errors.push({
        section: SECTION.examMix,
        ruleId: row.id,
        message: "Active exam mix quota group must select at least one exam.",
      });
    }
    if (!Number.isInteger(row.dailyLimit) || row.dailyLimit <= 0) {
      errors.push({
        section: SECTION.examMix,
        ruleId: row.id,
        message: "Exam mix quota group must have a positive daily limit.",
      });
    }
    if (row.ruleType === "date_range" && !isValidDateRange(row.startDate, row.endDate)) {
      errors.push({
        section: SECTION.examMix,
        ruleId: row.id,
        message: "Date range must include start and end dates, and the start date must be before or equal to the end date.",
      });
    }
    if (row.ruleType === "weekly_recurrence" && !isValidWeekday(row.weekday)) {
      errors.push({
        section: SECTION.examMix,
        ruleId: row.id,
        message: "Weekly recurrence must select a weekday.",
      });
    }
    for (const examTypeId of row.examTypeIds) {
      const examType = examTypeById.get(Number(examTypeId));
      if (!examType) {
        errors.push({
          section: SECTION.examMix,
          ruleId: row.id,
          message: `Unknown exam type ID ${examTypeId}.`,
        });
      } else if (examType.isActive === false) {
        warnings.push({
          section: SECTION.examMix,
          ruleId: row.id,
          message: `${examTypeLabel(examTypeId, lookups)} is inactive.`,
        });
      }
    }
  }

  for (const row of snapshot.examTypeSpecialQuotas) {
    if (!row.isActive) continue;
    const examType = examTypeById.get(Number(row.examTypeId));
    if (!examType) {
      errors.push({
        section: SECTION.specialQuotas,
        ruleId: row.id,
        message: `Special quota references unknown exam type ID ${row.examTypeId}.`,
      });
    } else if (examType.isActive === false) {
      warnings.push({
        section: SECTION.specialQuotas,
        ruleId: row.id,
        message: `${examTypeLabel(row.examTypeId, lookups)} is inactive.`,
      });
    }
    if (!Number.isInteger(row.dailyExtraSlots) || row.dailyExtraSlots <= 0) {
      errors.push({
        section: SECTION.specialQuotas,
        ruleId: row.id,
        message: "Special quota must have a positive number of extra slots.",
      });
    }
    for (const userId of row.allowedUserIds ?? []) {
      const user = userById.get(Number(userId));
      if (!user) {
        errors.push({
          section: SECTION.specialQuotas,
          ruleId: row.id,
          message: `Unknown user ID ${userId}.`,
        });
      } else if (user.isActive === false) {
        errors.push({
          section: SECTION.specialQuotas,
          ruleId: row.id,
          message: `${userLabel(userId, lookups)} is inactive.`,
        });
      }
    }
  }

  return { errors, warnings };
}
