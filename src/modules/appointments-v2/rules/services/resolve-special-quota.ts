import type { Role } from "../../../../types/domain.js";
import type { SpecialQuotaRuleRow } from "../models/rule-types.js";

export interface SpecialQuotaCandidateInput {
  modalityId: number;
  examTypeId: number | null;
  requesterRole?: Role;
  requesterUserId?: number | null;
}

export interface SpecialQuotaMembershipInput {
  id: number;
  examTypeIds: number[];
  allowedUserIds: number[];
  isActive: boolean;
}

export interface SpecialQuotaMembershipConflict {
  firstRuleId: number;
  secondRuleId: number;
  examTypeId: number;
  userId: number;
}

/**
 * Two active pools are ambiguous only when the same stored user can select
 * both pools for the same exam. Implicit super-admin access is intentionally
 * not part of this configuration-level check.
 */
export function findSpecialQuotaMembershipConflicts(
  rules: SpecialQuotaMembershipInput[]
): SpecialQuotaMembershipConflict[] {
  const activeRules = rules.filter((rule) => rule.isActive);
  const conflicts: SpecialQuotaMembershipConflict[] = [];

  for (let firstIndex = 0; firstIndex < activeRules.length; firstIndex += 1) {
    const first = activeRules[firstIndex];
    const firstExamIds = new Set((first.examTypeIds ?? []).map(Number));
    const firstUserIds = new Set((first.allowedUserIds ?? []).map(Number));

    for (let secondIndex = firstIndex + 1; secondIndex < activeRules.length; secondIndex += 1) {
      const second = activeRules[secondIndex];
      const examTypeId = (second.examTypeIds ?? []).map(Number).find((id) => firstExamIds.has(id));
      if (examTypeId == null) continue;
      const userId = (second.allowedUserIds ?? []).map(Number).find((id) => firstUserIds.has(id));
      if (userId == null) continue;

      conflicts.push({
        firstRuleId: Number(first.id),
        secondRuleId: Number(second.id),
        examTypeId,
        userId,
      });
    }
  }

  return conflicts;
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
