import type { Role } from "@/types/api";
import type { TranslationKey } from "@/lib/i18n";

export type AppRouteKey =
  | "dashboard"
  | "patients"
  | "patients.merge"
  | "name.dictionary"
  | "patients.new"
  | "appointments"
  | "scheduling.override.requests"
  | "v2.appointments.admin"
  | "calendar"
  | "registrations"
  | "queue"
  | "queue.checkin"
  | "modality"
  | "doctor"
  | "print"
  | "statistics"
  | "search"
  | "pacs"
  | "pacs.remap"
  | "worklist.monitor"
  | "legacy"
  | "settings";

export type PageAccessRouteKey = Exclude<AppRouteKey, "patients.new" | "search">;

export type AppNavIcon =
  | "dashboard"
  | "patients"
  | "patientMerge"
  | "nameDictionary"
  | "appointments"
  | "overrideRequests"
  | "appointmentsV2Admin"
  | "calendar"
  | "registrations"
  | "queue"
  | "queueCheckIn"
  | "modality"
  | "doctor"
  | "print"
  | "statistics"
  | "pacs"
  | "pacsRemap"
  | "worklistMonitor"
  | "settings"
  | "legacy";

export interface AppRouteRegistryEntry {
  key: AppRouteKey;
  path: string;
  titleKey?: TranslationKey;
  accessKey?: PageAccessRouteKey;
  defaultRoles?: readonly Role[];
  navLabelKey?: TranslationKey;
  navIcon?: AppNavIcon;
  navRoles?: readonly Role[];
}

export interface AppNavItem {
  route: AppRouteKey | PageAccessRouteKey;
  labelKey: TranslationKey;
  icon: AppNavIcon;
  roles?: readonly Role[];
}

type PageVisibilityRegistryEntry = AppRouteRegistryEntry & {
  accessKey: PageAccessRouteKey;
  defaultRoles: readonly Role[];
};

type AppNavRegistryEntry = AppRouteRegistryEntry & {
  navLabelKey: TranslationKey;
  navIcon: AppNavIcon;
};

const ROUTE_REGISTRY: readonly AppRouteRegistryEntry[] = [
  {
    key: "dashboard",
    path: "/",
    titleKey: "routeTitle.dashboard",
    accessKey: "dashboard",
    defaultRoles: ["receptionist", "supervisor", "administrative", "super_admin"],
    navLabelKey: "nav.dashboard",
    navIcon: "dashboard",
  },
  {
    key: "patients",
    path: "/patients",
    titleKey: "patients.title",
    accessKey: "patients",
    defaultRoles: ["receptionist", "supervisor", "doctor", "super_admin"],
    navLabelKey: "nav.patients",
    navIcon: "patients",
  },
  {
    key: "patients.merge",
    path: "/patients/merge",
    titleKey: "patientMerge.title",
    accessKey: "patients.merge",
    defaultRoles: ["supervisor", "super_admin"],
    navLabelKey: "nav.patientMerge",
    navIcon: "patientMerge",
  },
  {
    key: "name.dictionary",
    path: "/name-dictionary",
    titleKey: "nameDictionary.title",
    accessKey: "name.dictionary",
    defaultRoles: ["supervisor", "super_admin"],
    navLabelKey: "nav.nameDictionary",
    navIcon: "nameDictionary",
  },
  {
    key: "patients.new",
    path: "/patients/new",
    titleKey: "patients.registerTitle",
    accessKey: "patients",
  },
  {
    key: "appointments",
    path: "/appointments",
    titleKey: "appointments.create.title",
    accessKey: "appointments",
    defaultRoles: ["receptionist", "supervisor", "super_admin"],
    navLabelKey: "nav.appointments",
    navIcon: "appointments",
  },
  {
    key: "scheduling.override.requests",
    path: "/scheduling/override-requests",
    titleKey: "routeTitle.schedulingOverrideRequests",
    accessKey: "scheduling.override.requests",
    defaultRoles: ["receptionist", "supervisor", "super_admin"],
    navLabelKey: "nav.schedulingOverrideRequests",
    navIcon: "overrideRequests",
  },
  {
    key: "v2.appointments.admin",
    path: "/v2/appointments/admin",
    titleKey: "routeTitle.appointmentAdmin",
    accessKey: "v2.appointments.admin",
    defaultRoles: ["supervisor", "super_admin"],
    navLabelKey: "nav.appointmentsV2Admin",
    navIcon: "appointmentsV2Admin",
    navRoles: ["supervisor", "super_admin"],
  },
  {
    key: "calendar",
    path: "/calendar",
    titleKey: "nav.calendar",
    accessKey: "calendar",
    defaultRoles: ["receptionist", "supervisor", "super_admin"],
    navLabelKey: "nav.calendar",
    navIcon: "calendar",
  },
  {
    key: "registrations",
    path: "/registrations",
    titleKey: "registrations.pageTitle",
    accessKey: "registrations",
    defaultRoles: ["receptionist", "supervisor", "super_admin"],
    navLabelKey: "nav.registrations",
    navIcon: "registrations",
  },
  {
    key: "queue",
    path: "/queue",
    titleKey: "queue.pageTitle",
    accessKey: "queue",
    defaultRoles: ["receptionist", "supervisor", "modality_staff", "super_admin"],
    navLabelKey: "nav.queue",
    navIcon: "queue",
  },
  {
    key: "queue.checkin",
    path: "/queue/check-in",
    accessKey: "queue.checkin",
    defaultRoles: ["receptionist", "supervisor", "super_admin"],
    navLabelKey: "nav.queueCheckIn",
    navIcon: "queueCheckIn",
  },
  {
    key: "modality",
    path: "/modality",
    titleKey: "routeTitle.modality",
    accessKey: "modality",
    defaultRoles: ["modality_staff", "supervisor", "super_admin"],
    navLabelKey: "nav.modality",
    navIcon: "modality",
  },
  {
    key: "doctor",
    path: "/doctor",
    titleKey: "routeTitle.doctor",
    accessKey: "doctor",
    defaultRoles: ["doctor", "supervisor", "super_admin"],
    navLabelKey: "nav.doctor",
    navIcon: "doctor",
  },
  {
    key: "print",
    path: "/print",
    titleKey: "routeTitle.print",
    accessKey: "print",
    defaultRoles: ["receptionist", "supervisor", "doctor", "super_admin"],
    navLabelKey: "nav.print",
    navIcon: "print",
  },
  {
    key: "statistics",
    path: "/statistics",
    titleKey: "nav.statistics",
    accessKey: "statistics",
    defaultRoles: ["administrative", "supervisor", "super_admin"],
    navLabelKey: "nav.statistics",
    navIcon: "statistics",
  },
  {
    key: "search",
    path: "/search",
    titleKey: "routeTitle.search",
  },
  {
    key: "pacs",
    path: "/pacs",
    titleKey: "routeTitle.pacs",
    accessKey: "pacs",
    defaultRoles: ["supervisor", "doctor", "super_admin"],
    navLabelKey: "nav.pacs",
    navIcon: "pacs",
  },
  {
    key: "pacs.remap",
    path: "/pacs/remap",
    titleKey: "nav.pacsRemap",
    accessKey: "pacs.remap",
    defaultRoles: ["supervisor", "doctor", "super_admin"],
    navLabelKey: "nav.pacsRemap",
    navIcon: "pacsRemap",
  },
  {
    key: "worklist.monitor",
    path: "/worklist-monitor",
    accessKey: "worklist.monitor",
    defaultRoles: ["supervisor", "super_admin"],
    navLabelKey: "nav.worklistMonitor",
    navIcon: "worklistMonitor",
  },
  {
    key: "legacy",
    path: "/legacy-access-viewer",
    titleKey: "routeTitle.legacy",
    accessKey: "legacy",
    defaultRoles: ["supervisor", "super_admin"],
    navLabelKey: "nav.legacyReception",
    navIcon: "legacy",
  },
  {
    key: "settings",
    path: "/settings",
    titleKey: "nav.settings",
    accessKey: "settings",
    defaultRoles: ["super_admin"],
    navLabelKey: "nav.settings",
    navIcon: "settings",
    navRoles: ["super_admin"],
  },
] as const;

export const APP_ROUTE_REGISTRY = ROUTE_REGISTRY;

export const PAGE_VISIBILITY_REGISTRY_ENTRIES = APP_ROUTE_REGISTRY.filter(
  (entry): entry is PageVisibilityRegistryEntry =>
    Boolean(entry.accessKey && entry.defaultRoles)
);

export const APP_NAV_ITEMS: readonly AppNavItem[] = APP_ROUTE_REGISTRY.filter(
  (entry): entry is AppNavRegistryEntry =>
    Boolean(entry.navLabelKey && entry.navIcon)
).map((entry) => ({
  route: entry.accessKey || entry.key,
  labelKey: entry.navLabelKey,
  icon: entry.navIcon,
  roles: entry.navRoles,
}));

export const APP_ROUTE_PATHS = Object.fromEntries(
  APP_ROUTE_REGISTRY.map((entry) => [entry.key, entry.path])
) as Record<AppRouteKey, string>;

export const APP_ROUTE_TITLE_KEYS = Object.fromEntries(
  APP_ROUTE_REGISTRY.filter((entry) => entry.titleKey).map((entry) => [entry.key, entry.titleKey])
) as Partial<Record<AppRouteKey, TranslationKey>>;

export const APP_PATH_TO_ROUTE = Object.fromEntries(
  APP_ROUTE_REGISTRY.map((entry) => [entry.path === "/" ? "/" : entry.path.slice(1), entry.key])
) as Record<string, AppRouteKey>;
