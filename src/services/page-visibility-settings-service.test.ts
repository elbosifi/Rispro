import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  canRoleAccessPage,
  normalizePageVisibilityMatrix,
  sanitizePageVisibilityForNavigation
} from "./page-visibility-settings-service.js";

describe("page visibility settings service", () => {
  it("falls back to defaults for malformed input", () => {
    const result = normalizePageVisibilityMatrix("bad-input");
    assert.deepEqual(result, DEFAULT_PAGE_VISIBILITY_MATRIX);
  });

  it("filters unknown roles and keeps super_admin access to settings", () => {
    const result = normalizePageVisibilityMatrix({
      settings: ["receptionist", "unknown_role"],
      queue: ["receptionist", "modality_staff", "doctor", "bad"],
    });

    assert.equal(result.settings.includes("super_admin"), true);
    assert.deepEqual(result.queue, ["receptionist", "modality_staff", "doctor"]);
  });

  it("sanitizes navigation matrix safely", () => {
    const result = sanitizePageVisibilityForNavigation({
      dashboard: ["doctor"],
      settings: [],
      ignored_route: ["super_admin"],
    });

    assert.deepEqual(result.dashboard, ["doctor"]);
    assert.equal(result.settings.includes("super_admin"), true);
    assert.equal((result as Record<string, unknown>).ignored_route, undefined);
  });

  it("checks page access from the sanitized matrix and protects super_admin settings", () => {
    const matrix = normalizePageVisibilityMatrix({
      patients: ["doctor"],
      settings: [],
    });

    assert.equal(canRoleAccessPage("patients", "doctor", matrix), true);
    assert.equal(canRoleAccessPage("patients", "modality_staff", matrix), false);
    assert.equal(canRoleAccessPage("settings", "super_admin", matrix), true);
  });
});
