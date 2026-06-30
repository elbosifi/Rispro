import jwt, { type JwtPayload } from "jsonwebtoken";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../../../../db/pool.js";
import { HttpError } from "../../../../utils/http-error.js";
import {
  getPublicCancelTokenSecret,
  getPublicCancelTokenTtlSeconds,
} from "./public-cancel-config.js";
import { readPatientQrSettings } from "./patient-qr-settings.js";

const PUBLIC_CANCEL_ACTION = "cancel" as const;
const COMPACT_TOKEN_VERSION = "v2";
const OPAQUE_TOKEN_PREFIX = "pa_";
const COMPACT_SIGNATURE_LENGTH = 22;

export interface PublicCancelTokenPayload {
  bookingId: number;
  action: typeof PUBLIC_CANCEL_ACTION;
  exp: number;
}

interface PublicAppointmentTokenRow {
  booking_id: number;
  token: string;
  revoked_at: string | null;
}

function parseBookingId(input: unknown): number | null {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function issueLegacyPublicCancelToken(
  bookingId: number,
  options?: {
    expiresInSeconds?: number;
    action?: string;
  }
): string | null {
  const secret = getPublicCancelTokenSecret();
  if (!secret) {
    return null;
  }

  const parsedBookingId = parseBookingId(bookingId);
  if (!parsedBookingId) {
    throw new HttpError(400, "Invalid booking ID.");
  }

  const action = options?.action ?? PUBLIC_CANCEL_ACTION;
  const expiresInSeconds =
    options?.expiresInSeconds == null
      ? getPublicCancelTokenTtlSeconds()
      : Math.floor(options.expiresInSeconds);
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;

  // Short token format for QR links: v2.<bookingIdBase36>.<expBase36>.<sig>
  if (action === PUBLIC_CANCEL_ACTION) {
    const bookingPart = parsedBookingId.toString(36);
    const expPart = exp.toString(36);
    const body = `${COMPACT_TOKEN_VERSION}.${bookingPart}.${expPart}`;
    const signature = createHmac("sha256", secret)
      .update(body)
      .digest("base64url")
      .slice(0, COMPACT_SIGNATURE_LENGTH);
    return `${body}.${signature}`;
  }

  return jwt.sign(
    {
      bookingId: parsedBookingId,
      action,
    },
    secret,
    {
      algorithm: "HS256",
      expiresIn: expiresInSeconds,
    }
  );
}

function mintOpaqueToken(): string {
  return `${OPAQUE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export async function issuePublicCancelToken(
  bookingId: number,
  options?: {
    expiresInSeconds?: number;
    action?: string;
  }
): Promise<string | null> {
  if (options) return issueLegacyPublicCancelToken(bookingId, options);

  const parsedBookingId = parseBookingId(bookingId);
  if (!parsedBookingId) {
    throw new HttpError(400, "Invalid booking ID.");
  }

  const existing = await pool.query<PublicAppointmentTokenRow>(
    `
      select booking_id, token, revoked_at
      from appointments_v2.public_appointment_tokens
      where booking_id = $1
      limit 1
    `,
    [parsedBookingId]
  );
  const row = existing.rows[0];
  if (row) return row.revoked_at ? null : row.token;

  const token = mintOpaqueToken();
  const inserted = await pool.query<PublicAppointmentTokenRow>(
    `
      insert into appointments_v2.public_appointment_tokens (booking_id, token)
      values ($1, $2)
      on conflict (booking_id) do update set updated_at = appointments_v2.public_appointment_tokens.updated_at
      returning booking_id, token, revoked_at
    `,
    [parsedBookingId, token]
  );
  const insertedRow = inserted.rows[0];
  return insertedRow?.revoked_at ? null : insertedRow?.token ?? null;
}

function verifyCompactToken(token: string, secret: string): PublicCancelTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== COMPACT_TOKEN_VERSION) {
    throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
  }

  const bookingId = Number.parseInt(parts[1], 36);
  const exp = Number.parseInt(parts[2], 36);
  const signature = parts[3] || "";
  const body = `${COMPACT_TOKEN_VERSION}.${parts[1]}.${parts[2]}`;

  if (!Number.isInteger(bookingId) || bookingId <= 0 || !Number.isFinite(exp)) {
    throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(body)
    .digest("base64url")
    .slice(0, COMPACT_SIGNATURE_LENGTH);
  const incoming = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
    throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
  }

  if (exp <= Math.floor(Date.now() / 1000)) {
    throw new HttpError(401, "Cancellation link has expired.", { code: "expired_link" });
  }

  return {
    bookingId,
    action: PUBLIC_CANCEL_ACTION,
    exp,
  };
}

function verifyLegacyPublicCancelToken(token: string): PublicCancelTokenPayload {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new HttpError(400, "Missing cancellation token.", { code: "missing_token" });
  }

  const secret = getPublicCancelTokenSecret();
  if (!secret) {
    throw new HttpError(503, "Public cancellation is unavailable.", { code: "public_cancel_not_configured" });
  }

  if (trimmedToken.startsWith(`${COMPACT_TOKEN_VERSION}.`)) {
    return verifyCompactToken(trimmedToken, secret);
  }

  try {
    const decoded = jwt.verify(trimmedToken, secret, {
      algorithms: ["HS256"],
    });

    if (!decoded || typeof decoded === "string") {
      throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
    }

    const payload = decoded as JwtPayload & {
      bookingId?: unknown;
      action?: unknown;
    };

    const bookingId = parseBookingId(payload.bookingId);
    const action = String(payload.action ?? "");
    const exp = Number(payload.exp ?? NaN);

    if (!bookingId || action !== PUBLIC_CANCEL_ACTION || !Number.isFinite(exp)) {
      throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
    }

    return {
      bookingId,
      action: PUBLIC_CANCEL_ACTION,
      exp,
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    const errorName = (error as { name?: string } | null)?.name ?? "";
    if (errorName === "TokenExpiredError") {
      throw new HttpError(401, "Cancellation link has expired.", { code: "expired_link" });
    }

    if (errorName === "JsonWebTokenError" || errorName === "NotBeforeError") {
      throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
    }

    throw error;
  }
}

async function verifyOpaquePublicAppointmentToken(token: string): Promise<PublicCancelTokenPayload> {
  const result = await pool.query<{
    booking_id: number;
    booking_date: string;
    revoked_at: string | null;
  }>(
    `
      select
        t.booking_id,
        b.booking_date::text as booking_date,
        t.revoked_at::text as revoked_at
      from appointments_v2.public_appointment_tokens t
      join appointments_v2.bookings b on b.id = t.booking_id
      where t.token = $1
      limit 1
    `,
    [token]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
  }
  if (row.revoked_at) {
    throw new HttpError(401, "Appointment link has been revoked.", { code: "revoked_link" });
  }

  await assertBookingWithinPublicLinkWindow(Number(row.booking_id), row.booking_date);

  return {
    bookingId: Number(row.booking_id),
    action: PUBLIC_CANCEL_ACTION,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
}

async function assertBookingWithinPublicLinkWindow(bookingId: number, bookingDate?: string): Promise<void> {
  const settings = await readPatientQrSettings();
  let effectiveBookingDate = bookingDate;
  if (!effectiveBookingDate) {
    const bookingResult = await pool.query<{ booking_date: string }>(
      `select booking_date::text as booking_date from appointments_v2.bookings where id = $1 limit 1`,
      [bookingId]
    );
    effectiveBookingDate = bookingResult.rows[0]?.booking_date;
  }
  if (!effectiveBookingDate) {
    throw new HttpError(401, "Invalid cancellation link.", { code: "invalid_link" });
  }

  const validityDays = settings.publicLinkValidityDays;
  const expiryResult = await pool.query<{ expired: boolean }>(
    `select (current_date > ($1::date + ($2::int * interval '1 day'))::date) as expired`,
    [effectiveBookingDate, validityDays]
  );
  if (expiryResult.rows[0]?.expired === true) {
    throw new HttpError(401, "Appointment link has expired.", { code: "expired_link" });
  }
}

export async function verifyPublicCancelToken(token: string): Promise<PublicCancelTokenPayload> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new HttpError(400, "Missing cancellation token.", { code: "missing_token" });
  }
  if (trimmedToken.startsWith(OPAQUE_TOKEN_PREFIX)) {
    return verifyOpaquePublicAppointmentToken(trimmedToken);
  }
  const payload = verifyLegacyPublicCancelToken(trimmedToken);
  await assertBookingWithinPublicLinkWindow(payload.bookingId);
  return payload;
}

export { issueLegacyPublicCancelToken };
