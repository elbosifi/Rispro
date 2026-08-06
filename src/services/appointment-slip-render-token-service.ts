import jwt, { type JwtPayload } from "jsonwebtoken";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http-error.js";

export const APPOINTMENT_SLIP_RENDER_TOKEN_PURPOSE = "appointment-slip-render";
const TOKEN_TTL_SECONDS = 90;

export interface AppointmentSlipRenderTokenPayload {
  appointmentId: number;
}

export function issueAppointmentSlipRenderToken(appointmentId: number): string {
  return jwt.sign(
    { purpose: APPOINTMENT_SLIP_RENDER_TOKEN_PURPOSE, appointmentId },
    env.jwtSecret,
    { algorithm: "HS256", expiresIn: TOKEN_TTL_SECONDS }
  );
}

export function verifyAppointmentSlipRenderToken(token: unknown): AppointmentSlipRenderTokenPayload {
  if (typeof token !== "string" || !token) throw new HttpError(401, "Appointment-slip render token is required.", { code: "APPOINTMENT_SLIP_RENDER_TOKEN_INVALID" });
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] });
    if (!decoded || typeof decoded === "string") throw new Error("invalid token");
    const payload = decoded as JwtPayload & { purpose?: unknown; appointmentId?: unknown };
    const appointmentId = Number(payload.appointmentId);
    if (payload.purpose !== APPOINTMENT_SLIP_RENDER_TOKEN_PURPOSE || !Number.isSafeInteger(appointmentId) || appointmentId <= 0) throw new Error("invalid token");
    return { appointmentId };
  } catch {
    throw new HttpError(401, "Appointment-slip render token is invalid or expired.", { code: "APPOINTMENT_SLIP_RENDER_TOKEN_INVALID" });
  }
}
