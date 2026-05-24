const API_TIMEOUT_MS = 15_000;

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

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const message = body?.error?.message || body?.message || response.statusText;
    return ApiError.fromResponse({
      message,
      status: response.status,
      details: body?.error?.details ?? body?.details,
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
  options: RequestInit = {},
  timeoutMs = API_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;

  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "include",
      headers: isFormDataBody
        ? options.headers
        : {
          "Content-Type": "application/json",
          ...options.headers
        },
      signal: controller.signal
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
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
