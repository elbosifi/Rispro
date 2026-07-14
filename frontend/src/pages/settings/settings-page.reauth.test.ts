import { describe, expect, it } from "vitest";
import { isReAuthRequiredError } from "./settings-page.helpers";
import { ApiError } from "@/lib/api-client";

describe("settings page re-auth detection", () => {
  it("detects backend re-auth prompts from errors", () => {
    expect(isReAuthRequiredError(new ApiError("Recent supervisor re-authentication is required.", 403))).toBe(true);
    expect(isReAuthRequiredError(new Error("403 Forbidden"))).toBe(true);
    expect(isReAuthRequiredError(new Error("Supervisor re-authentication required"))).toBe(true);
  });

  it("does not flag ordinary validation failures", () => {
    expect(isReAuthRequiredError(new Error("Failed to save role page visibility."))).toBe(false);
  });
});
