import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  createUser,
  deleteUser,
  fetchPageVisibilityMatrix,
  fetchSchedulingEngineConfig,
  fetchSettings,
  savePageVisibilityMatrix,
  saveSchedulingEngineConfig,
  saveSettings,
  updateUserPassword,
  updateUserSchedulingOverridePermission,
} from "./settings";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("settings API contracts", () => {
  beforeEach(() => vi.mocked(api).mockReset());

  it("preserves settings paths, methods, and payloads", async () => {
    vi.mocked(api).mockResolvedValueOnce({ settings: [] }).mockResolvedValue({ settings: {} });

    await fetchSettings("patient_registration");
    await saveSettings("patient_registration", { entries: [{ key: "mrn_prefix", value: "R" }] });

    expect(api).toHaveBeenNthCalledWith(1, "/settings/patient_registration");
    expect(api).toHaveBeenNthCalledWith(2, "/settings/patient_registration", {
      method: "PUT",
      body: JSON.stringify({ entries: [{ key: "mrn_prefix", value: "R" }] }),
    });
  });

  it("preserves page-visibility normalization and scheduling configuration contracts", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({ matrix: {} })
      .mockResolvedValueOnce({ matrix: {} })
      .mockResolvedValueOnce({ config: { categoryLimits: [] } })
      .mockResolvedValueOnce({ config: { categoryLimits: [] } });

    const matrix = await fetchPageVisibilityMatrix();
    await savePageVisibilityMatrix(matrix);
    await fetchSchedulingEngineConfig();
    await saveSchedulingEngineConfig({ categoryLimits: [] } as never);

    expect(api).toHaveBeenNthCalledWith(1, "/settings/users-and-roles/page-visibility");
    expect(api).toHaveBeenNthCalledWith(2, "/settings/users-and-roles/page-visibility", {
      method: "PUT",
      body: JSON.stringify({ matrix }),
    });
    expect(api).toHaveBeenNthCalledWith(3, "/settings/scheduling-engine-config");
    expect(api).toHaveBeenNthCalledWith(4, "/settings/scheduling-engine-config", {
      method: "PUT",
      body: JSON.stringify({ categoryLimits: [] }),
    });
  });

  it("preserves user administration routes and response mapping", async () => {
    vi.mocked(api).mockResolvedValue({ user: { id: 7, username: "doctor", full_name: "Doctor", role: "doctor" } });

    await createUser({ username: "doctor", fullName: "Doctor", password: "secret", role: "doctor" });
    await updateUserSchedulingOverridePermission(7, true);
    await updateUserPassword(7, "replacement");
    await deleteUser(7);

    expect(api).toHaveBeenNthCalledWith(1, "/users", {
      method: "POST",
      body: JSON.stringify({ username: "doctor", fullName: "Doctor", password: "secret", role: "doctor" }),
    });
    expect(api).toHaveBeenNthCalledWith(2, "/users/7/scheduling-override-permission", {
      method: "PUT",
      body: JSON.stringify({ canRequestSchedulingOverride: true }),
    });
    expect(api).toHaveBeenNthCalledWith(3, "/users/7/password", {
      method: "PUT",
      body: JSON.stringify({ password: "replacement" }),
    });
    expect(api).toHaveBeenNthCalledWith(4, "/users/7", { method: "DELETE" });
  });
});
