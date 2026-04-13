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

export interface PolicyExamTypeSpecialQuotaDto {
  id: number;
  examTypeId: number;
  dailyExtraSlots: number;
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
  examTypeSpecialQuotas: PolicyExamTypeSpecialQuotaDto[];
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

export interface PolicyStatusDto {
  policySet: PolicySetDto | null;
  published: PolicyVersionDto | null;
  draft: PolicyVersionDto | null;
  publishedSnapshot: PolicySnapshotDto;
  draftSnapshot: PolicySnapshotDto;
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
