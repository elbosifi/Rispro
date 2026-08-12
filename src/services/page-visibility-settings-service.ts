import { ROLE_VALUES, isRole } from "../constants/roles.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import type { Role } from "../types/domain.js";
import type { UserId } from "../types/http.js";

const SETTINGS_CATEGORY = "users_and_roles";
const SETTINGS_KEY = "page_visibility_by_role";

export const PAGE_VISIBILITY_ROUTE_KEYS = [
  "dashboard",
  "patients",
  "patients.merge",
  "name.dictionary",
  "appointments",
  "v2.appointments.admin",
  "calendar",
  "registrations",
  "queue",
  "queue.checkin",
  "modality",
  "comparisons",
  "doctor",
  "print",
  "statistics",
  "pacs",
  "pacs.remap",
  "authoritative.orthanc",
  "worklist.monitor",
  "legacy",
  "settings",
] as const;

export type PageVisibilityRouteKey = (typeof PAGE_VISIBILITY_ROUTE_KEYS)[number];
export type PageVisibilityMatrix = Record<PageVisibilityRouteKey, Role[]>;

const ALLOWED_ROLES = new Set<Role>(ROLE_VALUES);
const ALLOWED_ROUTE_KEYS = new Set<string>(PAGE_VISIBILITY_ROUTE_KEYS);

export const DEFAULT_PAGE_VISIBILITY_MATRIX: PageVisibilityMatrix = {
  dashboard: ["receptionist", "supervisor", "administrative", "super_admin"],
  patients: ["receptionist", "supervisor", "doctor", "super_admin"],
  "patients.merge": ["supervisor", "super_admin"],
  "name.dictionary": ["supervisor", "super_admin"],
  appointments: ["receptionist", "supervisor", "super_admin"],
  "v2.appointments.admin": ["supervisor", "super_admin"],
  calendar: ["receptionist", "supervisor", "super_admin"],
  registrations: ["receptionist", "supervisor", "super_admin"],
  queue: ["receptionist", "supervisor", "modality_staff", "super_admin"],
  "queue.checkin": ["receptionist", "supervisor", "super_admin"],
  modality: ["modality_staff", "supervisor", "super_admin"],
  comparisons: ["modality_staff", "doctor", "supervisor", "super_admin"],
  doctor: ["doctor", "supervisor", "super_admin"],
  print: ["receptionist", "supervisor", "doctor", "super_admin"],
  statistics: ["administrative", "supervisor", "super_admin"],
  pacs: ["supervisor", "doctor", "super_admin"],
  "pacs.remap": ["supervisor", "doctor", "super_admin"],
  "authoritative.orthanc": ["modality_staff", "supervisor", "super_admin"],
  "worklist.monitor": ["supervisor", "super_admin"],
  legacy: ["supervisor", "super_admin"],
  settings: ["super_admin"],
};

function uniqueRoles(roles: Role[]): Role[] {
  const seen = new Set<Role>();
  const result: Role[] = [];
  for (const role of roles) {
    if (seen.has(role)) continue;
    seen.add(role);
    result.push(role);
  }
  return result;
}

export function normalizePageVisibilityMatrix(input: unknown): PageVisibilityMatrix {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const normalized: PageVisibilityMatrix = { ...DEFAULT_PAGE_VISIBILITY_MATRIX };

  for (const routeKey of PAGE_VISIBILITY_ROUTE_KEYS) {
    const rawRoles = source[routeKey];
    if (!Array.isArray(rawRoles)) continue;

    const parsedRoles = uniqueRoles(
      rawRoles
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is Role => isRole(value) && ALLOWED_ROLES.has(value))
    );

    normalized[routeKey] = parsedRoles.length > 0 ? parsedRoles : [];
  }

  // Hard safety: never allow settings lockout for super_admin.
  if (!normalized.settings.includes("super_admin")) {
    normalized.settings = uniqueRoles([...normalized.settings, "super_admin"]);
  }

  return normalized;
}

export function sanitizePageVisibilityForNavigation(input: unknown): PageVisibilityMatrix {
  const normalized = normalizePageVisibilityMatrix(input);
  const safeResult: PageVisibilityMatrix = { ...DEFAULT_PAGE_VISIBILITY_MATRIX };

  for (const routeKey of PAGE_VISIBILITY_ROUTE_KEYS) {
    const roles = normalized[routeKey].filter((role) => ALLOWED_ROLES.has(role));
    safeResult[routeKey] = roles;
  }

  if (!safeResult.settings.includes("super_admin")) {
    safeResult.settings = uniqueRoles([...safeResult.settings, "super_admin"]);
  }

  return safeResult;
}

export function canRoleAccessPage(routeKey: PageVisibilityRouteKey, role: Role, matrix: PageVisibilityMatrix): boolean {
  if (routeKey === "settings" && role === "super_admin") {
    return true;
  }

  return matrix[routeKey].includes(role);
}

export async function readPageVisibilityMatrix(): Promise<PageVisibilityMatrix> {
  const { rows } = await pool.query<{ setting_value: unknown }>(
    `
      select setting_value
      from system_settings
      where category = $1 and setting_key = $2
      limit 1
    `,
    [SETTINGS_CATEGORY, SETTINGS_KEY]
  );

  const row = rows[0];
  if (!row) {
    return { ...DEFAULT_PAGE_VISIBILITY_MATRIX };
  }

  const raw = row.setting_value as { value?: unknown } | null;
  const storedValue = raw && typeof raw === "object" && "value" in raw ? raw.value : raw;
  return sanitizePageVisibilityForNavigation(storedValue);
}

export async function savePageVisibilityMatrix(input: unknown, updatedByUserId: UserId): Promise<PageVisibilityMatrix> {
  const normalized = normalizePageVisibilityMatrix(input);

  if (!normalized.settings.includes("super_admin")) {
    throw new HttpError(400, "settings must include super_admin.");
  }

  const filteredForStorage: Record<string, Role[]> = {};
  for (const routeKey of PAGE_VISIBILITY_ROUTE_KEYS) {
    if (!ALLOWED_ROUTE_KEYS.has(routeKey)) continue;
    filteredForStorage[routeKey] = normalized[routeKey].filter((role) => ALLOWED_ROLES.has(role));
  }

  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ($1, $2, $3::jsonb, $4)
      on conflict (category, setting_key)
      do update set
        setting_value = excluded.setting_value,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
    `,
    [SETTINGS_CATEGORY, SETTINGS_KEY, JSON.stringify({ value: filteredForStorage }), updatedByUserId]
  );

  return sanitizePageVisibilityForNavigation(filteredForStorage);
}
