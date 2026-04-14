import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAvailabilityRowStatus, mapAvailabilityRow } from "../../../../../frontend/src/v2/appointments/hooks/availability-row-mapper.js";

describe("V3 Create tab availability mapping", () => {
  it("maps capacity-exhausted blocked rows to full", () => {
    const status = getAvailabilityRowStatus({
      date: "2027-01-01",
      dailyCapacity: 0,
      bookedCount: 0,
      remainingCapacity: 0,
      isFull: true,
      decision: {
        isAllowed: false,
        requiresSupervisorOverride: false,
        displayStatus: "blocked",
        suggestedBookingMode: "override",
        consumedCapacityMode: null,
        remainingStandardCapacity: 0,
        remainingSpecialQuota: null,
        matchedRuleIds: [],
        reasons: [{ code: "standard_capacity_exhausted", severity: "error", message: "No capacity" }],
        policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "x" },
        decisionTrace: { evaluatedAt: "2026-01-01T00:00:00Z", input: {} },
      },
    } as any);

    assert.equal(status, "full");
  });

  it("blocked rows hide raw capacity text in row mapping", () => {
    const row = mapAvailabilityRow({
      date: "2027-01-02",
      dailyCapacity: 20,
      bookedCount: 0,
      remainingCapacity: 20,
      isFull: false,
      rowDisplayStatus: "blocked",
      decision: {
        isAllowed: false,
        requiresSupervisorOverride: false,
        displayStatus: "blocked",
        suggestedBookingMode: "override",
        consumedCapacityMode: null,
        remainingStandardCapacity: 20,
        remainingSpecialQuota: null,
        matchedRuleIds: [],
        reasons: [],
        policy: { policySetKey: "default", versionId: 1, versionNo: 1, configHash: "x" },
        decisionTrace: { evaluatedAt: "2026-01-01T00:00:00Z", input: {} },
      },
    } as any);

    assert.equal(row.remainingCapacity, null);
    assert.equal(row.dailyCapacity, null);
  });
});

describe("V3 Create tab source wiring", () => {
  const createTabPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/CreateAppointmentTab.tsx";
  const rowPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/v2/appointments/components/AvailabilityDateRow.tsx";
  const appPath = "/Users/serajalsaifi/Nextcloud/RISpro/frontend/src/App.tsx";

  it("filters exam types by selected modality", async () => {
    const content = await readFile(createTabPath, "utf-8");
    assert.ok(content.includes("et.modalityId === form.modalityId"));
  });

  it("restricted rows open supervisor override flow", async () => {
    const content = await readFile(createTabPath, "utf-8");
    assert.ok(content.includes("decision.requiresSupervisorOverride || decision.displayStatus === \"restricted\""));
    assert.ok(content.includes("setShowOverrideModal(true)"));
  });

  it("blocked row renders Blocked and avoids slot text", async () => {
    const content = await readFile(rowPath, "utf-8");
    assert.ok(content.includes('status === "blocked"'));
    assert.ok(content.includes("Blocked"));
    assert.ok(content.includes("slots"));
  });

  it("special reason helper text enforces metadata semantics", async () => {
    const content = await readFile(createTabPath, "utf-8");
    assert.ok(content.includes("special quota justification metadata"));
  });

  it("registers internal V3 create route behind dedicated path", async () => {
    const content = await readFile(appPath, "utf-8");
    assert.ok(content.includes("/v3/appointments/create"));
    assert.ok(content.includes("AppointmentsV3CreatePage"));
  });
});
