import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET ||= "appointment-slip-render-token-test";

const { env } = await import("../config/env.js");
const {
  APPOINTMENT_SLIP_RENDER_TOKEN_PURPOSE,
  issueAppointmentSlipRenderToken,
  verifyAppointmentSlipRenderToken,
} = await import("./appointment-slip-render-token-service.js");

test("appointment-slip render tokens are purpose-bound to one appointment", () => {
  assert.deepEqual(verifyAppointmentSlipRenderToken(issueAppointmentSlipRenderToken(42)), { appointmentId: 42 });
});

test("appointment-slip render tokens reject expiry, tampering, and the wrong purpose", () => {
  const expired = jwt.sign({ purpose: APPOINTMENT_SLIP_RENDER_TOKEN_PURPOSE, appointmentId: 42 }, env.jwtSecret, { algorithm: "HS256", expiresIn: -1 });
  const wrongPurpose = jwt.sign({ purpose: "patient-qr", appointmentId: 42 }, env.jwtSecret, { algorithm: "HS256", expiresIn: "1m" });
  for (const value of [expired, `${issueAppointmentSlipRenderToken(42)}x`, wrongPurpose]) {
    assert.throws(() => verifyAppointmentSlipRenderToken(value), /render token is invalid or expired/);
  }
});
