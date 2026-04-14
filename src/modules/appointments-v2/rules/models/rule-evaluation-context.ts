/**
 * Appointments V2 — Rule evaluation context.
 *
 * Bundles all the data the pure decision engine needs to evaluate
 * a booking candidate. This is the only input shape the evaluator
 * accepts, keeping it side-effect-free and easily testable.
 */

import type { CaseCategory, ReasonCode } from "../../shared/types/common.js";
import type {
  ModalityBlockedRuleRow,
  ExamTypeRuleRow,
  CategoryDailyLimitRow,
  ExamTypeSpecialQuotaRow,
} from "../models/rule-types.js";

/**
 * All rule data loaded from DB for a specific policy version,
 * plus the current booking counts needed for capacity checks.
 */
export interface RuleEvaluationContext {
  /** The policy version being evaluated against */
  policyVersionId: number;
  policySetKey: string;
  policyVersionNo: number;
  policyConfigHash: string;

  /** Does the requested modality exist? */
  modalityExists: boolean;

  /** If examTypeId was provided, does it exist and belong to the modality? */
  examTypeExists: boolean;
  examTypeBelongsToModality: boolean;

  /** Blocked rules for this modality */
  blockedRules: ModalityBlockedRuleRow[];

  /** Exam-type restriction rules for this modality */
  examTypeRules: ExamTypeRuleRow[];

  /** Exam type IDs that belong to the exam_type_rules (for matching) */
  examTypeRuleItemExamTypeIds: number[];

  /** Daily capacity limits for this modality */
  categoryLimits: CategoryDailyLimitRow[];

  /** Special quotas for exam types */
  specialQuotas: ExamTypeSpecialQuotaRow[];

  /** Current booked count for this bucket (standard capacity) */
  currentBookedCount: number;

  /**
   * Current special quota booked count for this date/exam type.
   * Only non-zero when examTypeId is provided and special quota rules apply.
   */
  currentSpecialQuotaBookedCount: number;

  /**
   * Any reason codes accumulated by earlier stages.
   * Integrity failures are appended here before evaluation continues.
   */
  existingReasons?: ReasonCode[];
}

/**
 * The pure input to the decision evaluator.
 */
export interface PureEvaluateInput {
  patientId: number;
  modalityId: number;
  examTypeId: number | null;
  scheduledDate: string; // ISO yyyy-mm-dd
  caseCategory: CaseCategory;
  useSpecialQuota: boolean;
  specialReasonCode: string | null;
  includeOverrideEvaluation: boolean;
  context: RuleEvaluationContext;
}
