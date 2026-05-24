import type { Role } from "@/types/api";

export const PAGE_VISIBILITY_ROLES: Role[] = [
  "receptionist",
  "supervisor",
  "modality_staff",
  "doctor",
  "administrative",
  "super_admin",
];

export const PAGE_VISIBILITY_ROUTE_KEYS = [
  "dashboard",
  "patients",
  "patients.merge",
  "appointments",
  "scheduling.override.requests",
  "v2.appointments.admin",
  "calendar",
  "registrations",
  "queue",
  "queue.checkin",
  "modality",
  "doctor",
  "print",
  "statistics",
  "pacs",
  "pacs.remap",
  "legacy",
  "settings",
] as const;

export type PageVisibilityRouteKey = (typeof PAGE_VISIBILITY_ROUTE_KEYS)[number];
export type PageVisibilityMatrix = Record<PageVisibilityRouteKey, Role[]>;

export const DEFAULT_PAGE_VISIBILITY_MATRIX: PageVisibilityMatrix = {
  dashboard: ["receptionist", "supervisor", "administrative", "super_admin"],
  patients: ["receptionist", "supervisor", "doctor", "super_admin"],
  "patients.merge": ["supervisor", "super_admin"],
  appointments: ["receptionist", "supervisor", "super_admin"],
  "scheduling.override.requests": ["receptionist", "supervisor", "super_admin"],
  "v2.appointments.admin": ["supervisor", "super_admin"],
  calendar: ["receptionist", "supervisor", "super_admin"],
  registrations: ["receptionist", "supervisor", "super_admin"],
  queue: ["receptionist", "supervisor", "modality_staff", "super_admin"],
  "queue.checkin": ["receptionist", "supervisor", "super_admin"],
  modality: ["modality_staff", "supervisor", "super_admin"],
  doctor: ["doctor", "supervisor", "super_admin"],
  print: ["receptionist", "supervisor", "doctor", "super_admin"],
  statistics: ["administrative", "supervisor", "super_admin"],
  pacs: ["supervisor", "doctor", "super_admin"],
  "pacs.remap": ["supervisor", "doctor", "super_admin"],
  legacy: ["supervisor", "super_admin"],
  settings: ["super_admin"],
};

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
  "appointments",
  "scheduling.override.requests",
  "calendar",
  "modality",
  "doctor",
  "statistics",
  "print",
  "pacs",
  "pacs.remap",
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
