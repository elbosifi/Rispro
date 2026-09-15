import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import { fetchIrReferrals } from "./ir-referrals";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("IR referral list API contract", () => {
  beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ referrals: [] }));

  it("encodes status and search filters as query parameters", async () => {
    await fetchIrReferrals({ status: "ready_for_review", q: "MRN-123 / Smith" });

    expect(api).toHaveBeenCalledWith("/ir-referrals?status=ready_for_review&q=MRN-123+%2F+Smith");
  });
});
