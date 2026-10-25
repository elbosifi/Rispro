import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAudioRecorder } from "./use-audio-recorder";

const instances: FakeRecorder[] = [];
const stopTrack = vi.fn();
class FakeRecorder {
  static isTypeSupported = vi.fn((type: string) => type === "audio/mp4");
  mimeType = "audio/mp4";
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { instances.push(this); }
  start() { this.state = "recording"; }
  stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["test audio"]) }); this.onstop?.(); }
}
beforeEach(() => {
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  stopTrack.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("detects Safari-compatible MP4 and releases microphone on stop", async () => {
  const { result } = renderHook(useAudioRecorder);
  await act(() => result.current.start());
  expect(result.current.phase).toBe("recording");
  act(() => result.current.stop());
  expect(result.current.phase).toBe("idle");
  expect(result.current.recording?.type).toBe("audio/mp4");
  expect(stopTrack).toHaveBeenCalled();
  act(() => result.current.clear());
  expect(result.current.recording).toBeNull();
});
it("stops automatically after 60 seconds", async () => {
  vi.useFakeTimers(); const { result } = renderHook(useAudioRecorder);
  await act(() => result.current.start());
  act(() => vi.advanceTimersByTime(60_000));
  expect(result.current.duration).toBe(60); expect(result.current.phase).toBe("idle"); expect(stopTrack).toHaveBeenCalled();
});
it("reports permission errors and unsupported browsers", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
  const { result } = renderHook(useAudioRecorder);
  await act(() => result.current.start()); expect(result.current.error).toBe("permission");
  vi.stubGlobal("MediaRecorder", undefined);
  await act(() => result.current.start()); expect(result.current.error).toBe("unsupported");
});
it.each(["permissionsPolicy", "featurePolicy"])("distinguishes a restrictive document %s from browser permission errors", async (property) => {
  const allowsFeature = vi.fn(() => false);
  Object.defineProperty(document, property, { configurable: true, value: { allowsFeature } });
  try {
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("Blocked", "NotAllowedError"));
    const { result, unmount } = renderHook(useAudioRecorder);
    await act(() => result.current.start());
    expect(result.current.error).toBe("policy"); expect(result.current.phase).toBe("idle");
    expect(allowsFeature).toHaveBeenCalledWith("microphone");
    allowsFeature.mockReturnValue(true);
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await act(() => result.current.start()); expect(result.current.error).toBe("permission");
    unmount();
  } finally { Reflect.deleteProperty(document, property); }
});
it("releases microphone on recording errors and unmount", async () => {
  const { result, unmount } = renderHook(useAudioRecorder);
  await act(() => result.current.start());
  act(() => instances.at(-1)!.onerror?.());
  expect(result.current.error).toBe("recording"); expect(result.current.recording).toBeNull(); expect(stopTrack).toHaveBeenCalled();
  await act(() => result.current.start()); stopTrack.mockClear(); unmount(); expect(stopTrack).toHaveBeenCalled();
});
it("releases a microphone granted after the page has closed", async () => {
  let grant!: (value: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((resolve) => { grant = resolve; }));
  const { result, unmount } = renderHook(useAudioRecorder);
  act(() => { void result.current.start(); }); unmount();
  grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
  await waitFor(() => expect(stopTrack).toHaveBeenCalled());
});
it("rejects empty and oversized recordings", async () => {
  const { result } = renderHook(useAudioRecorder);
  await act(() => result.current.start());
  act(() => instances.at(-1)!.onstop?.()); expect(result.current.error).toBe("empty");
  await act(() => result.current.start());
  act(() => instances.at(-1)!.ondataavailable?.({ data: new Blob([new Uint8Array(15 * 1024 * 1024 + 1)]) }));
  expect(result.current.error).toBe("oversized"); expect(result.current.recording).toBeNull(); expect(stopTrack).toHaveBeenCalled();
});
it("cancels a pending microphone request on early release without starting a recorder", async () => {
  let grant!: (value: MediaStream) => void;
  const previousInstances = instances.length;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValueOnce(new Promise((resolve) => { grant = resolve; }));
  const { result } = renderHook(useAudioRecorder);
  act(() => { void result.current.start(); }); expect(result.current.phase).toBe("requesting");
  act(() => result.current.stop()); expect(result.current.phase).toBe("idle");
  await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream));
  expect(instances).toHaveLength(previousInstances); expect(stopTrack).toHaveBeenCalled(); expect(result.current.recording).toBeNull();
  expect(result.current.notice).toContain("cancelled before");
  await act(() => result.current.start());
  expect(result.current.phase).toBe("recording");
  act(() => result.current.stop());
  expect(result.current.phase).toBe("idle"); expect(result.current.recording?.size).toBeGreaterThan(0);
});
it.each(["NotFoundError", "OverconstrainedError", "NotReadableError"])("falls back from an unavailable selected microphone (%s) to the workstation default", async (name) => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException("Unavailable", name));
  const { result, unmount } = renderHook(() => useAudioRecorder("speechmike-usb"));
  await act(() => result.current.start());
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(1, { audio: { deviceId: { exact: "speechmike-usb" } } });
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
  expect(result.current.phase).toBe("recording"); expect(result.current.notice).toContain("default microphone");
  unmount(); expect(stopTrack).toHaveBeenCalled();
});
