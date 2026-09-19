import { afterEach, describe, expect, it, vi } from "vitest";
import { registerUnsavedNavigationGuard } from "./unsaved-navigation-guard";

let unregister: (() => void) | undefined;

function setHistoryEntry(idx: number, path: string): void {
  window.history.replaceState({ idx, key: `test-${idx}` }, "", path);
}

afterEach(() => {
  unregister?.();
  unregister = undefined;
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("unsaved navigation guard", () => {
  it("blocks native Back, restores the current entry, and replays it after discard", () => {
    setHistoryEntry(0, "/sops");
    window.history.pushState({ idx: 1, key: "draft" }, "", "/sops/7?version=1.0");
    let proceed: (() => void) | undefined;
    const guard = vi.fn((next: () => void) => {
      proceed = next;
    });
    unregister = registerUnsavedNavigationGuard(guard);
    const historyGo = vi.spyOn(window.history, "go").mockImplementation((delta) => {
      if (delta === 1) {
        setHistoryEntry(1, "/sops/7?version=1.0");
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      } else if (delta === -1) {
        setHistoryEntry(0, "/sops");
      }
    });

    setHistoryEntry(0, "/sops");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

    expect(historyGo).toHaveBeenNthCalledWith(1, 1);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(proceed).toBeTypeOf("function");
    proceed?.();
    expect(historyGo).toHaveBeenNthCalledWith(2, -1);
    expect(historyGo).toHaveBeenCalledTimes(2);
  });

  it("blocks native Forward with the same pending navigation contract", () => {
    setHistoryEntry(1, "/sops/7?version=1.0");
    let proceed: (() => void) | undefined;
    unregister = registerUnsavedNavigationGuard((next) => {
      proceed = next;
    });
    window.history.pushState({ idx: 2, key: "forward" }, "", "/settings");
    const historyGo = vi.spyOn(window.history, "go").mockImplementation((delta) => {
      if (delta === -1) {
        setHistoryEntry(1, "/sops/7?version=1.0");
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      } else if (delta === 1) {
        setHistoryEntry(2, "/settings");
      }
    });

    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

    expect(historyGo).toHaveBeenNthCalledWith(1, -1);
    expect(proceed).toBeTypeOf("function");
    proceed?.();
    expect(historyGo).toHaveBeenNthCalledWith(2, 1);
    expect(historyGo).toHaveBeenCalledTimes(2);
  });

  it("does not leave a native history listener after cleanup", () => {
    setHistoryEntry(0, "/sops");
    window.history.pushState({ idx: 1, key: "draft" }, "", "/sops/7?version=1.0");
    const guard = vi.fn();
    unregister = registerUnsavedNavigationGuard(guard);
    const historyGo = vi.spyOn(window.history, "go");
    unregister();
    unregister = undefined;

    setHistoryEntry(0, "/sops");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));

    expect(guard).not.toHaveBeenCalled();
    expect(historyGo).not.toHaveBeenCalled();
  });
});
