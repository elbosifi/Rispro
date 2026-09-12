import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

const page = readFileSync("src/pages/doctor/reporting-board-mobile-page.tsx", "utf8");
const viewer = readFileSync("src/pages/doctor/personal-reporting-viewer-actions.tsx", "utf8");

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
    assert.match(page, /state: \{ from: \{ pathname: location\.pathname, search: location\.search, hash: location\.hash \} \}/);
    assert.match(page, /enabled: Boolean\(token\) && Boolean\(user\) && browserPushSupported/);
  });

  it("reuses the passkey control and keeps personal claim and finalization actions gated", () => {
    assert.match(page, /PasskeySettingsButton/);
    assert.match(page, /selected\.canAssignToMe && ownDesk/);
    assert.match(page, /Claim case/);
    assert.match(page, /const canFinalizeOwnReports = Boolean\(user && data\.allowedActions\.authenticated && ownDesk && data\.allowedActions\.finalizeOwnReports\)/);
    assert.match(page, /appointmentFinalEligible = canFinalizeOwnReports && selected\?\.caseType === "appointment"/);
    assert.match(page, /selected\.assignmentStatus === "assigned" && selected\.assignedDoctorId === data\.currentDoctorId/);
    assert.match(page, /Mark final in RISpro/);
    assert.match(page, /markReportingBoardCaseManualFinal\(appointmentId, \{ reason \}\)/);
    assert.match(page, /This creates an audited RISpro manual-final override/);
    assert.match(page, /finalizeReason\.trim\(\)/);
    assert.match(page, /Finalize comparison report\?/);
    assert.match(page, /finalizeComparisonRequest/);
  });

  it("shows a tombstoned comparison warning without reopening RISpro finalization", () => {
    assert.match(page, /row\.caseType === "comparison" && row\.sonicDicomDocumentRemoved/);
    assert.match(page, /SonicDICOM comparison report removed/);
    assert.match(page, /comparisonFinal = canFinalizeOwnReports && selected\?\.caseType === "comparison" && selected\.appointmentStatus !== "finalized"/);
  });

  it("keeps Personal Desk APIs on Reporting Board facades instead of protocoling mutations", () => {
    const api = readFileSync("src/lib/api/doctor-portal-reporting.ts", "utf8");
    assert.match(api, /fetchReportingBoardPatientHistory[\s\S]*?\/doctor\/reporting-board\/cases\/\$\{appointmentId\}\/history/);
    assert.match(api, /createReportingBoardComplementaryRecall[\s\S]*?\/doctor\/reporting-board\/cases\/\$\{appointmentId\}\/complementary-recalls/);
    assert.match(api, /withdrawReportingBoardComplementaryRecall[\s\S]*?\/doctor\/reporting-board\/complementary-recalls/);
  });

  it("renders human-readable assignment ages and keeps category in the case summary", () => {
    assert.match(page, /\$\{hours\} h \$\{rest\} min/);
    assert.match(page, /\$\{days\} d \$\{remainingHours\} h/);
    assert.match(page, /aria-label="Case summary"/);
    assert.match(page, /caseCategoryLabel\(selected\.category\)/);
    assert.doesNotMatch(page, /Clinical Indication/);
    assert.match(viewer, /open-sonicdicom\?scope=study/);
    assert.match(viewer, /window\.open\("about:blank", "_blank"\)/);
    assert.match(page, /fetchOhifViewerAvailability/);
    assert.match(viewer, /launchReportingBoardCaseInOhif/);
  });
});
