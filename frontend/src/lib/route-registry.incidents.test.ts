import { describe, expect, it } from "vitest";
import { APP_NAV_ITEMS, APP_ROUTE_PATHS, APP_ROUTE_REGISTRY } from "./route-registry";
describe("incidents registry", () => { it("registers incidents at /incidents for all department roles", () => { const route = APP_ROUTE_REGISTRY.find((item) => item.key === "incidents"); expect(APP_ROUTE_PATHS.incidents).toBe("/incidents"); expect(route?.defaultRoles).toEqual(["receptionist", "modality_staff", "doctor", "administrative", "supervisor", "super_admin"]); expect(APP_NAV_ITEMS.some((item) => item.route === "incidents")).toBe(true); }); });
