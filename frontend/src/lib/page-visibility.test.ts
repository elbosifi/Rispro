import { describe, expect, it } from "vitest";
import type { Role } from "@/types/api";
import { canRoleAccessRoute, DEFAULT_PAGE_VISIBILITY_MATRIX, PAGE_VISIBILITY_ROUTE_KEYS } from "@/lib/page-visibility";

const EXPECTED_ROUTES_BY_ROLE: Record<Role, string[]> = {
  receptionist: ["dashboard", "patients", "appointments", "calendar", "registrations", "queue", "queue.checkin", "print"],
  supervisor: [
    "dashboard",
    "patients",
    "appointments",
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
    "legacy",
  ],
  modality_staff: ["queue", "modality"],
  doctor: ["patients", "doctor", "print", "pacs"],
  administrative: ["dashboard", "statistics"],
  super_admin: [
    "dashboard",
    "patients",
    "appointments",
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
    "legacy",
    "settings",
  ],
};

describe("default page visibility matrix", () => {
  it("maps each role to the exact desired default routes", () => {
    for (const [role, expectedRoutes] of Object.entries(EXPECTED_ROUTES_BY_ROLE) as Array<[Role, string[]]>) {
      const visibleRoutes = PAGE_VISIBILITY_ROUTE_KEYS.filter((route) =>
        canRoleAccessRoute(DEFAULT_PAGE_VISIBILITY_MATRIX, route, role)
      );
      expect(visibleRoutes).toEqual(expectedRoutes);
    }
  });
});
