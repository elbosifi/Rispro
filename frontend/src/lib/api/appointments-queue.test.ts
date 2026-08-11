import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  addWalkIn,
  confirmNoShow,
  fetchAppointmentLookups,
  fetchNoShowReviewSnapshot,
  fetchQueueSnapshot,
  scanIntoQueue,
  updateAppointmentStatus,
} from "./appointments-queue";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("appointments and queue API contracts", () => {
  beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ items: [], candidates: [] }));

  it("preserves lookup fan-out and queue read routes", async () => {
    await fetchAppointmentLookups();
    await fetchQueueSnapshot();
    await fetchNoShowReviewSnapshot();

    expect(api).toHaveBeenNthCalledWith(1, "/v2/lookups/modalities");
    expect(api).toHaveBeenNthCalledWith(2, "/v2/lookups/priorities");
    expect(api).toHaveBeenNthCalledWith(3, "/v2/lookups/special-reason-codes");
    expect(api).toHaveBeenNthCalledWith(4, "/v2/read/queue");
    expect(api).toHaveBeenNthCalledWith(5, "/v2/read/queue/no-shows");
  });

  it("preserves scan, walk-in, no-show, and status payloads", async () => {
    await scanIntoQueue("RIS-123");
    await addWalkIn({ patientId: 4 });
    await confirmNoShow(7, "did not attend");
    await updateAppointmentStatus(7, "arrived", null);

    expect(api).toHaveBeenNthCalledWith(1, "/v2/read/queue/scan", { method: "POST", body: JSON.stringify({ scanValue: "RIS-123" }) });
    expect(api).toHaveBeenNthCalledWith(2, "/v2/read/queue/walk-in", { method: "POST", body: JSON.stringify({ patientId: 4 }) });
    expect(api).toHaveBeenNthCalledWith(3, "/v2/read/appointments/7/no-show", { method: "POST", body: JSON.stringify({ reason: "did not attend" }) });
    expect(api).toHaveBeenNthCalledWith(4, "/v2/read/appointments/7/status", { method: "POST", body: JSON.stringify({ status: "arrived", reason: null }) });
  });
});
