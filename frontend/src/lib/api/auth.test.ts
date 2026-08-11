import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  changeOwnPassword,
  disableOwnActionPin,
  fetchActionPinStatus,
  lockActionPinIdleSession,
  login,
  logout,
  reAuthSupervisor,
  setOwnActionPin,
} from "./auth";

vi.mock("@/lib/api-client", () => ({ api: vi.fn() }));

describe("auth API contracts", () => {
  beforeEach(() => vi.mocked(api).mockReset().mockResolvedValue({ user: {} }));

  it("preserves login, password, re-auth, and logout contracts", async () => {
    await login("user", "password");
    await changeOwnPassword("old", "new");
    await reAuthSupervisor("supervisor-password");
    await logout();

    expect(api).toHaveBeenNthCalledWith(1, "/auth/login", { method: "POST", body: JSON.stringify({ username: "user", password: "password" }) });
    expect(api).toHaveBeenNthCalledWith(2, "/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: "old", newPassword: "new" }) });
    expect(api).toHaveBeenNthCalledWith(3, "/auth/re-auth", { method: "POST", body: JSON.stringify({ password: "supervisor-password" }) });
    expect(api).toHaveBeenNthCalledWith(4, "/auth/logout", { method: "POST" });
  });

  it("preserves action-PIN routes and payloads", async () => {
    await fetchActionPinStatus();
    await lockActionPinIdleSession();
    await setOwnActionPin("1234", "1234", "password");
    await disableOwnActionPin("password");

    expect(api).toHaveBeenNthCalledWith(1, "/action-pin/status");
    expect(api).toHaveBeenNthCalledWith(2, "/action-pin/idle-lock", { method: "POST" });
    expect(api).toHaveBeenNthCalledWith(3, "/action-pin/set", { method: "POST", body: JSON.stringify({ pin: "1234", confirmPin: "1234", currentPassword: "password" }) });
    expect(api).toHaveBeenNthCalledWith(4, "/action-pin/disable", { method: "POST", body: JSON.stringify({ currentPassword: "password" }) });
  });
});
