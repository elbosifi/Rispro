import { api } from "@/lib/api-client";
import { mapUser } from "@/lib/mappers";
import type { User } from "@/types/api";

type RawRecord = Record<string, unknown>;

export async function login(username: string, password: string): Promise<User> {
  const res = await api<{ user: RawRecord }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return mapUser(res.user);
}

export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<User> {
  const res = await api<{ user: RawRecord }>("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  });
  return mapUser(res.user);
}

export async function reAuthSupervisor(password: string): Promise<User> {
  const res = await api<{ user: RawRecord }>("/auth/re-auth", {
    method: "POST",
    body: JSON.stringify({ password })
  });
  return mapUser(res.user);
}

export interface ActionPinStatus {
  hasPin: boolean;
  lockedUntil: string | null;
  idleLockEligible?: boolean;
  idleLockActive?: boolean;
  idleLockedAt?: string | null;
  pinExpiresAt: string | null;
  isExpired: boolean;
  policy: {
    enabled: boolean;
    pinLength: number;
    idleLockEnabled: boolean;
    idleLockSeconds: number;
    idleLockRoleMode?: string;
    idleLockRoles?: string[];
    idleLockUserIds?: number[];
    idleLockExcludedUserIds?: number[];
    verificationTtlSeconds: number;
    allowUserPinChange: boolean;
    requirePinToViewOwnPinSettings: boolean;
  };
}

export async function fetchActionPinStatus(): Promise<ActionPinStatus> {
  return api<ActionPinStatus>("/action-pin/status");
}

export async function lockActionPinIdleSession(): Promise<{ active: boolean; lockedAt: string | null }> {
  return api<{ active: boolean; lockedAt: string | null }>("/action-pin/idle-lock", { method: "POST" });
}

export async function setOwnActionPin(pin: string, confirmPin: string, currentPassword: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("/action-pin/set", {
    method: "POST",
    body: JSON.stringify({ pin, confirmPin, currentPassword })
  });
}

export async function disableOwnActionPin(currentPassword: string): Promise<{ ok: true }> {
  return api<{ ok: true }>("/action-pin/disable", {
    method: "POST",
    body: JSON.stringify({ currentPassword })
  });
}

export async function logout() {
  await api("/auth/logout", { method: "POST" });
}

// -- Auth --
export async function fetchCurrentSession(): Promise<User | null> {
  try {
    const res = await api<{ user: RawRecord }>("/auth/me");
    return mapUser(res.user);
  } catch {
    return null;
  }
}

export interface PasskeyConfiguration {
  rpName: string;
  rpId: string;
  origin: string;
}

export async function fetchPasskeyConfiguration(): Promise<PasskeyConfiguration | null> {
  const raw = await api<{ configuration: PasskeyConfiguration | null }>("/settings/passkeys/config");
  return raw.configuration;
}

export async function savePasskeyConfiguration(configuration: Pick<PasskeyConfiguration, "rpName" | "origin">): Promise<PasskeyConfiguration> {
  const raw = await api<{ configuration: PasskeyConfiguration }>("/settings/passkeys/config", {
    method: "PUT",
    body: JSON.stringify(configuration),
  });
  return raw.configuration;
}

export async function getPasskeyRegistrationOptions(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>("/auth/passkeys/register/options", { method: "POST" });
}

export async function verifyPasskeyRegistration(response: unknown): Promise<void> {
  await api("/auth/passkeys/register/verify", { method: "POST", body: JSON.stringify({ response }) });
}

export async function getPasskeyLoginOptions(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>("/auth/passkeys/login/options", { method: "POST" });
}

export async function verifyPasskeyLogin(response: unknown): Promise<User> {
  const result = await api<{ user: RawRecord }>("/auth/passkeys/login/verify", { method: "POST", body: JSON.stringify({ response }) });
  return mapUser(result.user);
}

export async function getPasskeyReauthOptions(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>("/auth/passkeys/re-auth/options", { method: "POST" });
}

export async function verifyPasskeyReauth(response: unknown): Promise<User> {
  const result = await api<{ user: RawRecord }>("/auth/passkeys/re-auth/verify", { method: "POST", body: JSON.stringify({ response }) });
  return mapUser(result.user);
}
