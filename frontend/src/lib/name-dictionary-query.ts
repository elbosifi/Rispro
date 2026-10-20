import { ApiError } from "./api-client";

export function retryDictionaryRead(failureCount: number, error: unknown): boolean {
  return failureCount < 2 && (error instanceof TypeError ||
    (error instanceof ApiError && (error.status === 408 || error.status === 429 || error.status >= 500)));
}

export const dictionaryReadOptions = {
  retry: retryDictionaryRead,
  retryDelay: (attempt: number) => Math.min(1_000 * 2 ** attempt, 4_000),
  refetchOnReconnect: true,
};
