/**
 * Appointments V2 — Validate policy draft.
 *
 * Checks completeness and consistency of a draft before publishing.
 * D006/D007 compliance: ensures the draft is safe to publish.
 */

import type { PoolClient } from "pg";
import {
  findVersionById,
  loadAllRulesForVersion,
  type PolicyRuleRow,
} from "../../admin/repositories/admin-policy.repo.js";
import { pool } from "../../../../db/pool.js";

export interface PolicyValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a policy draft. Returns errors and warnings.
 * Called by the publish service before publishing (D007).
 */
export async function validatePolicyDraft(
  policyVersionId: number
): Promise<PolicyValidationResult> {
  const client = await pool.connect();
  try {
    return validatePolicyDraftInternal(client, policyVersionId);
  } finally {
    client.release();
  }
}

async function validatePolicyDraftInternal(
  client: PoolClient,
  policyVersionId: number
): Promise<PolicyValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Version must exist
  const version = await findVersionById(client, policyVersionId);
  if (!version) {
    return {
      isValid: false,
      errors: [`Policy version ${policyVersionId} does not exist.`],
      warnings: [],
    };
  }

  // 2. Must be a draft
  if (version.status !== "draft") {
    errors.push(`Version ${policyVersionId} is '${version.status}', not 'draft'.`);
    return { isValid: false, errors, warnings };
  }

  // 3. Config hash must be non-empty
  if (!version.configHash || version.configHash.length === 0) {
    errors.push("Policy draft has no configuration hash.");
  }

  // 4. Load all rules for this version
  const rules = await loadAllRulesForVersion(client, policyVersionId);

  // 5. Check for orphaned rules (rules pointing to non-existent modalities/exam types)
  // This is a warning because it might be intentional (e.g., preparing for a new modality)
  const ruleModalities = new Set(
    rules.filter((r: PolicyRuleRow) => r.modalityId != null).map((r: PolicyRuleRow) => r.modalityId)
  );
  if (ruleModalities.size === 0 && rules.length > 0) {
    warnings.push("No rules reference a modality. All rules may be orphaned.");
  }

  // 6. Check for category limits with zero daily limit
  const zeroLimits = rules.filter(
    (r: PolicyRuleRow) => r.ruleType === "category_daily_limit" && r.dailyLimit === 0
  );
  if (zeroLimits.length > 0) {
    warnings.push(
      `${zeroLimits.length} category daily limit rule(s) have daily_limit=0. This blocks all bookings for those categories.`
    );
  }

  // 7. Check for special quota rules with zero extra slots
  const zeroQuotas = rules.filter(
    (r: PolicyRuleRow) => r.ruleType === "special_quota" && r.dailyLimit === 0
  );
  if (zeroQuotas.length > 0) {
    warnings.push(
      `${zeroQuotas.length} special quota rule(s) have daily_extra_slots=0. These quotas have no effect.`
    );
  }

  // 8. Check that there's at least one active rule or an empty config is intentional
  if (rules.length === 0) {
    warnings.push(
      "Policy draft has no rules. This means no scheduling restrictions will apply."
    );
  }

  // 9. Category limits must be consistent with modality daily capacity.
  const activeCategoryRules = rules.filter(
    (r: PolicyRuleRow) => r.ruleType === "category_daily_limit" && r.isActive && r.modalityId != null
  );
  if (activeCategoryRules.length > 0) {
    const modalityIds = [...new Set(activeCategoryRules.map((r) => Number(r.modalityId)))];
    const capacities = await client.query<{ id: number; dailyCapacity: number | null }>(
      `
        select id, daily_capacity as "dailyCapacity"
        from modalities
        where id = any($1::bigint[])
      `,
      [modalityIds]
    );
    const capacityByModality = new Map<number, number | null>();
    for (const row of capacities.rows) {
      capacityByModality.set(Number(row.id), row.dailyCapacity == null ? null : Number(row.dailyCapacity));
    }

    for (const modalityId of modalityIds) {
      const modalityCapacity = capacityByModality.get(modalityId) ?? null;
      if (modalityCapacity == null || !Number.isFinite(modalityCapacity)) {
        errors.push(`Modality ${modalityId} has no valid daily capacity.`);
        continue;
      }

      const rows = activeCategoryRules.filter((r) => Number(r.modalityId) === modalityId);
      const oncology = rows.find((r) => r.caseCategory === "oncology");
      const nonOncology = rows.find((r) => r.caseCategory === "non_oncology");
      const configuredRows = [oncology, nonOncology].filter((row) => row != null);
      for (const configured of configuredRows) {
        if (Number(configured.dailyLimit ?? 0) > modalityCapacity) {
          errors.push(
            `Modality ${modalityId}: ${configured.caseCategory} daily limit cannot exceed daily capacity (${modalityCapacity}).`
          );
        }
      }
    }
  }

  const examMixRules = await client.query<{
    id: number;
    modalityId: number;
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string | null;
    dailyLimit: number;
    isActive: boolean;
    examTypeIds: number[];
  }>(
    `
      select
        emqr.id,
        emqr.modality_id as "modalityId",
        emqr.rule_type as "ruleType",
        emqr.specific_date::text as "specificDate",
        emqr.start_date::text as "startDate",
        emqr.end_date::text as "endDate",
        emqr.weekday,
        emqr.alternate_weeks as "alternateWeeks",
        emqr.recurrence_anchor_date::text as "recurrenceAnchorDate",
        emqr.daily_limit as "dailyLimit",
        emqr.is_active as "isActive",
        coalesce(array_agg(emqri.exam_type_id order by emqri.exam_type_id)
          filter (where emqri.exam_type_id is not null), '{}') as "examTypeIds"
      from appointments_v2.exam_mix_quota_rules emqr
      left join appointments_v2.exam_mix_quota_rule_items emqri
        on emqri.rule_id = emqr.id
      where emqr.policy_version_id = $1
      group by emqr.id
      order by emqr.id asc
    `,
    [policyVersionId]
  );

  const activeExamMix = examMixRules.rows.filter((row) => row.isActive);
  for (const row of activeExamMix) {
    if (!Number.isInteger(Number(row.dailyLimit)) || Number(row.dailyLimit) <= 0) {
      errors.push(`Exam mix rule ${row.id}: dailyLimit must be a positive integer.`);
    }
    if (!Array.isArray(row.examTypeIds) || row.examTypeIds.length === 0) {
      errors.push(`Exam mix rule ${row.id}: at least one exam type is required.`);
    }
    if (row.ruleType === "specific_date" && !row.specificDate) {
      errors.push(`Exam mix rule ${row.id}: specific_date requires specificDate.`);
    }
    if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
      errors.push(`Exam mix rule ${row.id}: date_range requires startDate and endDate.`);
    }
    if (row.ruleType === "weekly_recurrence" && row.weekday == null) {
      errors.push(`Exam mix rule ${row.id}: weekly_recurrence requires weekday.`);
    }
  }

  // Overlapping active groups are allowed, but we surface admin warnings.
  for (let i = 0; i < activeExamMix.length; i++) {
    for (let j = i + 1; j < activeExamMix.length; j++) {
      const a = activeExamMix[i];
      const b = activeExamMix[j];
      if (a.modalityId !== b.modalityId) continue;
      const sharedExamTypes = a.examTypeIds.filter((id) => b.examTypeIds.includes(id));
      if (sharedExamTypes.length === 0) continue;
      if (!examMixWindowsOverlap(a, b)) continue;
      warnings.push(
        `Exam mix overlap warning: rules ${a.id} and ${b.id} share exam types [${sharedExamTypes.join(", ")}] with overlapping active windows.`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function examMixWindowsOverlap(
  a: {
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
  },
  b: {
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    specificDate: string | null;
    startDate: string | null;
    endDate: string | null;
    weekday: number | null;
  }
): boolean {
  const toDate = (v: string | null) => (v ? new Date(`${v}T00:00:00Z`) : null);
  const weekdayOf = (v: string) => new Date(`${v}T00:00:00Z`).getUTCDay();

  if (a.ruleType === "specific_date" && b.ruleType === "specific_date") {
    return a.specificDate != null && a.specificDate === b.specificDate;
  }
  if (a.ruleType === "specific_date" && b.ruleType === "date_range") {
    return !!(a.specificDate && b.startDate && b.endDate && a.specificDate >= b.startDate && a.specificDate <= b.endDate);
  }
  if (a.ruleType === "date_range" && b.ruleType === "specific_date") {
    return examMixWindowsOverlap(b, a);
  }
  if (a.ruleType === "specific_date" && b.ruleType === "weekly_recurrence") {
    return !!(a.specificDate && b.weekday != null && weekdayOf(a.specificDate) === b.weekday);
  }
  if (a.ruleType === "weekly_recurrence" && b.ruleType === "specific_date") {
    return examMixWindowsOverlap(b, a);
  }
  if (a.ruleType === "date_range" && b.ruleType === "date_range") {
    return !!(a.startDate && a.endDate && b.startDate && b.endDate && a.startDate <= b.endDate && b.startDate <= a.endDate);
  }
  if (a.ruleType === "date_range" && b.ruleType === "weekly_recurrence") {
    if (!a.startDate || !a.endDate || b.weekday == null) return false;
    const start = toDate(a.startDate);
    const end = toDate(a.endDate);
    if (!start || !end) return false;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() === b.weekday) return true;
    }
    return false;
  }
  if (a.ruleType === "weekly_recurrence" && b.ruleType === "date_range") {
    return examMixWindowsOverlap(b, a);
  }
  if (a.ruleType === "weekly_recurrence" && b.ruleType === "weekly_recurrence") {
    return a.weekday != null && a.weekday === b.weekday;
  }
  return false;
}
