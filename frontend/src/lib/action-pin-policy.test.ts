import { describe, expect, it } from "vitest";
import { ACTION_PIN_ACTION_KEYS, ACTION_PIN_ACTION_LABELS, ACTION_PIN_GROUPS, normalizeActionPinPolicy } from "./action-pin-policy";

describe("Action PIN policy registry", () => {
  it("registers Manage Day policy changes with the high-risk admin defaults", () => {
    expect(ACTION_PIN_ACTION_KEYS).toContain("scheduling_day_policy_change");
    expect(ACTION_PIN_ACTION_LABELS.scheduling_day_policy_change).toBe("Manage day scheduling policy");
    expect(ACTION_PIN_GROUPS.find((group) => group.label === "High-risk admin workflows")?.actions).toContain("scheduling_day_policy_change");
    expect(normalizeActionPinPolicy({}).actionModes.scheduling_day_policy_change?.super_admin).toBe("required_every_time");
  });

  it("preserves an explicit Manage Day Action PIN override", () => {
    const policy = normalizeActionPinPolicy({ actionModes: { scheduling_day_policy_change: { super_admin: "not_required" } } });
    expect(policy.actionModes.scheduling_day_policy_change?.super_admin).toBe("not_required");
  });
});
