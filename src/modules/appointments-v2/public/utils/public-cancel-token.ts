import jwt, { type JwtPayload } from "jsonwebtoken";
import { HttpError } from "../../../../utils/http-error.js";
import {
  getPublicCancelTokenSecret,
  getPublicCancelTokenTtlSeconds,
} from "./public-cancel-config.js";

const PUBLIC_CANCEL_ACTION = "cancel" as const;

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

export function verifyPublicCancelToken(token: string): PublicCancelTokenPayload {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new HttpError(400, "Missing cancellation token.", { code: "missing_token" });
  }

  const secret = getPublicCancelTokenSecret();
  if (!secret) {
    throw new HttpError(503, "Public cancellation is unavailable.", { code: "public_cancel_not_configured" });
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
