import { api } from "@/lib/api-client";
import { normalizeActionPinPolicy, type ActionPinPolicy } from "@/lib/action-pin-policy";
import { mapSettings, mapUser } from "@/lib/mappers";
import { normalizePageVisibilityMatrix, type PageVisibilityMatrix } from "@/lib/page-visibility";
import type { SchedulingEngineConfig, User } from "@/types/api";

type RawRecord = Record<string, unknown>;

// -- Settings --
export async function fetchSettings(category: string) {
  const raw = await api<{ settings: RawRecord[] }>(`/settings/${category}`);
  return mapSettings(raw.settings ?? []);
}

export async function fetchPublicSchedulingCapacitySettings() {
  const raw = await api<{ settings: RawRecord[] }>("/settings/scheduling-and-capacity/public");
  return mapSettings(raw.settings ?? []);
}

export async function fetchPageVisibilityMatrix(): Promise<PageVisibilityMatrix> {
  const raw = await api<{ matrix?: unknown }>("/settings/users-and-roles/page-visibility");
  return normalizePageVisibilityMatrix(raw.matrix ?? {});
}

export async function savePageVisibilityMatrix(matrix: PageVisibilityMatrix): Promise<PageVisibilityMatrix> {
  const raw = await api<{ matrix?: unknown }>("/settings/users-and-roles/page-visibility", {
    method: "PUT",
    body: JSON.stringify({ matrix }),
  });
  return normalizePageVisibilityMatrix(raw.matrix ?? {});
}

export async function fetchActionPinPolicy(): Promise<ActionPinPolicy> {
  const raw = await api<{ policy?: unknown }>("/settings/users-and-roles/action-pin-policy");
  return normalizeActionPinPolicy(raw.policy ?? {});
}

export async function saveActionPinPolicy(policy: ActionPinPolicy): Promise<ActionPinPolicy> {
  const raw = await api<{ policy?: unknown }>("/settings/users-and-roles/action-pin-policy", {
    method: "PUT",
    body: JSON.stringify({ policy }),
  });
  return normalizeActionPinPolicy(raw.policy ?? policy);
}

export interface ActionPinAdminUser {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  hasActionPin: boolean;
  pinRotatedAt: string | null;
  pinExpiresAt: string | null;
  isExpired: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  isLocked: boolean;
  updatedAt: string | null;
  updatedByUserId: number | null;
  updatedByUsername?: string | null;
  updatedByFullName?: string | null;
}

export async function fetchActionPinAdminUsers(): Promise<ActionPinAdminUser[]> {
  const raw = await api<{ users?: ActionPinAdminUser[] }>("/action-pin/admin/users");
  return raw.users ?? [];
}

export async function resetUserActionPin(userId: number): Promise<{ ok: true; hadPin: boolean }> {
  return api<{ ok: true; hadPin: boolean }>(`/action-pin/admin/users/${userId}/reset`, { method: "POST" });
}

export async function unlockUserActionPin(userId: number): Promise<{ ok: true; hadPin: boolean }> {
  return api<{ ok: true; hadPin: boolean }>(`/action-pin/admin/users/${userId}/unlock`, { method: "POST" });
}

export async function expireUserActionPin(userId: number): Promise<{ ok: true; hadPin: boolean; pinExpiresAt: string | null }> {
  return api<{ ok: true; hadPin: boolean; pinExpiresAt: string | null }>(`/action-pin/admin/users/${userId}/expire`, { method: "POST" });
}

export async function fetchSonicDicomSettings(): Promise<Record<string, unknown>> {
  const raw = await api<{ settings: RawRecord[] }>(`/settings/sonicdicom_reports`);
  const settings = raw.settings ?? [];
  const configRow = settings.find((row) => row.setting_key === "config");
  if (configRow?.setting_value && typeof configRow.setting_value === "object" && !Array.isArray(configRow.setting_value)) {
    const value = (configRow.setting_value as { value?: unknown }).value;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
  return {};
}

export interface SonicDicomSqlReadinessResponse {
  ok: boolean;
  foundStudy: boolean;
  foundReport: boolean;
  normalizedState: "final" | "draft" | "no_report" | "unavailable" | "not_required" | "not_completed" | "disabled";
  canViewReport: boolean;
  statusCode: number | null;
  diagnostic: string;
}

export async function testSonicDicomSqlReadiness(payload: {
  mode: "sql_connection" | "accession_to_study" | "report_status" | "full_readiness";
  accessionNumber?: string;
  reportNo?: string;
}): Promise<SonicDicomSqlReadinessResponse> {
  return api<SonicDicomSqlReadinessResponse>("/settings/sonicdicom_reports/test-readiness", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function saveSettings(category: string, payload: Record<string, unknown>) {
  return api<{ settings: RawRecord }>(`/settings/${category}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function fetchSettingsCatalog() {
  const raw = await api<{ settings: Record<string, unknown[]> }>("/settings/");
  return raw.settings ?? {};
}

export async function fetchSchedulingEngineConfig(): Promise<SchedulingEngineConfig> {
  const raw = await api<{ config: SchedulingEngineConfig }>("/settings/scheduling-engine-config");
  return raw.config;
}

export async function saveSchedulingEngineConfig(payload: SchedulingEngineConfig) {
  const raw = await api<{ config: SchedulingEngineConfig }>("/settings/scheduling-engine-config", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return raw.config;
}

export async function fetchUsers(): Promise<{ users: User[] }> {
  const raw = await api<{ users: RawRecord[] }>("/users");
  return {
    users: (raw.users ?? []).map(mapUser)
  };
}

export async function createUser(payload: { username: string; fullName: string; password: string; role: string }) {
  return api<{ user: RawRecord }>("/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateUserSchedulingOverridePermission(userId: number, canRequestSchedulingOverride: boolean) {
  const raw = await api<{ user: RawRecord }>(`/users/${userId}/scheduling-override-permission`, {
    method: "PUT",
    body: JSON.stringify({ canRequestSchedulingOverride })
  });
  return mapUser(raw.user);
}

export async function deleteUser(userId: number) {
  return api<{ user: RawRecord }>(`/users/${userId}`, { method: "DELETE" });
}

export async function updateUserPassword(userId: number, password: string) {
  return api<{ user: RawRecord }>(`/users/${userId}/password`, {
    method: "PUT",
    body: JSON.stringify({ password })
  });
}

export async function updateUserIdentity(
  userId: number,
  payload: { username: string; fullName: string }
): Promise<User> {
  const raw = await api<{ user: RawRecord }>(`/users/${userId}/identity`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  return mapUser(raw.user);
}

export async function updateUserActiveState(userId: number, isActive: boolean): Promise<User> {
  const raw = await api<{ user: RawRecord }>(`/users/${userId}/active`, {
    method: "PUT",
    body: JSON.stringify({ isActive })
  });
  return mapUser(raw.user);
}

export async function resetUserTemporaryPassword(userId: number, password: string): Promise<User> {
  const raw = await api<{ user: RawRecord }>(`/users/${userId}/temporary-password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
  return mapUser(raw.user);
}
