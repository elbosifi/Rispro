import { describe, expect, it, vi } from "vitest";

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
  useCreateV2DayExamMixQuota,
  useCreateV2DayExamRestriction,
  useCreateV2DayModalityBlock,
  useRemoveV2DayManagementRule,
} from "./api";

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
