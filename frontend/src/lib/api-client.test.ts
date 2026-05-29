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
});
