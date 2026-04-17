import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();

vi.mock("@/lib/api-client", () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

describe("V2 lookup API normalization", () => {
  beforeEach(() => {
    apiMock.mockReset();
  });

  it("normalizes modality ids from string-backed lookup responses", async () => {
    apiMock.mockResolvedValueOnce({
      items: [
        {
          id: "211",
          name: "MRI",
          nameAr: "رنين",
          nameEn: "MRI",
          code: "MR",
          isActive: true,
          safetyWarningEn: null,
          safetyWarningAr: null,
          safetyWarningEnabled: false,
        },
      ],
    });

    const { fetchV2Modalities } = await import("../api");
    const result = await fetchV2Modalities();

    expect(result).toEqual([
      {
        id: 211,
        name: "MRI",
        nameAr: "رنين",
        nameEn: "MRI",
        code: "MR",
        isActive: true,
        safetyWarningEn: null,
        safetyWarningAr: null,
        safetyWarningEnabled: false,
      },
    ]);
  });

  it("normalizes exam type ids and modality ids from string-backed lookup responses", async () => {
    apiMock.mockResolvedValueOnce({
      modalityId: "211",
      items: [
        {
          id: "301",
          name: "Brain MRI",
          nameAr: "دماغ",
          nameEn: "Brain MRI",
          modalityId: "211",
          isActive: true,
        },
      ],
    });

    const { fetchV2ExamTypes } = await import("../api");
    const result = await fetchV2ExamTypes(211);

    expect(result).toEqual([
      {
        id: 301,
        name: "Brain MRI",
        nameAr: "دماغ",
        nameEn: "Brain MRI",
        modalityId: 211,
        isActive: true,
        code: "",
      },
    ]);
  });
});
