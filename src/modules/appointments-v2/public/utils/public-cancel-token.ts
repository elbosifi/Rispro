import jwt, { type JwtPayload } from "jsonwebtoken";
import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../../../../utils/http-error.js";
import {
  getPublicCancelTokenSecret,
  getPublicCancelTokenTtlSeconds,
} from "./public-cancel-config.js";

const PUBLIC_CANCEL_ACTION = "cancel" as const;
const COMPACT_TOKEN_VERSION = "v2";
const COMPACT_SIGNATURE_LENGTH = 22;

export interface PublicCancelTokenPayload {
  bookingId: number;
  action: typeof PUBLIC_CANCEL_ACTION;
  exp: number;
}

function parseBookingId(input: unknown): number | null {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function issuePublicCancelToken(
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
  const expiresInSeconds = options?.expiresInSeconds ?? getPublicCancelTokenTtlSeconds();
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(expiresInSeconds));

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

export function verifyPublicCancelToken(token: string): PublicCancelTokenPayload {
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
