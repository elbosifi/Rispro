import { describe, expect, it, vi } from "vitest";
import { createRisproTeachingAuthAdapter } from "../auth/teaching-auth-adapter";
import type { AuthContextValue } from "@/providers/auth-provider";
import type { TeachingIdentity } from "../api/teaching-api";

describe("RISpro Teaching authentication adapter", () => {
  it("uses the current RISpro session and returns shared logout to Teaching login", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const auth = {
      user: { id: 123, username: "doctor", fullName: "Teaching Learner", role: "doctor" },
      isLoading: false,
      login: vi.fn(),
      loginWithPasskey: vi.fn(),
      logout,
      reAuth: vi.fn(),
      reAuthWithPasskey: vi.fn(),
      changePassword: vi.fn(),
    } as unknown as AuthContextValue;
    const identity: TeachingIdentity = { identitySubject: "123", displayName: "Teaching Learner", permissions: ["teaching.access"] };
    const adapter = createRisproTeachingAuthAdapter(auth, identity, false);

    expect(adapter.isAuthenticated).toBe(true);
    expect(adapter.identity).toEqual(identity);
    await adapter.logout();
    expect(logout).toHaveBeenCalledWith("/teaching/login");
  });
});
