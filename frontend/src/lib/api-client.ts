const API_TIMEOUT_MS = 15_000;

interface ActionPinChallenge {
  actionKey: string;
  requiresReason: boolean;
}

type ActionPinChallengeHandler = (challenge: ActionPinChallenge) => Promise<void>;

let actionPinChallengeHandler: ActionPinChallengeHandler | null = null;

interface ApiErrorDetails {
  message: string;
  status: number;
  details?: unknown;
  reasonCodes?: string[];
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  reasonCodes: string[];

  constructor(message: string, status: number, details?: unknown, reasonCodes: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.reasonCodes = reasonCodes;
  }

  static fromResponse(details: ApiErrorDetails): ApiError {
    return new ApiError(details.message, details.status, details.details, details.reasonCodes ?? []);
  }
}

interface ApiRequestOptions extends RequestInit {
  skipActionPinRetry?: boolean;
  actionPinRetried?: boolean;
}

export function setActionPinChallengeHandler(handler: ActionPinChallengeHandler | null) {
  actionPinChallengeHandler = handler;
}

export function isActionPinRequiredError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const details = error.details as Record<string, unknown> | undefined;
  return error.message === "action_pin_required" && typeof details?.actionKey === "string";
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const message = body?.error?.message || (typeof body?.error === "string" ? body.error : undefined) || body?.message || response.statusText;
    return ApiError.fromResponse({
      message,
      status: response.status,
      details: body?.error?.details ?? body?.details ?? body,
      reasonCodes: Array.isArray(body?.error?.reasonCodes) ? body.error.reasonCodes : []
    });
  } catch {
    return ApiError.fromResponse({
      message: response.statusText,
      status: response.status
    });
  }
}

export async function api<T>(
  path: string,
  options: ApiRequestOptions = {},
  timeoutMs = API_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
  const { skipActionPinRetry, actionPinRetried, ...fetchOptions } = options;

  try {
    const response = await fetch(`/api${path}`, {
      ...fetchOptions,
      credentials: "include",
      headers: isFormDataBody
        ? fetchOptions.headers
        : {
          "Content-Type": "application/json",
          ...fetchOptions.headers
        },
      signal: controller.signal
    });

    if (!response.ok) {
      const error = await parseErrorResponse(response);
      const details = error.details as Record<string, unknown> | undefined;
      if (
        !skipActionPinRetry &&
        !actionPinRetried &&
        actionPinChallengeHandler &&
        isActionPinRequiredError(error)
      ) {
        await actionPinChallengeHandler({
          actionKey: String(details?.actionKey),
          requiresReason: Boolean(details?.requiresReason)
        });
        return api<T>(path, { ...options, actionPinRetried: true }, timeoutMs);
      }
      throw error;
    }

    if (response.status === 204) {
      return undefined as unknown as T;
    }

    return response.json() as Promise<T>;
  } catch (error) {
    // Surface a clearer message when client-side timeout aborts a long request.
    if (error instanceof DOMException && error.name === "AbortError") {
      throw ApiError.fromResponse({
        message: `Request timed out after ${Math.round(timeoutMs / 1000)}s.`,
        status: 408
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
