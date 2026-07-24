import { createHmac, timingSafeEqual } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { pool } from "../db/pool.js";
import { getPublicCancelTokenSecret } from "../modules/appointments-v2/public/utils/public-cancel-config.js";
import { HttpError } from "../utils/http-error.js";

const OPAQUE_PREFIX = "pa_";
const COMPACT_VERSION = "v2";
const COMPACT_SIGNATURE_LENGTH = 22;
const ACTION = "cancel";

export type RequestScanAppointmentTokenResult = {
  bookingId: number;
  tokenType: "opaque" | "compact" | "jwt";
};

function invalid(code = "qr_token_invalid"): never {
  throw new HttpError(401, "Invalid Request Scan appointment token.", { code });
}

function bookingId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) invalid();
  return parsed;
}

async function requireBooking(id: number): Promise<void> {
  const result = await pool.query("select 1 from appointments_v2.bookings where id=$1", [id]);
  if (!result.rowCount) invalid("qr_booking_not_found");
}

export async function resolveRequestScanAppointmentToken(token: string): Promise<RequestScanAppointmentTokenResult> {
  const value = String(token || "").trim();
  if (!value) invalid();
  if (value.startsWith(OPAQUE_PREFIX)) {
    const result = await pool.query<{ booking_id: number; revoked_at: string | null }>(
      "select booking_id,revoked_at::text from appointments_v2.public_appointment_tokens where token=$1 limit 1",
      [value],
    );
    const row = result.rows[0];
    if (!row) invalid();
    if (row.revoked_at) invalid("qr_token_revoked");
    const id = bookingId(row.booking_id);
    await requireBooking(id);
    return { bookingId: id, tokenType: "opaque" };
  }

  const secret = getPublicCancelTokenSecret();
  if (!secret) throw new HttpError(503, "Request Scan appointment token verification is unavailable.");
  if (value.startsWith(`${COMPACT_VERSION}.`)) {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== COMPACT_VERSION) invalid();
    const id = bookingId(Number.parseInt(parts[1]!, 36));
    if (!Number.isFinite(Number.parseInt(parts[2]!, 36))) invalid();
    const body = `${COMPACT_VERSION}.${parts[1]}.${parts[2]}`;
    const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url").slice(0, COMPACT_SIGNATURE_LENGTH));
    const supplied = Buffer.from(parts[3] || "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) invalid();
    await requireBooking(id);
    return { bookingId: id, tokenType: "compact" };
  }

  try {
    const decoded = jwt.verify(value, secret, { algorithms: ["HS256"], ignoreExpiration: true });
    if (!decoded || typeof decoded === "string") invalid();
    const payload = decoded as JwtPayload & { bookingId?: unknown; action?: unknown };
    if (payload.action !== ACTION) invalid();
    const id = bookingId(payload.bookingId);
    await requireBooking(id);
    return { bookingId: id, tokenType: "jwt" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    invalid();
  }
}
