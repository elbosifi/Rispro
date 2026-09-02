import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

const page = readFileSync("src/pages/doctor/reporting-board-mobile-page.tsx", "utf8");

describe("Personal Reporting Desk", () => {
  it("uses only the four personal workflow tabs and defaults to My Cases", () => {
    assert.match(page, /mobileQuickTab: "my_cases"/);
    assert.match(page, /"My Cases"/);
    assert.match(page, /"Available"/);
    assert.match(page, /"Urgent"/);
    assert.match(page, /"Overdue"/);
    assert.doesNotMatch(page, /Return to waiting pool|Reconcile assignment|Return to preparation|Finalized Doctor|Assignment Match/);
  });

  it("keeps anonymous notification handling non-mutating and returns sign-in to this token", () => {
    assert.match(page, /Sign in to enable notifications/);
    assert.match(page, /state: \{ from: `\$\{location\.pathname\}\$\{location\.search\}` \}/);
    assert.match(page, /enabled: Boolean\(token\) && Boolean\(user\) && pushSupported\(\)/);
  });

  it("reuses the passkey control and keeps personal claim actions gated", () => {
    assert.match(page, /PasskeySettingsButton/);
    assert.match(page, /selected\.canAssignToMe && ownDesk/);
    assert.match(page, /Claim case/);
    assert.match(page, /Finalize report\?/);
    assert.match(page, /Finalized manually by assigned doctor from Personal Reporting Desk/);
    assert.match(page, /Finalize comparison report\?/);
    assert.match(page, /finalizeComparisonRequest/);
  });

  it("keeps Personal Desk APIs on Reporting Board facades instead of protocoling mutations", () => {
    const api = readFileSync("src/lib/api/doctor-portal-reporting.ts", "utf8");
    assert.match(api, /fetchReportingBoardPatientHistory[\s\S]*?\/doctor\/reporting-board\/cases\/\$\{appointmentId\}\/history/);
    assert.match(api, /createReportingBoardComplementaryRecall[\s\S]*?\/doctor\/reporting-board\/cases\/\$\{appointmentId\}\/complementary-recalls/);
    assert.match(api, /withdrawReportingBoardComplementaryRecall[\s\S]*?\/doctor\/reporting-board\/complementary-recalls/);
  });

  it("renders human-readable assignment ages and keeps category in details", () => {
    assert.match(page, /\$\{hours\} h \$\{rest\} min/);
    assert.match(page, /\$\{days\} d \$\{remainingHours\} h/);
    assert.match(page, /<b>Category:<\/b>/);
    assert.doesNotMatch(page, /Clinical Indication/);
    assert.match(page, /open-sonicdicom\?scope=study/);
    assert.match(page, /"_blank", "noopener,noreferrer"/);
    assert.match(page, /fetchOhifViewerAvailability/);
    assert.match(page, /launchReportingBoardCaseInOhif/);
  });
});
