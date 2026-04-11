/**
 * Appointments V2 — Shadow mode diff logger.
 *
 * D010: Shadow mode is required before booking cutover.
 *
 * This module provides structured diff logging between legacy scheduling
 * outcomes and V2 decision engine outcomes. It does NOT change user-visible
 * behavior — it only logs diffs for observability and validation.
 *
 * The shadow mode is gated behind a settings flag so it can be enabled
 * in production without affecting users.
 */

import type { BookingDecision } from "../rules/models/booking-decision.js";

export type ShadowOutcome = "match" | "mismatch" | "v2_stricter" | "v2_looser";

export interface ShadowDiffEntry {
  /** ISO timestamp of the comparison */
  evaluatedAt: string;
  /** The date being compared */
  date: string;
  /** Modality ID */
  modalityId: number;
  /** Exam type ID (if applicable) */
  examTypeId: number | null;
  /** Case category */
  caseCategory: "oncology" | "non_oncology";
  /** Legacy outcome (e.g., is_bookable from legacy engine) */
  legacyOutcome: {
    isBookable: boolean;
    displayStatus?: string;
    blockedReasons?: string[];
  };
  /** V2 decision */
  v2Decision: BookingDecision;
  /** Whether the outcomes match */
  outcome: ShadowOutcome;
  /** Details of what differed (only set if mismatch) */
  diffDetails?: {
    legacyStatus: string;
    v2Status: string;
    legacyAllowed: boolean;
    v2Allowed: boolean;
  };
}

/**
 * Compare a legacy scheduling outcome with a V2 decision.
 * Returns a structured diff entry.
 */
export function compareLegacyVsV2(
  date: string,
  modalityId: number,
  examTypeId: number | null,
  caseCategory: "oncology" | "non_oncology",
  legacyOutcome: {
    isBookable: boolean;
    displayStatus?: string;
    blockedReasons?: string[];
  },
  v2Decision: BookingDecision
): ShadowDiffEntry {
  const legacyStatus = legacyOutcome.displayStatus ?? (legacyOutcome.isBookable ? "available" : "blocked");
  const legacyAllowed = legacyOutcome.isBookable;
  const v2Allowed = v2Decision.displayStatus !== "blocked";

  let outcome: ShadowOutcome;
  if (legacyAllowed === v2Allowed) {
    outcome = "match";
  } else if (!v2Allowed && legacyAllowed) {
    // V2 blocks what legacy allowed — V2 is stricter
    outcome = "v2_stricter";
  } else {
    // V2 allows what legacy blocked — V2 is looser
    outcome = "v2_looser";
  }

  const entry: ShadowDiffEntry = {
    evaluatedAt: new Date().toISOString(),
    date,
    modalityId,
    examTypeId,
    caseCategory,
    legacyOutcome,
    v2Decision,
    outcome,
  };

  if (outcome !== "match") {
    entry.diffDetails = {
      legacyStatus,
      v2Status: v2Decision.displayStatus,
      legacyAllowed,
      v2Allowed,
    };
  }

  return entry;
}

/**
 * Summarize a batch of shadow diff entries.
 */
export function summarizeShadowDiffs(entries: ShadowDiffEntry[]): {
  total: number;
  matches: number;
  mismatches: number;
  v2Stricter: number;
  v2Looser: number;
  mismatchRate: number;
  entries: ShadowDiffEntry[];
} {
  const matches = entries.filter((e) => e.outcome === "match").length;
  const v2Stricter = entries.filter((e) => e.outcome === "v2_stricter").length;
  const v2Looser = entries.filter((e) => e.outcome === "v2_looser").length;
  const mismatches = v2Stricter + v2Looser;

  return {
    total: entries.length,
    matches,
    mismatches,
    v2Stricter,
    v2Looser,
    mismatchRate: entries.length > 0 ? mismatches / entries.length : 0,
    entries,
  };
}

/**
 * Log shadow diff entries to console (JSON lines format).
 * In production, this could write to a file, database, or observability system.
 */
export function logShadowDiffs(entries: ShadowDiffEntry[]): void {
  const summary = summarizeShadowDiffs(entries);

  // Log each mismatch as a JSON line for easy parsing
  for (const entry of entries) {
    if (entry.outcome !== "match") {
      console.log(
        JSON.stringify({
          type: "shadow_diff",
          ...entry,
        })
      );
    }
  }

  // Log summary
  console.log(
    JSON.stringify({
      type: "shadow_summary",
      total: summary.total,
      matches: summary.matches,
      mismatches: summary.mismatches,
      v2Stricter: summary.v2Stricter,
      v2Looser: summary.v2Looser,
      mismatchRate: summary.mismatchRate,
    })
  );
}
