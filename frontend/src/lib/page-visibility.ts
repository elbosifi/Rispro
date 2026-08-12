import type { Role } from "@/types/api";
import { PAGE_VISIBILITY_REGISTRY_ENTRIES, type PageAccessRouteKey } from "@/lib/route-registry";

export const PAGE_VISIBILITY_ROLES: Role[] = [
  "receptionist",
  "supervisor",
  "modality_staff",
  "doctor",
  "administrative",
  "super_admin",
];

export const PAGE_VISIBILITY_ROUTE_KEYS = PAGE_VISIBILITY_REGISTRY_ENTRIES.map((entry) => entry.accessKey);

export type PageVisibilityRouteKey = PageAccessRouteKey;
export type PageVisibilityMatrix = Record<PageVisibilityRouteKey, Role[]>;

export const DEFAULT_PAGE_VISIBILITY_MATRIX: PageVisibilityMatrix = Object.fromEntries(
  PAGE_VISIBILITY_REGISTRY_ENTRIES.map((entry) => [entry.accessKey, [...entry.defaultRoles]])
) as PageVisibilityMatrix;

function isRole(value: unknown): value is Role {
  return typeof value === "string" && PAGE_VISIBILITY_ROLES.includes(value as Role);
}

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
  const source = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const normalized: PageVisibilityMatrix = { ...DEFAULT_PAGE_VISIBILITY_MATRIX };

  for (const routeKey of PAGE_VISIBILITY_ROUTE_KEYS) {
    const rawRoles = source[routeKey];
    if (!Array.isArray(rawRoles)) continue;

    normalized[routeKey] = uniqueRoles(
      rawRoles
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value): value is Role => isRole(value))
    );
  }

  if (!normalized.settings.includes("super_admin")) {
    normalized.settings = uniqueRoles([...normalized.settings, "super_admin"]);
  }

  return normalized;
}

export function canRoleAccessRoute(matrix: PageVisibilityMatrix, route: string, role: Role): boolean {
  if (route === "settings" && role === "super_admin") {
    return true;
  }
  if (!(PAGE_VISIBILITY_ROUTE_KEYS as readonly string[]).includes(route)) {
    return false;
  }
  const key = route as PageVisibilityRouteKey;
  return matrix[key].includes(role);
}

const DEFAULT_LANDING_PRIORITY: readonly PageVisibilityRouteKey[] = [
  "queue",
  "registrations",
  "patients",
  "patients.merge",
  "name.dictionary",
  "appointments",
  "scheduling.override.requests",
  "calendar",
  "modality",
  "doctor",
  "statistics",
  "print",
  "pacs",
  "pacs.remap",
  "authoritative.orthanc",
  "worklist.monitor",
  "legacy",
  "v2.appointments.admin",
  "settings",
  "queue.checkin",
  "dashboard",
];

export function getDefaultLandingRouteForRole(matrix: PageVisibilityMatrix, role: Role): PageVisibilityRouteKey {
  for (const route of DEFAULT_LANDING_PRIORITY) {
    if (canRoleAccessRoute(matrix, route, role)) {
      return route;
    }
  }
  return "dashboard";
}
