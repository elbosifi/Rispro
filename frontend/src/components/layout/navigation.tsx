import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { Role, User } from "@/types/api";
import { t, type Language, type TranslationKey } from "@/lib/i18n";
import {
  canRoleAccessRoute,
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  normalizePageVisibilityMatrix,
  type PageVisibilityMatrix,
  type PageVisibilityRouteKey
} from "@/lib/page-visibility";
import { fetchNoShowSummary, fetchPageVisibilityMatrix } from "@/lib/api-hooks";
import { APP_NAV_ITEMS, type AppNavIcon, type AppNavItem } from "@/lib/route-registry";
import {
  LayoutGrid,
  Clock3,
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
  Plus,
  ChevronDown,
  Globe2,
  Undo2,
  Redo2,
  Languages,
  LogOut
} from "lucide-react";
import { GlobalSearch } from "@/components/search/global-search";
import type { AppointmentWithDetails } from "@/lib/mappers";

const NAV_ITEMS = APP_NAV_ITEMS;

export function NoShowReviewTopBarAction({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["queue", "no-show-summary"], queryFn: fetchNoShowSummary, enabled, refetchInterval: 30_000, staleTime: 15_000, retry: false });
  if (!enabled || !data || (!data.pendingCount && !(data.mode === "automatic" && data.lastAutomaticProcessedCount > 0))) return null;
  const label = data.mode === "manual" ? `No-show review · ${data.pendingCount}` : `No-shows processed · ${data.lastAutomaticProcessedCount}`;
  return <button type="button" onClick={() => navigate("/queue/no-shows")} className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900 shadow-sm dark:bg-amber-950/30 dark:text-amber-100" aria-label={label} title={label}><Clock3 size={14}/><span className="hidden max-w-[11rem] truncate sm:inline">{label}</span></button>;
}

function canAccess(item: Pick<AppNavItem, "route">, user: User | null, matrix: PageVisibilityMatrix): boolean {
  if (!user) return false;

  if (item.route === "settings" && user.role === "super_admin") {
    return true;
  }

  return canRoleAccessRoute(matrix, item.route, user.role);
}

const ROLE_LABEL_KEYS: Record<Role, TranslationKey> = {
  receptionist: "role.receptionist",
  supervisor: "role.supervisor",
  super_admin: "role.superAdministrator",
  modality_staff: "role.modalityStaff",
  doctor: "role.doctor",
  administrative: "role.administrative",
};

function readableRole(language: Language, role: Role): string {
  return t(language, ROLE_LABEL_KEYS[role]);
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
  showTooltip = true,
  index,
  onClick
}: {
  item: AppNavItem;
  isActive: boolean;
  label: string;
  isRtl: boolean;
  collapsed?: boolean;
  showTooltip?: boolean;
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
      title={collapsed && showTooltip ? label : undefined}
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

type SidebarGroupKey = "quick" | "reception" | "clinical" | "reporting" | "administration" | "systems" | "other";
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
    group("reception", "navGroup.frontDesk", [["patients", "nav.patients"], ["calendar"], ["registrations"], ["queue"]], true),
    group("clinical", "navGroup.clinicalWorkflow", [["modality"], ["pacs.remap"], ["comparisons"], ["queue.checkin"]], true),
    group("reporting", "navGroup.reporting", [["print"], ["statistics"]], false),
    group("administration", "navGroup.administration", [["scheduling.override.requests"], ["v2.appointments.admin"], ["patients.merge"], ["name.dictionary"], ["settings"]], false),
    group("systems", "navGroup.systems", [["pacs"], ["worklist.monitor"]], false),
    group("other", "navGroup.legacyFallback", [["legacy"]], false),
  ];
}

const SIDEBAR_GROUPS = buildSidebarGroups();
const DASHBOARD_ITEM = sidebarItem("dashboard");

function QuickActionsSection({ items, collapsed, currentRoute, isRtl, language, onNavigate, showTooltips = true, idPrefix = "sidebar" }: {
  items: SidebarItem[];
  collapsed: boolean;
  currentRoute: string;
  isRtl: boolean;
  language: Language;
  onNavigate: (route: string) => void;
  showTooltips?: boolean;
  idPrefix?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  const menuId = `${idPrefix}-quick-actions-menu`;
  const labelId = `${idPrefix}-quick-actions-label`;
  return (
    <section className="space-y-1 border-b pb-3" style={{ borderColor: "var(--border)" }} aria-labelledby={collapsed ? undefined : labelId} aria-label={collapsed ? t(language, "navGroup.quickActions") : undefined}>
      {!collapsed ? <span id={labelId} className="block px-3 py-1 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground">{t(language, "navGroup.quickActions")}</span> : null}
      <div className="relative">
        <button type="button" className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${collapsed ? "justify-center px-2" : "justify-between"}`} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls={menuId} aria-label={t(language, "nav.newAction")} title={collapsed && showTooltips ? t(language, "nav.newAction") : undefined}>
          <span className="flex items-center gap-2"><Plus className="h-4 w-4" aria-hidden="true" /><span className={collapsed ? "sr-only" : ""}>{t(language, "nav.newAction")}</span></span>
          {!collapsed ? <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : isRtl ? "rotate-180" : ""}`} aria-hidden="true" /> : null}
        </button>
        {open ? <div id={menuId} className={`${collapsed ? `absolute top-0 z-20 w-44 rounded-lg border bg-background p-1 shadow-lg ${isRtl ? "right-full me-2" : "left-full ms-2"}` : "mt-1 space-y-1 rounded-lg bg-muted/40 p-1"}`} role="menu">
          {items.map((item) => <button key={item.route} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-start text-sm font-medium text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { onNavigate(item.route); setOpen(false); }} aria-current={currentRoute === item.route ? "page" : undefined}><span className="flex h-5 w-5 shrink-0 items-center justify-center text-accent"><NavIconGlyph icon={item.icon} size={15} /></span><span className="truncate">{t(language, item.labelKey)}</span></button>)}
        </div> : null}
      </div>
    </section>
  );
}

function SidebarSection({ group, items, expanded, collapsed, currentRoute, isRtl, language, onToggle, onNavigate, showTooltips = true, idPrefix = "sidebar" }: {
  group: (typeof SIDEBAR_GROUPS)[number];
  items: SidebarItem[];
  expanded: boolean;
  collapsed: boolean;
  currentRoute: string;
  isRtl: boolean;
  language: Language;
  onToggle: () => void;
  onNavigate: (route: string) => void;
  showTooltips?: boolean;
  idPrefix?: string;
}) {
  if (!items.length || group.key === "quick") return null;
  const sectionId = `${idPrefix}-section-${group.key}`;
  return (
    <section className="space-y-1 pt-2 first:pt-0" aria-labelledby={collapsed ? undefined : `${sectionId}-label`} aria-label={collapsed ? t(language, group.labelKey) : undefined}>
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
          {expanded ? <ChevronRight className="h-3.5 w-3.5 rotate-90" aria-hidden="true" /> : <ChevronRight className={`h-3.5 w-3.5 ${isRtl ? "rotate-180" : ""}`} aria-hidden="true" />}
        </button>
      )}
      <div id={sectionId} className={`${collapsed || expanded ? "space-y-0.5" : "hidden"}`}>
        {items.map((item, index) => (
          <NavButton key={`${group.key}-${item.route}`} item={item} isActive={currentRoute === item.route} label={t(language, item.labelKey)} isRtl={isRtl} collapsed={collapsed} showTooltip={showTooltips} index={index} onClick={() => onNavigate(item.route)} />
        ))}
      </div>
    </section>
  );
}

function useCloseOnOutside(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [enabled, onClose, ref]);
}

function SidebarNavigationContent({ visibleGroups, visibleDashboard, expandedGroups, collapsed, currentRoute, isRtl, language, onToggleGroup, onNavigate, showTooltips, idPrefix }: {
  visibleGroups: Array<(typeof SIDEBAR_GROUPS)[number] & { items: SidebarItem[] }>;
  visibleDashboard: SidebarItem | null;
  expandedGroups: Record<SidebarGroupKey, boolean>;
  collapsed: boolean;
  currentRoute: string;
  isRtl: boolean;
  language: Language;
  onToggleGroup: (groupKey: SidebarGroupKey) => void;
  onNavigate: (route: string) => void;
  showTooltips: boolean;
  idPrefix: string;
}) {
  const quickGroup = visibleGroups.find((group) => group.key === "quick");
  return (
    <div className="space-y-2">
      {quickGroup ? <QuickActionsSection items={quickGroup.items} collapsed={collapsed} currentRoute={currentRoute} isRtl={isRtl} language={language} onNavigate={onNavigate} showTooltips={showTooltips} idPrefix={idPrefix} /> : null}
      {visibleDashboard ? <NavButton item={visibleDashboard} isActive={currentRoute === visibleDashboard.route} label={t(language, visibleDashboard.labelKey)} isRtl={isRtl} collapsed={collapsed} showTooltip={showTooltips} index={0} onClick={() => onNavigate(visibleDashboard.route)} /> : null}
      {visibleGroups.filter((group) => group.key !== "quick").map((group) => <SidebarSection key={group.key} group={group} items={group.items} expanded={expandedGroups[group.key]} collapsed={collapsed} currentRoute={currentRoute} isRtl={isRtl} language={language} onToggle={() => onToggleGroup(group.key)} onNavigate={onNavigate} showTooltips={showTooltips} idPrefix={idPrefix} />)}
    </div>
  );
}

function HistoryMenu({ language, onUndo, onRedo }: { language: Language; onUndo: () => void; onRedo: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, () => setOpen(false), open);
  return (
    <div ref={ref} className="relative hidden lg:block">
      <button type="button" className="btn-ghost" onClick={() => setOpen((value) => !value)} aria-label={t(language, "topbar.history")} aria-expanded={open} aria-haspopup="menu" title={t(language, "topbar.history")}>
        <History className="h-4 w-4" />
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {open ? <div role="menu" className="absolute end-0 top-full z-50 mt-2 min-w-40 rounded-xl border bg-card p-1 shadow-xl" style={{ borderColor: "var(--border)" }}>
        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { onUndo(); setOpen(false); }}><Undo2 className="h-4 w-4" />{t(language, "navPanel.undo")}</button>
        <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { onRedo(); setOpen(false); }}><Redo2 className="h-4 w-4" />{t(language, "navPanel.redo")}</button>
      </div> : null}
    </div>
  );
}

function LanguageControl({ language, isRtl, onToggle }: { language: Language; isRtl: boolean; onToggle: () => void }) {
  return <div className="hidden lg:block"><button type="button" className="btn-ghost gap-1.5 text-xs" onClick={onToggle} aria-label={t(language, language === "ar" ? "topbar.switchToEnglish" : "topbar.switchToArabic")} title={t(language, language === "ar" ? "topbar.switchToEnglish" : "topbar.switchToArabic")}><Globe2 className="h-4 w-4" /><span>{isRtl ? "العربية" : "English"}</span></button></div>;
}

function AccountMenu({ user, language, accountActions, canAccessSettings, onSettings, onLogout }: { user: User; language: Language; accountActions?: ReactNode; canAccessSettings: boolean; onSettings: () => void; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, () => setOpen(false), open);
  const initials = user.fullName?.trim()?.charAt(0)?.toUpperCase() || "U";
  return (
    <div ref={ref} className="relative hidden lg:block">
      <button type="button" className="flex items-center gap-2 rounded-xl border px-2 py-1.5 text-start transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" style={{ borderColor: "var(--border)" }} onClick={() => setOpen((value) => !value)} aria-label={t(language, "topbar.accountMenu")} aria-expanded={open} aria-haspopup="menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))" }}>{initials}</span>
        <span className="hidden max-w-32 min-w-0 md:block"><span className="block truncate text-sm font-medium text-foreground">{user.fullName}</span><span className="block truncate text-[10px] text-muted-foreground">{readableRole(language, user.role)}</span></span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? <div role="menu" className="absolute end-0 top-full z-50 mt-2 min-w-60 rounded-xl border bg-card p-2 shadow-xl" style={{ borderColor: "var(--border)" }}>
        <div className="border-b px-3 pb-2 text-start" style={{ borderColor: "var(--border)" }}><p className="truncate text-sm font-semibold text-foreground">{user.fullName}</p><p className="text-xs text-muted-foreground">{readableRole(language, user.role)}</p></div>
        {accountActions}
        {canAccessSettings ? <button type="button" role="menuitem" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { onSettings(); setOpen(false); }}><Settings className="h-4 w-4" />{t(language, "common.settings")}</button> : null}
        <button type="button" role="menuitem" className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-start text-accent hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => { onLogout(); setOpen(false); }}><LogOut className="h-4 w-4" />{t(language, "common.signOut")}</button>
      </div> : null}
    </div>
  );
}

export function WorkspaceSwitcher({ language, currentWorkspace, canAccessDoctorWorkspace, canAccessCoreWorkspace = true, onNavigate }: {
  language: Language;
  currentWorkspace: "core" | "doctor";
  canAccessDoctorWorkspace: boolean;
  canAccessCoreWorkspace?: boolean;
  onNavigate: (path: "/dashboard" | "/doctor/my-work") => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutside(ref, () => setOpen(false), open);

  if (!canAccessDoctorWorkspace) return null;

  const currentLabel = t(language, currentWorkspace === "doctor" ? "workspace.doctor" : "workspace.core");
  const workspaces: readonly ("core" | "doctor")[] = canAccessCoreWorkspace ? ["core", "doctor"] : ["doctor"];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        style={{ borderColor: "var(--border)" }}
        onClick={() => setOpen((value) => !value)}
        aria-label={`${t(language, "workspace.switcher")}: ${currentLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="max-w-32 truncate">{currentLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" className="absolute end-0 top-full z-50 mt-2 min-w-48 rounded-xl border bg-card p-2 shadow-xl" style={{ borderColor: "var(--border)" }}>
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t(language, "workspace.switcher")}</p>
          {workspaces.map((workspace) => {
            const label = t(language, workspace === "doctor" ? "workspace.doctor" : "workspace.core");
            return (
              <button
                key={workspace}
                type="button"
                role="menuitem"
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-start text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                aria-current={currentWorkspace === workspace ? "true" : undefined}
                onClick={() => {
                  onNavigate(workspace === "doctor" ? "/doctor/my-work" : "/dashboard");
                  setOpen(false);
                }}
              >
                <span>{label}</span>
                {currentWorkspace === workspace ? <span className="text-xs text-accent">●</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  user,
  language,
  isRtl,
  pageTitle,
  shellTitle,
  shellSubtitle,
  pageAction,
  extraActions,
  accountMenuActions,
  canAccessSettings = false,
  onSettings = () => {},
  onUndo,
  onRedo,
  onToggleLanguage,
  onLogout,
  onMobileNavToggle,
  canSearchPatients = false,
  canSearchRegistrations = false,
  onPatientSearchSelect = () => {},
  onRegistrationSearchSelect = () => {},
  canAccessDoctorWorkspace = false,
  canAccessCoreWorkspace = true,
  showLanguageControl = true,
  currentWorkspace = "core",
  onWorkspaceNavigate = () => {}
}: {
  user: User | null;
  language: Language;
  isRtl: boolean;
  pageTitle?: string;
  shellTitle?: string;
  shellSubtitle?: string;
  pageAction?: ReactNode;
  extraActions?: ReactNode;
  accountMenuActions?: ReactNode;
  canAccessSettings?: boolean;
  onSettings?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLanguage: () => void;
  onLogout: () => void;
  onMobileNavToggle: () => void;
  canSearchPatients?: boolean;
  canSearchRegistrations?: boolean;
  onPatientSearchSelect?: (patientId: number) => void;
  onRegistrationSearchSelect?: (appointment: AppointmentWithDetails) => void;
  canAccessDoctorWorkspace?: boolean;
  canAccessCoreWorkspace?: boolean;
  showLanguageControl?: boolean;
  currentWorkspace?: "core" | "doctor";
  onWorkspaceNavigate?: (path: "/dashboard" | "/doctor/my-work") => void;
}) {
  return (
    <header className="sticky top-0 z-50 border-b" dir={isRtl ? "rtl" : "ltr"} style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex min-h-[3.5rem] items-center gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button type="button" className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl border border-transparent px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 lg:hidden" onClick={onMobileNavToggle} aria-label={t(language, "shell.toggleNav")} title={t(language, "shell.toggleNav")}><Menu className="h-5 w-5" /></button>
          <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-xs font-bold text-white sm:flex">R</div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{pageTitle || shellTitle || t(language, "shell.reception")}</p>
            {pageTitle || shellSubtitle ? <p className="hidden truncate text-[10px] text-muted-foreground sm:block">{shellSubtitle || t(language, "shell.reception")}</p> : null}
          </div>
          {pageAction ? <div className="shrink-0">{pageAction}</div> : null}
        </div>

        <div className="flex min-w-0 flex-1 justify-center">
          <GlobalSearch language={language} isRtl={isRtl} canSearchPatients={canSearchPatients} canSearchRegistrations={canSearchRegistrations} onPatientSelect={onPatientSearchSelect} onRegistrationSelect={onRegistrationSearchSelect} />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {extraActions}
          {!pageAction ? <HistoryMenu language={language} onUndo={onUndo} onRedo={onRedo} /> : null}
          {showLanguageControl ? <LanguageControl language={language} isRtl={isRtl} onToggle={onToggleLanguage} /> : null}
          <WorkspaceSwitcher language={language} currentWorkspace={currentWorkspace} canAccessDoctorWorkspace={canAccessDoctorWorkspace} canAccessCoreWorkspace={canAccessCoreWorkspace} onNavigate={onWorkspaceNavigate} />
          {user ? <AccountMenu user={user} language={language} accountActions={accountMenuActions} canAccessSettings={canAccessSettings} onSettings={onSettings} onLogout={onLogout} /> : null}
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
  const visibleDashboard = DASHBOARD_ITEM && canAccess(DASHBOARD_ITEM, user, matrix) ? DASHBOARD_ITEM : null;
  const reportingPreferenceKey = "rispro-sidebar-section-reporting";
  const [expandedGroups, setExpandedGroups] = useState<Record<SidebarGroupKey, boolean>>(() => {
    const savedReporting = localStorage.getItem(reportingPreferenceKey);
    return Object.fromEntries(SIDEBAR_GROUPS.map((group) => [
      group.key,
      group.key === "reporting" && savedReporting != null ? savedReporting === "true" : group.defaultExpanded,
    ])) as Record<SidebarGroupKey, boolean>;
  });

  const activeGroup = visibleGroups.find((group) => group.items.some((item) => item.route === currentRoute));
  const visibleExpandedGroups =
    activeGroup && !expandedGroups[activeGroup.key]
      ? { ...expandedGroups, [activeGroup.key]: true }
      : expandedGroups;

  const toggleGroup = (groupKey: SidebarGroupKey) => {
    setExpandedGroups((current) => {
      const next = { ...current, [groupKey]: !current[groupKey] };
      if (groupKey === "reporting") localStorage.setItem(reportingPreferenceKey, String(next[groupKey]));
      return next;
    });
  };

  const [previewOpen, setPreviewOpen] = useState(false);
  const [finePointer, setFinePointer] = useState(() => window.matchMedia?.("(pointer: fine)")?.matches ?? false);
  const railRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearPreviewTimers = useCallback(() => {
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);

  const closePreview = useCallback(() => {
    clearPreviewTimers();
    setPreviewOpen(false);
  }, [clearPreviewTimers]);

  const schedulePreviewOpen = () => {
    if (!collapsed || !finePointer || previewOpen) return;
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setPreviewOpen(true);
    }, 250);
  };

  const schedulePreviewClose = () => {
    if (!collapsed) return;
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setPreviewOpen(false);
    }, 400);
  };

  useEffect(() => {
    const media = window.matchMedia?.("(pointer: fine)");
    if (!media) return;
    const update = () => setFinePointer(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => clearPreviewTimers, [clearPreviewTimers]);

  useEffect(() => {
    if (!collapsed || !previewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePreview, collapsed, previewOpen]);

  const handleToggleCollapsed = () => {
    if (collapsed) closePreview();
    onToggleCollapsed?.();
  };

  const previewVisible = collapsed && previewOpen;

  return (
    <div
      ref={railRef}
      className="relative hidden h-full min-h-full shrink-0 lg:flex"
      data-testid="desktop-sidebar-rail"
      dir={isRtl ? "rtl" : "ltr"}
      onPointerEnter={schedulePreviewOpen}
      onPointerLeave={schedulePreviewClose}
      onMouseEnter={schedulePreviewOpen}
      onMouseLeave={schedulePreviewClose}
      onFocusCapture={() => {
        if (collapsed) setPreviewOpen(true);
      }}
      onBlurCapture={(event) => {
        if (!railRef.current?.contains(event.relatedTarget as Node | null)) schedulePreviewClose();
      }}
    >
      <nav
        className={`nav-shell flex h-full min-h-full flex-col transition-[width] duration-200 motion-reduce:transition-none ${collapsed ? "w-[68px]" : "w-[240px]"}`}
        style={{
          backgroundImage: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--background)) 0%, var(--background) 18%, var(--background) 100%)",
          backgroundColor: "var(--background)",
          borderRight: isRtl ? "none" : "1px solid var(--border)",
          borderLeft: isRtl ? "1px solid var(--border)" : "none"
        }}
        dir={isRtl ? "rtl" : "ltr"}
        aria-label={t(language, "shell.menu")}
      >
        {onToggleCollapsed ? <div className={`shrink-0 p-2 ${isRtl ? "flex justify-start" : "flex justify-end"}`}>
          <button type="button" className="flex h-10 min-w-10 items-center justify-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 active:scale-95" onClick={handleToggleCollapsed} aria-label={t(language, collapsed ? "shell.expandNavigation" : "shell.collapseNavigation")} aria-expanded={!collapsed} aria-controls="desktop-sidebar-navigation" title={t(language, collapsed ? "shell.expandNavigation" : "shell.collapseNavigation")}>
            {isRtl ? (collapsed ? <ChevronLeft size={18} /> : <ChevronRight size={18} />) : (collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />)}
          </button>
        </div> : null}
        <div id="desktop-sidebar-navigation" className="min-h-0 flex-1 overflow-y-auto p-2.5">
          <SidebarNavigationContent visibleGroups={visibleGroups} visibleDashboard={visibleDashboard} expandedGroups={visibleExpandedGroups} collapsed={collapsed} currentRoute={currentRoute} isRtl={isRtl} language={language} onToggleGroup={toggleGroup} onNavigate={onNavigate} showTooltips={!previewVisible} idPrefix="sidebar" />
        </div>
        <div className={`shrink-0 border-t p-2.5 ${collapsed ? "flex justify-center" : "flex items-center justify-between gap-2"}`} style={{ borderColor: "var(--border)", backgroundColor: "var(--muted)" }}>
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />{!collapsed ? <span className="truncate">{t(language, "shell.systemOnline")}</span> : null}</div>
        </div>
      </nav>

      {previewVisible ? <aside data-testid="desktop-sidebar-preview" className={`absolute inset-y-0 z-40 w-[240px] border bg-background shadow-xl motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-reduce:transition-none ${isRtl ? "end-full me-2" : "start-full ms-2"}`} style={{ borderColor: "var(--border)" }} aria-label={t(language, "shell.menu")} onPointerEnter={() => { if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current); }} onPointerLeave={schedulePreviewClose} onMouseEnter={() => { if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current); }} onMouseLeave={schedulePreviewClose}>
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
            <SidebarNavigationContent visibleGroups={visibleGroups} visibleDashboard={visibleDashboard} expandedGroups={visibleExpandedGroups} collapsed={false} currentRoute={currentRoute} isRtl={isRtl} language={language} onToggleGroup={toggleGroup} onNavigate={onNavigate} showTooltips={false} idPrefix="sidebar-preview" />
          </div>
        </div>
      </aside> : null}
    </div>
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
  const visibleItems = NAV_ITEMS.filter((item) => item.route !== "doctor" && canAccess(item, user, matrix));

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
