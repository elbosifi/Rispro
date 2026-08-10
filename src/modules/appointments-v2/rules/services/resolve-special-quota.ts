import type { Role } from "../../../../types/domain.js";
import type { SpecialQuotaRuleRow } from "../models/rule-types.js";

export interface SpecialQuotaCandidateInput {
  modalityId: number;
  examTypeId: number | null;
  requesterRole?: Role;
  requesterUserId?: number | null;
}

export function findApplicableSpecialQuotaRules(
  rules: SpecialQuotaRuleRow[],
  input: SpecialQuotaCandidateInput
): SpecialQuotaRuleRow[] {
  if (input.examTypeId == null) return [];
  const examTypeId = Number(input.examTypeId);
  const requesterUserId = input.requesterUserId == null ? null : Number(input.requesterUserId);

  return rules.filter((rule) => {
    if (!rule.isActive || Number(rule.modalityId) !== Number(input.modalityId)) return false;
    if (!(rule.examTypeIds ?? []).map(Number).includes(examTypeId)) return false;
    if (input.requesterRole === "super_admin") return true;
    return requesterUserId != null && (rule.allowedUserIds ?? []).map(Number).includes(requesterUserId);
  });
}
