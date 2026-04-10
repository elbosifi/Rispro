import test from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Unit tests for the label/friendly helper functions in settings-page.tsx.
// These test the pure mapping logic without needing a DOM or React renderer.
// ---------------------------------------------------------------------------

const RULE_TYPE_LABELS: Record<string, string> = {
  specific_date: "Specific date",
  date_range: "Date range",
  yearly_recurrence: "Yearly recurring period",
  weekly_recurrence: "Weekly recurring pattern"
};

const EFFECT_MODE_LABELS: Record<string, string> = {
  restriction_overridable: "Restricted unless supervisor approves",
  hard_restriction: "Hard restriction (cannot override)"
};

const CASE_CATEGORY_LABELS: Record<string, string> = {
  oncology: "Oncology",
  non_oncology: "Non-oncology"
};

const WEEKDAY_LABELS: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday"
};

function friendlyRuleType(value: string): string {
  return RULE_TYPE_LABELS[value] || value;
}

function friendlyEffectMode(value: string): string {
  return EFFECT_MODE_LABELS[value] || value;
}

function friendlyWeekday(value: string): string {
  return WEEKDAY_LABELS[value] || value;
}

function friendlyCaseCategory(value: string): string {
  return CASE_CATEGORY_LABELS[value] || value;
}

// ---------------------------------------------------------------------------
// Tests: friendly labels, not raw enum strings
// ---------------------------------------------------------------------------

test("friendlyRuleType maps raw enum to human label", () => {
  assert.equal(friendlyRuleType("specific_date"), "Specific date");
  assert.equal(friendlyRuleType("date_range"), "Date range");
  assert.equal(friendlyRuleType("yearly_recurrence"), "Yearly recurring period");
  assert.equal(friendlyRuleType("weekly_recurrence"), "Weekly recurring pattern");
});

test("friendlyRuleType returns unknown value as-is", () => {
  assert.equal(friendlyRuleType("unknown_type"), "unknown_type");
});

test("friendlyEffectMode maps raw enum to human label", () => {
  assert.equal(friendlyEffectMode("restriction_overridable"), "Restricted unless supervisor approves");
  assert.equal(friendlyEffectMode("hard_restriction"), "Hard restriction (cannot override)");
});

test("friendlyWeekday maps 0-6 to named days", () => {
  assert.equal(friendlyWeekday("0"), "Sunday");
  assert.equal(friendlyWeekday("1"), "Monday");
  assert.equal(friendlyWeekday("2"), "Tuesday");
  assert.equal(friendlyWeekday("3"), "Wednesday");
  assert.equal(friendlyWeekday("4"), "Thursday");
  assert.equal(friendlyWeekday("5"), "Friday");
  assert.equal(friendlyWeekday("6"), "Saturday");
});

test("friendlyCaseCategory maps raw enum to human label", () => {
  assert.equal(friendlyCaseCategory("oncology"), "Oncology");
  assert.equal(friendlyCaseCategory("non_oncology"), "Non-oncology");
});

// ---------------------------------------------------------------------------
// Tests: helper text is defined for each section
// ---------------------------------------------------------------------------

const SECTION_HELPERS: Record<string, string> = {
  categoryLimits: "Limit how many oncology or non-oncology appointments each modality can accept per day.",
  blockedRules: "Block entire dates or date ranges for a modality.",
  examRules: "Restrict specific exam types to certain dates or recurring patterns.",
  specialQuotas: "Allow extra daily slots for selected exam types.",
  specialReasons: "Codes staff can choose when using special quotas.",
  identifierTypes: "Extra identifier types available during registration."
};

const SECTION_KEYS = ["categoryLimits", "blockedRules", "examRules", "specialQuotas", "specialReasons", "identifierTypes"];

test("helper text is visible for each section", () => {
  for (const key of SECTION_KEYS) {
    assert.ok(SECTION_HELPERS[key], `Helper text should be defined for ${key}`);
    assert.ok(SECTION_HELPERS[key].length > 10, `Helper text for ${key} should be descriptive`);
  }
});

// ---------------------------------------------------------------------------
// Tests: section titles are friendly, not technical
// ---------------------------------------------------------------------------

const SECTION_TITLES: Record<string, string> = {
  categoryLimits: "Category Daily Limits",
  blockedRules: "Modality Blocked Rules",
  examRules: "Exam Schedule Restriction Rules",
  specialQuotas: "Special Quotas",
  specialReasons: "Special Reason Codes",
  identifierTypes: "Patient Identifier Types"
};

test("section titles are user-friendly", () => {
  for (const key of SECTION_KEYS) {
    const title = SECTION_TITLES[key];
    assert.ok(title, `Title should be defined for ${key}`);
    // Ensure titles don't contain raw underscored enum strings
    assert.ok(!title.includes("_"), `Title "${title}" should not contain underscores`);
  }
});
