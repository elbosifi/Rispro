import { describe, expect, it } from "vitest";

import appSource from "./App.tsx?raw";
import navigationSource from "./components/layout/navigation.tsx?raw";
import pageVisibilitySource from "./lib/page-visibility.ts?raw";
import routeRegistrySource from "./lib/route-registry.ts?raw";
import appointmentIndexSource from "./v2/appointments/index.ts?raw";

describe("App route naming and page title source guards", () => {
  it("uses production appointment naming for the /appointments create route", () => {
    expect(appointmentIndexSource).toContain('export { AppointmentCreatePage } from "./appointment-create-page";');
    expect(appointmentIndexSource).not.toContain("AppointmentsV3CreatePage");
    expect(appointmentIndexSource).not.toContain("create-appointment-v3-page");

    expect(appSource).toContain("import { AppointmentCreatePage, SchedulingAdminV2Page } from");
    expect(appSource).toContain('<Route path="/appointments" element={guardedPage("appointments", <AppointmentCreatePage />)} />');
    expect(appSource).not.toContain("AppointmentsV3CreatePage");
  });

  it("keeps App page titles translation-key based for patient merge and name dictionary", () => {
    expect(routeRegistrySource).toContain('key: "patients.merge"');
    expect(routeRegistrySource).toContain('titleKey: "patientMerge.title"');
    expect(routeRegistrySource).toContain('key: "name.dictionary"');
    expect(routeRegistrySource).toContain('titleKey: "nameDictionary.title"');
    expect(appSource).not.toContain("Ø¯Ù");
    expect(appSource).not.toContain("Ù‚Ø");
  });

  it("derives route paths, titles, nav entries, and page visibility from a shared route registry", () => {
    expect(routeRegistrySource).toContain("APP_ROUTE_REGISTRY");
    expect(routeRegistrySource).toContain('key: "appointments"');
    expect(routeRegistrySource).toContain('path: "/appointments"');
    expect(routeRegistrySource).toContain('titleKey: "appointments.create.title"');
    expect(routeRegistrySource).toContain('accessKey: "appointments"');
    expect(routeRegistrySource).toContain('navLabelKey: "nav.appointments"');

    expect(appSource).toContain("APP_ROUTE_PATHS");
    expect(appSource).toContain("APP_ROUTE_TITLE_KEYS");
    expect(appSource).not.toContain("const ROUTE_PATHS");
    expect(appSource).not.toContain("const ROUTE_PAGE_TITLE_KEYS");

    expect(navigationSource).toContain("APP_NAV_ITEMS");
    expect(navigationSource).not.toContain("export const NAV_ITEMS: NavItemConfig[] = [");

    expect(pageVisibilitySource).toContain("PAGE_VISIBILITY_REGISTRY_ENTRIES");
    expect(pageVisibilitySource).not.toContain("export const PAGE_VISIBILITY_ROUTE_KEYS = [");
    expect(pageVisibilitySource).not.toContain("export const DEFAULT_PAGE_VISIBILITY_MATRIX: PageVisibilityMatrix = {");
  });
});
