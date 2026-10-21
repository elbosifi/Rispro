import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import type { BookingResponse, CreateBookingRequest } from "./types";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as Array<{ onSuccess?: () => unknown }>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
  useMutation: vi.fn((options: { onSuccess?: () => unknown }) => {
    mocks.mutationOptions.push(options);
    return options;
  }),
}));

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

import {
  createV2Booking,
  useCreateV2DayExamMixQuota,
  useCreateV2DayExamRestriction,
  useCreateV2DayModalityBlock,
  useRemoveV2DayManagementRule,
} from "./api";

describe("createV2Booking response normalization", () => {
  it("normalizes string booking and patient IDs while preserving the response", async () => {
    const apiResponse = {
      booking: {
        id: "42",
        patientId: "9",
        modalityId: 3,
        examTypeId: 101,
        reportingPriorityId: null,
        bookingDate: "2026-01-01",
        bookingTime: null,
        caseCategory: "non_oncology",
        status: "scheduled",
        notes: null,
        policyVersionId: 4,
        capacityResolutionMode: "standard",
        usesSpecialQuota: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      decision: { isAllowed: true },
      wasOverride: false,
    };
    vi.mocked(api).mockResolvedValueOnce(apiResponse as unknown as BookingResponse);
    const input: CreateBookingRequest = {
      patientId: 9,
      modalityId: 3,
      examTypeId: 101,
      reportingPriorityId: null,
      bookingDate: "2026-01-01",
      bookingTime: null,
      caseCategory: "non_oncology",
      notes: null,
    };

    const result = await createV2Booking(input);

    expect(result).toEqual({
      ...apiResponse,
      booking: { ...apiResponse.booking, id: 42, patientId: 9 },
    });
    expect(api).toHaveBeenCalledWith("/v2/appointments", {
      method: "POST",
      body: JSON.stringify(input),
    });
  });

  it("rejects nonpositive and unsafe response identifiers", async () => {
    const input: CreateBookingRequest = {
      patientId: 9,
      modalityId: 3,
      examTypeId: 101,
      reportingPriorityId: null,
      bookingDate: "2026-01-01",
      bookingTime: null,
      caseCategory: "non_oncology",
      notes: null,
    };
    const invalidResponses = [
      { booking: { id: "0", patientId: "9" } },
      { booking: { id: "42", patientId: "9007199254740992" } },
    ];

    for (const response of invalidResponses) {
      vi.mocked(api).mockResolvedValueOnce(response as unknown as BookingResponse);
      await expect(createV2Booking(input)).rejects.toThrow(/invalid (booking|patient) ID/);
    }
  });
});

describe("Manage Day mutation invalidation", () => {
  it("awaits all authoritative invalidations for every Manage Day mutation hook", async () => {
    [
      useCreateV2DayModalityBlock,
      useCreateV2DayExamRestriction,
      useCreateV2DayExamMixQuota,
      useRemoveV2DayManagementRule,
    ].forEach((useDayMutation) => useDayMutation());

    expect(mocks.mutationOptions).toHaveLength(4);

    for (const options of mocks.mutationOptions) {
      const resolves = new Map<string, () => void>();
      mocks.invalidateQueries.mockImplementation(({ queryKey }: { queryKey: string[] }) => new Promise<void>((resolve) => {
        resolves.set(JSON.stringify(queryKey), resolve);
      }));

      let settled = false;
      const onSuccess = options.onSuccess;
      expect(onSuccess).toBeTypeOf("function");
      const success = Promise.resolve(onSuccess!()).then(() => { settled = true; });
      await Promise.resolve();

      expect(mocks.invalidateQueries).toHaveBeenCalledTimes(3);
      expect(mocks.invalidateQueries.mock.calls.map(([input]) => input.queryKey)).toEqual([
        ["v2-day-management-context"],
        ["v2-availability"],
        ["v2-policy-status"],
      ]);
      expect(settled).toBe(false);

      for (const resolve of resolves.values()) resolve();
      await expect(success).resolves.toBeUndefined();
      expect(settled).toBe(true);
      mocks.invalidateQueries.mockReset();
    }
  });
});
