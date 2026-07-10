import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@/types/api";
import { t, type Language } from "@/lib/i18n";
import {
  canRoleAccessRoute,
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  normalizePageVisibilityMatrix,
  type PageVisibilityMatrix,
  type PageVisibilityRouteKey
} from "@/lib/page-visibility";
import { fetchPageVisibilityMatrix } from "@/lib/api-hooks";
import { APP_NAV_ITEMS, type AppNavIcon, type AppNavItem } from "@/lib/route-registry";
import {
  LayoutGrid,
  Users,
  GitMerge,
  BookOpenText,
  CalendarDays,
  ClipboardList,
  ListOrdered,
  Monitor,
  UserCheck,
  Printer,
  BarChart3,
  Database,
  Settings,
  History,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  Undo2,
  Redo2,
  Languages,
  LogOut
} from "lucide-react";
import { GlobalSearch } from "@/components/search/global-search";
import type { AppointmentWithDetails } from "@/lib/mappers";

export const NAV_ITEMS = APP_NAV_ITEMS;

function canAccess(item: Pick<AppNavItem, "route">, user: User | null, matrix: PageVisibilityMatrix): boolean {
  if (!user) return false;

  if (item.route === "settings" && user.role === "super_admin") {
    return true;
  }

  return canRoleAccessRoute(matrix, item.route, user.role);
}

const ICON_MAP: Record<AppNavIcon, typeof LayoutGrid> = {
  dashboard: LayoutGrid,
  patients: Users,
  patientMerge: GitMerge,
  nameDictionary: BookOpenText,
  appointments: CalendarDays,
  overrideRequests: ClipboardList,
  appointmentsV2Admin: Settings,
  calendar: ClipboardList,
  registrations: ListOrdered,
  queue: ListOrdered,
  queueCheckIn: ListOrdered,
  modality: Monitor,
  comparisons: ClipboardList,
  doctor: UserCheck,
  print: Printer,
  statistics: BarChart3,
  pacs: Database,
  pacsRemap: Database,
  worklistMonitor: ClipboardList,
  settings: Settings,
  legacy: History
};

function NavIconGlyph({ icon, size = 20 }: { icon: AppNavIcon; size?: number }) {
  const LucideIcon = ICON_MAP[icon];
  return <LucideIcon size={size} strokeWidth={1.5} />;
}

function useLiveStatusTime(language: Language) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 30_000);

    return () => window.clearInterval(timer);
  }, []);

  const locale = language === "ar" ? "ar-LY" : "en-US";
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(now);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);

  return { date, time };
}

function PanelHeader({ language, isRtl }: { language: Language; isRtl: boolean }) {
  return (
    <div
      className={`nav-panel-header rounded-2xl p-4 text-white relative overflow-hidden ${isRtl ? "text-center" : ""}`}
      style={{
        background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))",
        boxShadow: "var(--shadow-accent-lg)"
      }}
    >
      <p className="text-xs uppercase tracking-[0.2em] opacity-80 font-mono">{t(language, "shell.menu")}</p>
      <p className="mt-2 text-xl font-display">{t(language, "shell.reception")}</p>
      <div className="flex items-center justify-center gap-2 mt-3">
        <span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
        <span className="text-xs uppercase tracking-[0.15em] opacity-80 font-mono">{t(language, "shell.systemOnline")}</span>
      </div>
    </div>
  );
}

function StatusFooter({ language, label }: { language: Language; label: string }) {
  const { date, time } = useLiveStatusTime(language);

  return (
    <div className="flex flex-col items-center gap-1 text-center">
      <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
        {label}
      </span>
      <span className="text-[11px] font-medium text-foreground">{date}</span>
      <span className="text-[11px] font-mono text-muted-foreground">{time}</span>
    </div>
  );
}

function NavButton({
  item,
  isActive,
  label,
  isRtl,
  collapsed = false,
  index,
  onClick
}: {
  item: AppNavItem;
  isActive: boolean;
  label: string;
  isRtl: boolean;
  collapsed?: boolean;
  index: number;
  onClick: () => void;
}) {
  const buttonStyle: CSSProperties = {
    backgroundColor: isActive ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
    color: isActive ? "var(--accent)" : "var(--foreground)",
    border: isActive ? "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))" : "1px solid transparent",
    boxShadow: isActive ? "var(--shadow-sm)" : "none",
    animationDelay: `${index * 40}ms`
  };

  return (
    <button
      className={`nav-item-reveal group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
        isRtl ? "flex-row-reverse text-end" : "text-start"
      } ${collapsed ? "justify-center px-2" : ""}`}
      style={buttonStyle}
      data-active={isActive ? "true" : "false"}
      aria-current={isActive ? "page" : undefined}
      onClick={onClick}
      aria-label={label}
      title={collapsed ? label : undefined}
    >
      {isActive ? <span className={`absolute inset-y-1 ${isRtl ? "right-0" : "left-0"} w-0.5 rounded-full bg-accent`} aria-hidden="true" /> : null}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-accent transition-colors group-hover:text-foreground" style={{ color: isActive ? "var(--accent)" : "var(--muted-foreground)" }}>
        <NavIconGlyph icon={item.icon} size={16} />
      </span>
      <span className={`${collapsed ? "sr-only" : "min-w-0 flex-1 truncate"} leading-tight`}>
        {label}
      </span>
    </button>
  );
}

type SidebarGroupKey = "quick" | "overview" | "reception" | "clinical" | "reporting" | "administration" | "systems" | "other";
type SidebarItem = AppNavItem & { accessRoute?: PageVisibilityRouteKey };

const NAV_BY_ROUTE = new Map(NAV_ITEMS.map((item) => [item.route, item]));

function sidebarItem(route: AppNavItem["route"], labelKey?: AppNavItem["labelKey"], accessRoute?: PageVisibilityRouteKey): SidebarItem | null {
  const item = NAV_BY_ROUTE.get(route);
  if (item) return { ...item, ...(labelKey ? { labelKey } : {}), ...(accessRoute ? { accessRoute } : {}) };
  if (route === "patients.new") {
    return { route, labelKey: labelKey ?? "nav.newPatient", icon: "patients", accessRoute: "patients" };
  }
  return null;
}

function buildSidebarGroups(): Array<{ key: SidebarGroupKey; labelKey: AppNavItem["labelKey"]; items: SidebarItem[]; defaultExpanded: boolean }> {
  const group = (key: SidebarGroupKey, labelKey: AppNavItem["labelKey"], routes: Array<[AppNavItem["route"], AppNavItem["labelKey"]?]>, defaultExpanded: boolean) => ({
    key,
    labelKey,
    defaultExpanded,
    items: routes.map(([route, itemLabel]) => sidebarItem(route, itemLabel)).filter((item): item is SidebarItem => Boolean(item)),
  });
  return [
    group("quick", "navGroup.quickActions", [["patients.new"], ["appointments", "nav.newAppointment"]], true),
    group("overview", "navGroup.overview", [["dashboard"]], true),
    group("reception", "navGroup.reception", [["patients", "nav.patients"], ["calendar"], ["registrations"], ["queue"]], true),
    group("clinical", "navGroup.clinicalWorkflow", [["modality"], ["pacs.remap"], ["comparisons"], ["doctor"], ["queue.checkin"]], true),
    group("reporting", "navGroup.reporting", [["print"], ["statistics"]], false),
    group("administration", "navGroup.administration", [["scheduling.override.requests"], ["v2.appointments.admin"], ["patients.merge"], ["name.dictionary"]], false),
    group("systems", "navGroup.systems", [["pacs"], ["worklist.monitor"]], false),
    group("other", "navGroup.other", [["legacy"], ["settings"]], false),
  ];
}

const SIDEBAR_GROUPS = buildSidebarGroups();

function SidebarSection({ group, items, expanded, collapsed, currentRoute, isRtl, language, onToggle, onNavigate }: {
  group: (typeof SIDEBAR_GROUPS)[number];
  items: SidebarItem[];
  expanded: boolean;
  collapsed: boolean;
  currentRoute: string;
  isRtl: boolean;
  language: Language;
  onToggle: () => void;
  onNavigate: (route: string) => void;
}) {
  if (!items.length) return null;
  const sectionId = `sidebar-section-${group.key}`;
  return (
    <section className="space-y-1" aria-labelledby={collapsed ? undefined : `${sectionId}-label`} aria-label={collapsed ? t(language, group.labelKey) : undefined}>
      {collapsed ? (
        <div className="my-2 border-t" style={{ borderColor: "var(--border)" }} aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-between rounded-md px-3 py-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground transition-colors hover:text-foreground"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={sectionId}
        >
          <span id={`${sectionId}-label`}>{t(language, group.labelKey)}</span>
          {expanded ? <ChevronLeft className={`h-3.5 w-3.5 ${isRtl ? "-rotate-90" : "rotate-90"}`} aria-hidden="true" /> : <ChevronRight className={`h-3.5 w-3.5 ${isRtl ? "rotate-180" : ""}`} aria-hidden="true" />}
        </button>
      )}
      <div id={sectionId} className={`${collapsed || expanded ? "space-y-0.5" : "hidden"}`}>
        {items.map((item, index) => (
          <NavButton key={`${group.key}-${item.route}`} item={item} isActive={currentRoute === item.route} label={t(language, item.labelKey)} isRtl={isRtl} collapsed={collapsed} index={index} onClick={() => onNavigate(item.route)} />
        ))}
      </div>
    </section>
  );
}

export function TopBar({
  user,
  language,
  isRtl,
  pageTitle,
  pageAction,
  extraActions,
  onUndo,
  onRedo,
  onToggleLanguage,
  onLogout,
  onMobileNavToggle,
  canSearchPatients = false,
  canSearchRegistrations = false,
  onPatientSearchSelect = () => {},
  onRegistrationSearchSelect = () => {}
}: {
  user: User | null;
  language: Language;
  isRtl: boolean;
  pageTitle?: string;
  pageAction?: ReactNode;
  extraActions?: ReactNode;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLanguage: () => void;
  onLogout: () => void;
  onMobileNavToggle: () => void;
  canSearchPatients?: boolean;
  canSearchRegistrations?: boolean;
  onPatientSearchSelect?: (patientId: number) => void;
  onRegistrationSearchSelect?: (appointment: AppointmentWithDetails) => void;
}) {
  return (
    <header
      className="sticky top-0 z-50 border-b"
      style={{
        backgroundColor: "var(--background)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow-sm)"
      }}
    >
      <div className={`relative flex items-center justify-between h-12 px-4 lg:px-6 gap-3 ${isRtl ? "flex-row-reverse" : ""}`}>
        <div className={`flex min-w-0 flex-1 items-center gap-3 ${isRtl ? "flex-row-reverse text-end" : ""}`}>
          {/* Mobile menu button */}
          <button
            className="lg:hidden p-2 rounded-lg border transition-all duration-150 active:translate-y-[1px]"
            style={{
              color: "var(--foreground)",
              backgroundColor: "transparent",
              borderColor: "var(--border)"
            }}
            onClick={onMobileNavToggle}
            aria-label={t(language, "shell.toggleNav")}
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Brand */}
          <div className={`flex min-w-0 items-center gap-3 ${isRtl ? "flex-row-reverse text-end" : ""}`}>
            <div
              className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white relative"
              style={{
                background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))",
                boxShadow: "var(--shadow-accent)"
              }}
            >
              {/* Power LED */}
              <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
              <span className="text-xs font-bold">R</span>
            </div>
            <div className="hidden min-w-0 lg:block">
              <h1 className="truncate text-base font-display" style={{ color: "var(--foreground)" }}>
                {t(language, "shell.reception")}
              </h1>
            </div>
          </div>

          <GlobalSearch language={language} isRtl={isRtl} canSearchPatients={canSearchPatients} canSearchRegistrations={canSearchRegistrations} onPatientSelect={onPatientSearchSelect} onRegistrationSelect={onRegistrationSearchSelect} />
        </div>

        {/* Center page banner */}
        {pageTitle && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
            <div
              className="max-w-[88vw] overflow-hidden rounded-full border px-3 py-1 text-center shadow-sm sm:max-w-[42vw] sm:px-4"
              style={{
                backgroundColor: "var(--card)",
                borderColor: "var(--border)"
              }}
            >
              <span className="block truncate text-sm font-semibold text-foreground">
                {pageTitle}
              </span>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className={`flex flex-shrink-0 items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          {pageAction && <div className="pointer-events-auto">{pageAction}</div>}
          {extraActions}

          {/* Undo */}
          {!pageAction && (
            <>
              <button
                className="btn-ghost hidden lg:inline-flex"
                onClick={onUndo}
                aria-label={t(language, "navPanel.undo")}
              >
                <Undo2 className="w-4 h-4" />
              </button>

              <button
                className="btn-ghost hidden lg:inline-flex"
                onClick={onRedo}
                aria-label={t(language, "navPanel.redo")}
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Language toggle */}
          <button
            className="btn-ghost hidden text-xs font-mono lg:inline-flex"
            onClick={onToggleLanguage}
          >
            <Languages className="w-4 h-4" />
            {isRtl ? "EN" : "عربي"}
          </button>

          {/* User badge */}
          {user && (
            <div
              className="hidden items-center gap-3 rounded-xl border px-3 py-1.5 md:flex"
              style={{
                backgroundColor: "var(--card)",
                borderColor: "var(--border)",
                boxShadow: "var(--shadow-sm)"
              }}
            >
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-xs font-bold relative"
                style={{
                  background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))",
                  boxShadow: "var(--shadow-accent-sm)"
                }}
              >
                {user.fullName?.trim()?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="leading-tight">
                <span className="block text-sm font-medium" style={{ color: "var(--foreground)" }}>
                  {user.fullName}
                </span>
                <span className="block text-[10px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
                  {user.role}
                </span>
              </div>
            </div>
          )}

          {/* Logout */}
          <button
            className="btn-ghost hidden text-xs lg:inline-flex"
            style={{ color: "var(--accent)" }}
            onClick={onLogout}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

export function SideNav({
  currentRoute,
  user,
  language,
  isRtl,
  collapsed = false,
  onToggleCollapsed,
  onNavigate
}: {
  currentRoute: string;
  user: User | null;
  language: Language;
  isRtl: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate: (route: string) => void;
}) {
  const { data: pageVisibilityMatrix } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });
  const matrix = normalizePageVisibilityMatrix(pageVisibilityMatrix ?? DEFAULT_PAGE_VISIBILITY_MATRIX);
  const visibleGroups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canAccess({ route: item.accessRoute ?? item.route }, user, matrix)),
  })).filter((group) => group.items.length > 0);
  const reportingPreferenceKey = "rispro-sidebar-section-reporting";
  const [expandedGroups, setExpandedGroups] = useState<Record<SidebarGroupKey, boolean>>(() => {
    const savedReporting = localStorage.getItem(reportingPreferenceKey);
    return Object.fromEntries(SIDEBAR_GROUPS.map((group) => [
      group.key,
      group.key === "reporting" && savedReporting != null ? savedReporting === "true" : group.defaultExpanded,
    ])) as Record<SidebarGroupKey, boolean>;
  });

  useEffect(() => {
    const activeGroup = visibleGroups.find((group) => group.items.some((item) => item.route === currentRoute));
    if (activeGroup && !expandedGroups[activeGroup.key]) {
      setExpandedGroups((current) => ({ ...current, [activeGroup.key]: true }));
    }
  }, [currentRoute, visibleGroups, expandedGroups]);

  const toggleGroup = (groupKey: SidebarGroupKey) => {
    setExpandedGroups((current) => {
      const next = { ...current, [groupKey]: !current[groupKey] };
      if (groupKey === "reporting") localStorage.setItem(reportingPreferenceKey, String(next[groupKey]));
      return next;
    });
  };

  return (
    <nav
      className={`nav-shell hidden h-full min-h-full flex-col transition-[width] duration-200 lg:flex ${collapsed ? "w-[68px]" : "w-[240px]"}`}
      style={{
        backgroundImage: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--background)) 0%, var(--background) 18%, var(--background) 100%)",
        backgroundColor: "var(--background)",
        borderRight: isRtl ? "none" : "1px solid var(--border)",
        borderLeft: isRtl ? "1px solid var(--border)" : "none"
      }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-3" style={{ borderColor: "var(--border)" }}>
        {!collapsed ? <span className="truncate text-sm font-semibold text-foreground">{t(language, "shell.reception")}</span> : <span className="mx-auto text-sm font-semibold text-accent">R</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <div className="space-y-2">
          {visibleGroups.map((group) => <SidebarSection key={group.key} group={group} items={group.items} expanded={expandedGroups[group.key]} collapsed={collapsed} currentRoute={currentRoute} isRtl={isRtl} language={language} onToggle={() => toggleGroup(group.key)} onNavigate={onNavigate} />)}
        </div>
      </div>

      <div className={`shrink-0 border-t p-2.5 ${collapsed ? "space-y-2" : "flex items-center justify-between gap-2"}`} style={{ borderColor: "var(--border)", backgroundColor: "var(--muted)" }}>
        {!collapsed ? <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" /><span className="truncate">{t(language, "shell.systemOnline")}</span></div> : null}
        {onToggleCollapsed ? <button type="button" className="flex h-8 items-center justify-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-background hover:text-foreground" onClick={onToggleCollapsed} aria-label={t(language, "shell.toggleNav")} title={t(language, "shell.toggleNav")}>
          {isRtl ? (collapsed ? <ChevronLeft size={17} /> : <ChevronRight size={17} />) : (collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />)}
        </button> : null}
      </div>
    </nav>
  );
}

export function MobileDrawer({
  isOpen,
  currentRoute,
  user,
  language,
  isRtl,
  onNavigate,
  onClose,
  onToggleLanguage,
  onLogout,
  accountActions
}: {
  isOpen: boolean;
  currentRoute: string;
  user: User | null;
  language: Language;
  isRtl: boolean;
  onNavigate: (route: string) => void;
  onClose: () => void;
  onToggleLanguage: () => void;
  onLogout: () => void;
  accountActions?: ReactNode;
}) {
  const { data: pageVisibilityMatrix } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });
  const matrix = normalizePageVisibilityMatrix(pageVisibilityMatrix ?? DEFAULT_PAGE_VISIBILITY_MATRIX);
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user, matrix));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Drawer panel */}
      <div
        className={`absolute top-0 bottom-0 w-72 overflow-y-auto shadow-xl ${isRtl ? "right-0" : "left-0"}`}
        style={{
          backgroundColor: "var(--background)",
          boxShadow: "var(--shadow-xl)"
        }}
        dir={isRtl ? "rtl" : "ltr"}
      >
        {/* Header with close button */}
        <div className="p-3 relative" style={{ borderBottom: "1px solid var(--border)" }}>
          <PanelHeader language={language} isRtl={isRtl} />
          <button
            className={`absolute top-3 p-2 rounded-lg border transition-all duration-150 ${isRtl ? "left-3" : "right-3"}`}
            style={{
              color: "var(--muted-foreground)",
              backgroundColor: "transparent",
              borderColor: "var(--border)"
            }}
            onClick={onClose}
            aria-label={t(language, "shell.closeNavigation")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation items */}
        <div className="p-2.5 space-y-1.5">
          {visibleItems.map((item, index) => (
            <NavButton
              key={item.route}
              item={item}
              isActive={currentRoute === item.route}
              label={t(language, item.labelKey)}
              isRtl={isRtl}
              index={index}
              onClick={() => {
                onNavigate(item.route);
                onClose();
              }}
            />
          ))}
        </div>

        <div className="mt-2 space-y-2 border-t p-3" style={{ borderColor: "var(--border)" }}>
          {user ? (
            <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2" style={{ borderColor: "var(--border)" }}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))" }}>
                {user.fullName?.trim()?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0 text-start">
                <p className="truncate text-sm font-medium text-foreground">{user.fullName}</p>
                <p className="truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{user.role}</p>
              </div>
            </div>
          ) : null}
          <button type="button" className="flex w-full items-center justify-start rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted" style={{ borderColor: "var(--border)" }} onClick={onToggleLanguage}>
            <Languages className="me-2 h-4 w-4" />
            {isRtl ? "English" : "العربية"}
          </button>
          {accountActions}
          <button type="button" className="flex w-full items-center justify-start rounded-lg border px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-muted" style={{ borderColor: "var(--border)" }} onClick={onLogout}>
            <LogOut className="me-2 h-4 w-4" />
            {t(language, "common.signOut")}
          </button>
        </div>

        {/* Footer */}
        <div
          className="p-3 text-center border-t mt-2"
          style={{ borderColor: "var(--border)" }}
        >
          <StatusFooter language={language} label={t(language, "shell.systemOperational")} />
        </div>
      </div>
    </div>
  );
}
