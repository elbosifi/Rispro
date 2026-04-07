/**
 * Simple debounce utility to limit how often a function can be called.
 */

export function debounce<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => TResult,
  delayMs: number
): (...args: TArgs) => void {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  return (...args: TArgs) => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      fn(...args);
      timerId = null;
    }, delayMs);
  };
}

/**
 * Debounced value hook for React - returns a debounced value that updates after delay.
 * This is a simplified version that can be used with React state.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  // This is a placeholder - actual implementation would use useState and useEffect
  // For now, we'll use debounce at the handler level instead
  return value;
}
