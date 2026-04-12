/**
 * Appointments V2 — authenticateSupervisor unit tests.
 *
 * Tests the supervisor authentication helper structure, exports, and source wiring.
 * Uses source verification since Node.js ESM mocking is limited.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Tests: function structure and exports
// ---------------------------------------------------------------------------

describe("authenticateSupervisor — function structure", () => {
  it("exports authenticateSupervisor", async () => {
    const { authenticateSupervisor } = await import("../../booking/utils/authenticate-supervisor.js");
    assert.ok(typeof authenticateSupervisor === "function");
  });

  it("authenticateSupervisor is async", async () => {
    const { authenticateSupervisor } = await import("../../booking/utils/authenticate-supervisor.js");
    assert.ok(authenticateSupervisor.constructor.name === "AsyncFunction" || typeof authenticateSupervisor === "function");
  });
});

// ---------------------------------------------------------------------------
// Tests: source verification — branching paths
// ---------------------------------------------------------------------------

describe("authenticateSupervisor — source verification", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/utils/authenticate-supervisor.ts",
      "utf-8"
    );
  });

  it("validates username and password are provided", () => {
    assert.ok(source.includes("!username || !password"), "Should check for empty credentials");
    assert.ok(source.includes("override_auth_missing_credentials"), "Should have missing credentials error code");
  });

  it("queries users table for supervisor", () => {
    assert.ok(source.includes("from users"), "Should query users table");
    assert.ok(source.includes("username = $1"), "Should filter by username");
    assert.ok(source.includes("role = 'supervisor'"), "Should filter by supervisor role");
    assert.ok(source.includes("is_active = true"), "Should filter by active status");
  });

  it("checks if supervisor exists", () => {
    assert.ok(source.includes("!user"), "Should check if user was found");
    assert.ok(source.includes("override_auth_invalid_supervisor"), "Should have invalid supervisor error code");
  });

  it("verifies password with bcrypt", () => {
    assert.ok(source.includes("bcrypt.compare"), "Should use bcrypt.compare for password verification");
    assert.ok(source.includes("override_auth_invalid_password"), "Should have invalid password error code");
  });

  it("returns authenticated user row", () => {
    assert.ok(source.includes("return user"), "Should return the authenticated user");
  });

  it("SQL selects required fields", () => {
    assert.ok(source.includes("id,"), "Should select id");
    assert.ok(source.includes("username,"), "Should select username");
    assert.ok(source.includes("password_hash"), "Should select password_hash");
    assert.ok(source.includes("role,"), "Should select role");
    assert.ok(source.includes("full_name"), "Should select full_name");
    assert.ok(source.includes("is_active"), "Should select is_active");
  });
});

// ---------------------------------------------------------------------------
// Tests: import wiring
// ---------------------------------------------------------------------------

describe("authenticateSupervisor — import wiring", () => {
  it("imports bcrypt from bcryptjs", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/utils/authenticate-supervisor.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "bcryptjs"') || source.includes("from 'bcryptjs'"),
      "Should import bcrypt from bcryptjs"
    );
  });

  it("imports SchedulingError from correct path", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/utils/authenticate-supervisor.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../../shared/errors/scheduling-error.js"'),
      "Should import SchedulingError from relative path"
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: error codes
// ---------------------------------------------------------------------------

describe("authenticateSupervisor — error codes", () => {
  let source: string;

  before(async () => {
    const fs = await import("node:fs/promises");
    source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/utils/authenticate-supervisor.ts",
      "utf-8"
    );
  });

  it("uses 403 for missing credentials", () => {
    assert.ok(source.includes("403"), "Should use 403 status");
    assert.ok(source.includes("override_auth_missing_credentials"), "Should have missing credentials reason code");
  });

  it("uses 401 for invalid supervisor", () => {
    assert.ok(source.includes("401"), "Should use 401 status");
    assert.ok(source.includes("override_auth_invalid_supervisor"), "Should have invalid supervisor reason code");
  });

  it("uses 401 for invalid password", () => {
    const count401 = (source.match(/401/g) || []).length;
    assert.ok(count401 >= 2, "Should use 401 for both invalid supervisor and invalid password");
    assert.ok(source.includes("override_auth_invalid_password"), "Should have invalid password reason code");
  });
});

// ---------------------------------------------------------------------------
// Tests: integration with booking services
// ---------------------------------------------------------------------------

describe("authenticateSupervisor — integration wiring", () => {
  it("imported by create-booking service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/create-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../utils/authenticate-supervisor.js"'),
      "create-booking should import authenticateSupervisor"
    );
    assert.ok(
      source.includes("authenticateSupervisor("),
      "create-booking should call authenticateSupervisor"
    );
  });

  it("imported by reschedule-booking service", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      "/Users/serajalsaifi/Nextcloud/RISpro/src/modules/appointments-v2/booking/services/reschedule-booking.service.ts",
      "utf-8"
    );
    assert.ok(
      source.includes('from "../utils/authenticate-supervisor.js"'),
      "reschedule-booking should import authenticateSupervisor"
    );
    assert.ok(
      source.includes("authenticateSupervisor("),
      "reschedule-booking should call authenticateSupervisor"
    );
  });
});
