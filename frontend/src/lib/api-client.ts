const API_TIMEOUT_MS = 15_000;

interface ApiErrorDetails {
  message: string;
  status: number;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  static fromResponse(details: ApiErrorDetails): ApiError {
    return new ApiError(details.message, details.status, details.details);
  }
}

async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const message = body?.error?.message || body?.message || response.statusText;
    return ApiError.fromResponse({
      message,
      status: response.status,
      details: body?.error?.details ?? body?.details
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

  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "include",
      headers: {
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
  } finally {
    clearTimeout(timeout);
  }
}
