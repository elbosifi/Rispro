import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QzConnectionManager } from "./qz-connection-manager";

const connectQzTray = vi.fn();
const isQzConnected = vi.fn();
const loadQzPrinterSettings = vi.fn();
const pushToast = vi.fn();

vi.mock("@/services/printing/qz-tray-service", () => ({
  connectQzTray: (...args: unknown[]) => connectQzTray(...args),
  isQzConnected: (...args: unknown[]) => isQzConnected(...args),
}));

vi.mock("@/services/printing/workstation-printer-settings", () => ({
  loadQzPrinterSettings: (...args: unknown[]) => loadQzPrinterSettings(...args),
}));

vi.mock("@/lib/toast", () => ({
  pushToast: (...args: unknown[]) => pushToast(...args),
}));

const settings = (printerName = "Label Queue", enabled = true) => ({
  profiles: [{ documentType: "ACCESSION_LABEL", printerName, enabled }],
});

describe("QzConnectionManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connectQzTray.mockReset().mockResolvedValue(undefined);
    isQzConnected.mockReset().mockReturnValue(false);
    loadQzPrinterSettings.mockReset().mockReturnValue(settings());
    pushToast.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not connect when disabled", async () => {
    render(<QzConnectionManager enabled={false} />);
    await act(() => Promise.resolve());
    expect(connectQzTray).not.toHaveBeenCalled();
  });

  it.each([
    ["empty queue", "", true],
    ["disabled profile", "Label Queue", false],
  ])("does not connect with an %s", async (_case, printerName, enabled) => {
    loadQzPrinterSettings.mockReturnValue(settings(printerName, enabled));
    render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    expect(connectQzTray).not.toHaveBeenCalled();
  });

  it("connects after login enables a configured profile", async () => {
    const view = render(<QzConnectionManager enabled={false} />);
    await act(() => Promise.resolve());
    view.rerender(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    expect(connectQzTray).toHaveBeenCalledTimes(1);
  });

  it("does not connect when QZ is already connected", async () => {
    isQzConnected.mockReturnValue(true);
    render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    expect(connectQzTray).not.toHaveBeenCalled();
  });

  it("retries a failed connection twice and then stops", async () => {
    connectQzTray.mockRejectedValue(new Error("QZ unavailable"));
    render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    expect(connectQzTray).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(connectQzTray).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(connectQzTray).toHaveBeenCalledTimes(3);
    await act(() => vi.runAllTimersAsync());
    expect(connectQzTray).toHaveBeenCalledTimes(3);
  });

  it("starts a connection cycle when printer settings change", async () => {
    loadQzPrinterSettings.mockReturnValue(settings(""));
    render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    loadQzPrinterSettings.mockReturnValue(settings());

    window.dispatchEvent(new CustomEvent("rispro-qz-settings-changed"));
    await act(() => Promise.resolve());
    expect(connectQzTray).toHaveBeenCalledTimes(1);
  });

  it("responds to focus and visible visibility changes", async () => {
    loadQzPrinterSettings.mockReturnValue(settings(""));
    render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    loadQzPrinterSettings.mockReturnValue(settings());

    window.dispatchEvent(new Event("focus"));
    await act(() => Promise.resolve());
    expect(connectQzTray).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(() => Promise.resolve());
    expect(connectQzTray).toHaveBeenCalledTimes(2);
  });

  it("cleans up timers and listeners on unmount", async () => {
    connectQzTray.mockRejectedValue(new Error("QZ unavailable"));
    const removeWindowListener = vi.spyOn(window, "removeEventListener");
    const removeDocumentListener = vi.spyOn(document, "removeEventListener");
    const view = render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith("focus", expect.any(Function));
    expect(removeWindowListener).toHaveBeenCalledWith("rispro-qz-settings-changed", expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("fails silently without dispatching a toast", async () => {
    connectQzTray.mockRejectedValue(new Error("QZ unavailable"));
    const view = render(<QzConnectionManager enabled />);
    await act(() => Promise.resolve());

    expect(pushToast).not.toHaveBeenCalled();
    view.unmount();
  });
});
