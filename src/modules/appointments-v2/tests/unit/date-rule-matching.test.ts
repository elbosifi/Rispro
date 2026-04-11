/**
 * Appointments V2 — Date rule matching unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  blockedRuleMatchesDate,
  examRuleMatchesDate,
} from "../../rules/utils/date-rule-matching.js";

describe("blockedRuleMatchesDate", () => {
  it("matches specific_date exactly", () => {
    const rule = {
      ruleType: "specific_date" as const,
      specificDate: "2026-01-01",
      startDate: null,
      endDate: null,
      recurStartMonth: null,
      recurStartDay: null,
      recurEndMonth: null,
      recurEndDay: null,
    };
    assert.ok(blockedRuleMatchesDate(rule, "2026-01-01"));
    assert.ok(!blockedRuleMatchesDate(rule, "2026-01-02"));
  });

  it("matches date_range inclusively", () => {
    const rule = {
      ruleType: "date_range" as const,
      specificDate: null,
      startDate: "2026-04-01",
      endDate: "2026-04-10",
      recurStartMonth: null,
      recurStartDay: null,
      recurEndMonth: null,
      recurEndDay: null,
    };
    assert.ok(blockedRuleMatchesDate(rule, "2026-04-01"));
    assert.ok(blockedRuleMatchesDate(rule, "2026-04-05"));
    assert.ok(blockedRuleMatchesDate(rule, "2026-04-10"));
    assert.ok(!blockedRuleMatchesDate(rule, "2026-03-31"));
    assert.ok(!blockedRuleMatchesDate(rule, "2026-04-11"));
  });

  it("returns false for date_range with missing dates", () => {
    const rule = {
      ruleType: "date_range" as const,
      specificDate: null,
      startDate: null,
      endDate: "2026-04-10",
      recurStartMonth: null,
      recurStartDay: null,
      recurEndMonth: null,
      recurEndDay: null,
    };
    assert.ok(!blockedRuleMatchesDate(rule, "2026-04-05"));
  });

  it("matches yearly_recurrence within same-month range", () => {
    const rule = {
      ruleType: "yearly_recurrence" as const,
      specificDate: null,
      startDate: null,
      endDate: null,
      recurStartMonth: 1,
      recurStartDay: 1,
      recurEndMonth: 1,
      recurEndDay: 31,
    };
    assert.ok(blockedRuleMatchesDate(rule, "2026-01-15"));
    assert.ok(!blockedRuleMatchesDate(rule, "2026-02-15"));
  });

  it("matches yearly_recurrence across year boundary", () => {
    const rule = {
      ruleType: "yearly_recurrence" as const,
      specificDate: null,
      startDate: null,
      endDate: null,
      recurStartMonth: 12,
      recurStartDay: 20,
      recurEndMonth: 1,
      recurEndDay: 10,
    };
    assert.ok(blockedRuleMatchesDate(rule, "2025-12-25"));
    assert.ok(blockedRuleMatchesDate(rule, "2026-01-05"));
    assert.ok(!blockedRuleMatchesDate(rule, "2026-02-01"));
  });

  it("returns false for yearly_recurrence with incomplete params", () => {
    const rule = {
      ruleType: "yearly_recurrence" as const,
      specificDate: null,
      startDate: null,
      endDate: null,
      recurStartMonth: 1,
      recurStartDay: null,
      recurEndMonth: 1,
      recurEndDay: 31,
    };
    assert.ok(!blockedRuleMatchesDate(rule, "2026-01-15"));
  });
});

describe("examRuleMatchesDate", () => {
  it("matches specific_date", () => {
    const rule = {
      ruleType: "specific_date" as const,
      specificDate: "2026-07-04",
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
    };
    assert.ok(examRuleMatchesDate(rule, "2026-07-04"));
    assert.ok(!examRuleMatchesDate(rule, "2026-07-05"));
  });

  it("matches date_range", () => {
    const rule = {
      ruleType: "date_range" as const,
      specificDate: null,
      startDate: "2026-12-01",
      endDate: "2026-12-31",
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
    };
    assert.ok(examRuleMatchesDate(rule, "2026-12-15"));
    assert.ok(!examRuleMatchesDate(rule, "2026-11-30"));
  });

  it("matches weekly_recurrence on correct weekday", () => {
    // 2026-04-13 is a Monday (getUTCDay() = 1)
    const rule = {
      ruleType: "weekly_recurrence" as const,
      specificDate: null,
      startDate: null,
      endDate: null,
      weekday: 1,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
    };
    assert.ok(examRuleMatchesDate(rule, "2026-04-13")); // Monday
    assert.ok(!examRuleMatchesDate(rule, "2026-04-14")); // Tuesday
  });

  it("matches alternate_weeks with correct parity", () => {
    // 2026-04-06 is a Monday. Anchor on same day.
    const rule = {
      ruleType: "weekly_recurrence" as const,
      specificDate: null,
      startDate: null,
      endDate: null,
      weekday: 1,
      alternateWeeks: true,
      recurrenceAnchorDate: "2026-04-06",
    };
    assert.ok(examRuleMatchesDate(rule, "2026-04-06")); // week 0
    assert.ok(!examRuleMatchesDate(rule, "2026-04-13")); // week 1
    assert.ok(examRuleMatchesDate(rule, "2026-04-20")); // week 2
  });

  it("returns false when weekday is null", () => {
    const rule = {
      ruleType: "weekly_recurrence" as const,
      specificDate: null,
      startDate: null,
      endDate: null,
      weekday: null,
      alternateWeeks: false,
      recurrenceAnchorDate: null,
    };
    assert.ok(!examRuleMatchesDate(rule, "2026-04-13"));
  });
});
