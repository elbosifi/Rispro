export type UnsavedNavigationProceed = () => void;
export type UnsavedNavigationGuard = (proceed: UnsavedNavigationProceed) => void;

let activeGuard: UnsavedNavigationGuard | null = null;

export function registerUnsavedNavigationGuard(guard: UnsavedNavigationGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export function requestNavigationWithUnsavedGuard(proceed: UnsavedNavigationProceed): void {
  if (activeGuard) {
    activeGuard(proceed);
    return;
  }
  proceed();
}
