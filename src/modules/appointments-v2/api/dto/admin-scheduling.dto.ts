/**
 * Appointments V2 — Admin scheduling DTOs.
 */

export interface CreatePolicyDraftDto {
  policySetKey: string;
  changeNote?: string;
}

export interface FieldValidationErrorDto {
  field: string;
  code: string;
  message: string;
}

export interface PolicyCategoryDailyLimitDto {
  id: number;
  modalityId: number;
  caseCategory: "oncology" | "non_oncology";
  dailyLimit: number;
  isActive: boolean;
}

export interface PolicyModalityBlockedRuleDto {
  id: number;
  modalityId: number;
  ruleType: "specific_date" | "date_range" | "yearly_recurrence";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  recurStartMonth: number | null;
  recurStartDay: number | null;
  recurEndMonth: number | null;
  recurEndDay: number | null;
  isOverridable: boolean;
  isActive: boolean;
  title: string | null;
  notes: string | null;
}

export interface PolicyExamTypeRuleDto {
  id: number;
  modalityId: number;
  ruleType: "specific_date" | "date_range" | "weekly_recurrence";
  effectMode: "hard_restriction" | "restriction_overridable";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  examTypeIds: number[];
  title: string | null;
  notes: string | null;
  isActive: boolean;
}

export interface PolicySpecialQuotaRuleDto {
  id: number;
  logicalKey: string;
  modalityId: number;
  title: string | null;
  examTypeIds: number[];
  dailyExtraSlots: number;
  allowedUserIds: number[];
  isActive: boolean;
}

export interface PolicyExamMixQuotaRuleDto {
  id: number;
  modalityId: number;
  title: string | null;
  ruleType: "specific_date" | "date_range" | "weekly_recurrence";
  specificDate: string | null;
  startDate: string | null;
  endDate: string | null;
  weekday: number | null;
  alternateWeeks: boolean;
  recurrenceAnchorDate: string | null;
  dailyLimit: number;
  examTypeIds: number[];
  isActive: boolean;
}

export interface PolicySpecialReasonCodeDto {
  code: string;
  labelAr: string;
  labelEn: string;
  isActive: boolean;
}

export interface PolicySnapshotDto {
  categoryDailyLimits: PolicyCategoryDailyLimitDto[];
  modalityBlockedRules: PolicyModalityBlockedRuleDto[];
  examTypeRules: PolicyExamTypeRuleDto[];
  specialQuotaRules: PolicySpecialQuotaRuleDto[];
  examMixQuotaRules?: PolicyExamMixQuotaRuleDto[];
  specialReasonCodes: PolicySpecialReasonCodeDto[];
}

export interface SavePolicyDraftDto {
  policySnapshot: PolicySnapshotDto;
  changeNote?: string;
}

export interface PublishPolicyDto {
  changeNote?: string;
}

export interface PolicyVersionDto {
  id: number;
  policySetId: number;
  versionNo: number;
  status: "draft" | "published" | "archived";
  configHash: string;
  changeNote: string | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface PolicySetDto {
  id: number;
  key: string;
  name: string;
}

export interface PolicyDisplayLookupsDto {
  modalities: Array<{
    id: number;
    name: string;
    nameAr: string | null;
    nameEn: string | null;
    code: string | null;
    isActive: boolean;
  }>;
  examTypes: Array<{
    id: number;
    name: string;
    nameAr: string | null;
    nameEn: string | null;
    code: string | null;
    modalityId: number | null;
    isActive: boolean;
  }>;
  users: Array<{
    id: number;
    username: string;
    fullName: string;
    role: string;
    isActive: boolean;
  }>;
}

export interface PolicyStatusDto {
  policySet: PolicySetDto | null;
  published: PolicyVersionDto | null;
  draft: PolicyVersionDto | null;
  publishedSnapshot: PolicySnapshotDto;
  draftSnapshot: PolicySnapshotDto;
  displayLookups: PolicyDisplayLookupsDto;
}

export interface PolicyRuleDiffDto {
  id: number;
  ruleType: string;
  modalityId: number | null;
  caseCategory: string | null;
  dailyLimit: number | null;
  isActive: boolean;
}

export interface PolicyPreviewDto {
  draftVersionId: number;
  publishedVersionId: number | null;
  addedRulesCount: number;
  removedRulesCount: number;
  modifiedRulesCount: number;
  addedRules: PolicyRuleDiffDto[];
  removedRules: PolicyRuleDiffDto[];
  modifiedRules: Array<{ draft: PolicyRuleDiffDto; published: PolicyRuleDiffDto }>;
  warnings: string[];
}
