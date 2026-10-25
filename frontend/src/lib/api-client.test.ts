import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";

describe("api", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bypasses HTTP cache for API requests", async () => {
    await api("/doctor/reporting-board/cases?limit=50");

    expect(fetch).toHaveBeenCalledWith(
      "/api/doctor/reporting-board/cases?limit=50",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("propagates dictation cancellation to the request signal and removes the listener afterwards", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    vi.mocked(fetch).mockImplementationOnce(async (_url, options) => {
      expect(options?.signal?.aborted).toBe(false);
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      return new Response(JSON.stringify({ ok: true }));
    });
    await api("/medical-dictation/transcribe", { method: "POST", signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
