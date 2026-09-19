export type UnsavedNavigationProceed = () => void;
export type UnsavedNavigationGuard = (proceed: UnsavedNavigationProceed) => void;

let activeGuard: UnsavedNavigationGuard | null = null;
let currentHistoryIndex: number | null = null;
let restoringHistory: { fromIndex: number; toIndex: number } | null = null;

function readHistoryIndex(state?: unknown): number | null {
  if (state === undefined) {
    if (typeof window === "undefined") return null;
    state = window.history.state;
  }
  if (!state || typeof state !== "object") return null;
  const index = (state as { idx?: unknown }).idx;
  return typeof index === "number" && Number.isInteger(index) ? index : null;
}

function clearActiveGuard(): void {
  activeGuard = null;
  currentHistoryIndex = null;
  restoringHistory = null;
}

function handleHistoryPopState(event: PopStateEvent): void {
  const nextHistoryIndex = readHistoryIndex(event.state);

  if (restoringHistory) {
    const pendingNavigation = restoringHistory;
    restoringHistory = null;
    currentHistoryIndex = nextHistoryIndex;

    if (
      activeGuard &&
      nextHistoryIndex === pendingNavigation.fromIndex
    ) {
      activeGuard(() =>
        proceedWithUnsavedNavigation(() => {
          window.history.go(
            pendingNavigation.toIndex - pendingNavigation.fromIndex,
          );
        }),
      );
    }
    return;
  }

  const fromHistoryIndex = currentHistoryIndex;
  if (
    !activeGuard ||
    fromHistoryIndex === null ||
    nextHistoryIndex === null ||
    nextHistoryIndex === fromHistoryIndex
  ) {
    currentHistoryIndex = nextHistoryIndex;
    return;
  }

  // This listener is installed when the module initializes, before
  // BrowserRouter mounts its own window listener. Capture this event first so
  // it never renders the destination before the existing dialog decides.
  event.stopImmediatePropagation();
  restoringHistory = {
    fromIndex: fromHistoryIndex,
    toIndex: nextHistoryIndex,
  };
  window.history.go(fromHistoryIndex - nextHistoryIndex);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", handleHistoryPopState, true);
}

export function registerUnsavedNavigationGuard(guard: UnsavedNavigationGuard): () => void {
  if (activeGuard) clearActiveGuard();
  activeGuard = guard;
  currentHistoryIndex = readHistoryIndex();

  return () => {
    if (activeGuard === guard) clearActiveGuard();
  };
}

export function proceedWithUnsavedNavigation(
  proceed: UnsavedNavigationProceed,
): void {
  clearActiveGuard();
  proceed();
}

export function requestNavigationWithUnsavedGuard(proceed: UnsavedNavigationProceed): void {
  if (activeGuard) {
    activeGuard(() => proceedWithUnsavedNavigation(proceed));
    return;
  }
  proceed();
}
