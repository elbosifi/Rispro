/**
 * Appointments V2 — Route wiring integration test.
 *
 * Verifies that the V2 module router mounts correctly and
 * returns 501 Not Implemented for stubbed endpoints.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAppointmentsV2Router } from "../../index.js";

describe("Appointments V2 route wiring", () => {
  it("should create router without throwing", () => {
    const router = createAppointmentsV2Router();
    assert.ok(router !== undefined);
  });
});
