import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { User } from "@/types/api";
import { t, type Language } from "@/lib/i18n";
import {
  canRoleAccessRoute,
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  normalizePageVisibilityMatrix,
  type PageVisibilityMatrix
} from "@/lib/page-visibility";
import { fetchPageVisibilityMatrix } from "@/lib/api-hooks";
import {
  LayoutGrid,
  Users,
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
  Undo2,
  Redo2,
  Languages,
  LogOut
} from "lucide-react";

type NavIcon =
  | "dashboard"
  | "patients"
  | "appointments"
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
  | "settings"
  | "legacy";

interface NavItemConfig {
  route: string;
  labelKey:
    | "nav.dashboard"
    | "nav.patients"
    | "nav.appointments"
    | "nav.appointmentsV2Admin"
    | "nav.calendar"
    | "nav.registrations"
    | "nav.queue"
    | "nav.queueCheckIn"
    | "nav.modality"
    | "nav.doctor"
    | "nav.print"
    | "nav.statistics"
    | "nav.pacs"
    | "nav.pacsRemap"
    | "nav.settings"
    | "nav.legacyReception";
  icon: NavIcon;
  roles?: string[];
}

export const NAV_ITEMS: NavItemConfig[] = [
  { route: "dashboard", labelKey: "nav.dashboard", icon: "dashboard" },
  { route: "patients", labelKey: "nav.patients", icon: "patients" },
  { route: "appointments", labelKey: "nav.appointments", icon: "appointments" },
  { route: "v2.appointments.admin", labelKey: "nav.appointmentsV2Admin", icon: "appointmentsV2Admin", roles: ["supervisor", "super_admin"] },
  { route: "calendar", labelKey: "nav.calendar", icon: "calendar" },
  { route: "registrations", labelKey: "nav.registrations", icon: "registrations" },
  { route: "queue", labelKey: "nav.queue", icon: "queue" },
  { route: "queue.checkin", labelKey: "nav.queueCheckIn", icon: "queueCheckIn" },
  { route: "modality", labelKey: "nav.modality", icon: "modality" },
  { route: "doctor", labelKey: "nav.doctor", icon: "doctor" },
  { route: "print", labelKey: "nav.print", icon: "print" },
  { route: "statistics", labelKey: "nav.statistics", icon: "statistics" },
  { route: "pacs", labelKey: "nav.pacs", icon: "pacs" },
  { route: "pacs.remap", labelKey: "nav.pacsRemap", icon: "pacsRemap" },
  { route: "legacy", labelKey: "nav.legacyReception", icon: "legacy" },
  { route: "settings", labelKey: "nav.settings", icon: "settings", roles: ["super_admin"] }
];

function canAccess(item: NavItemConfig, user: User | null, matrix: PageVisibilityMatrix): boolean {
  if (!user) return false;

  if (item.route === "settings" && user.role === "super_admin") {
    return true;
  }

  if (canRoleAccessRoute(matrix, item.route, user.role)) {
    return true;
  }
  if (item.route === "pacs.remap" && canRoleAccessRoute(matrix, "pacs", user.role)) {
    return true;
  }

  if (!item.roles) return false;
  return item.roles.includes(user.role);
}

const ICON_MAP: Record<NavIcon, typeof LayoutGrid> = {
  dashboard: LayoutGrid,
  patients: Users,
  appointments: CalendarDays,
  appointmentsV2Admin: Settings,
  calendar: ClipboardList,
  registrations: ListOrdered,
  queue: ListOrdered,
  queueCheckIn: ListOrdered,
  modality: Monitor,
  doctor: UserCheck,
  print: Printer,
  statistics: BarChart3,
  pacs: Database,
  pacsRemap: Database,
  settings: Settings,
  legacy: History
};

function NavIconGlyph({ icon, size = 20 }: { icon: NavIcon; size?: number }) {
  const LucideIcon = ICON_MAP[icon];
  return <LucideIcon size={size} strokeWidth={1.5} />;
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

function NavButton({
  item,
  isActive,
  label,
  isRtl,
  index,
  onClick
}: {
  item: NavItemConfig;
  isActive: boolean;
  label: string;
  isRtl: boolean;
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
      className={`nav-item-reveal group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
        isRtl ? "flex-row-reverse text-end" : ""
      }`}
      style={buttonStyle}
      data-active={isActive ? "true" : "false"}
      onClick={onClick}
    >
      <span
        className="flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-200 group-hover:scale-[1.04]"
        style={{
          backgroundColor: isActive ? "var(--accent)" : "color-mix(in srgb, var(--accent) 7%, var(--muted))",
          color: isActive ? "white" : "var(--accent)",
          boxShadow: isActive ? "var(--shadow-accent)" : "none"
        }}
      >
        <NavIconGlyph icon={item.icon} size={16} />
      </span>
      <span className={`flex-1 leading-tight text-[0.72rem] uppercase tracking-[0.08em] ${isRtl ? "text-end" : "text-start"}`}>{label}</span>
      {isActive && (
        <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_6px_var(--accent)]" />
      )}
    </button>
  );
}

export function TopBar({
  user,
  language,
  isRtl,
  pageTitle,
  pageAction,
  onUndo,
  onRedo,
  onToggleLanguage,
  onLogout,
  onMobileNavToggle
}: {
  user: User | null;
  language: Language;
  isRtl: boolean;
  pageTitle?: string;
  pageAction?: ReactNode;
  onUndo: () => void;
  onRedo: () => void;
  onToggleLanguage: () => void;
  onLogout: () => void;
  onMobileNavToggle: () => void;
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
        <div className={`flex items-center gap-3 ${isRtl ? "flex-row-reverse text-end" : ""}`}>
          <div
            className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl text-white relative"
            style={{
              background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))",
              boxShadow: "var(--shadow-accent)"
            }}
          >
            {/* Power LED */}
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            <span className="text-xs font-bold">R</span>
          </div>
          <div>
            <h1 className="text-base font-display" style={{ color: "var(--foreground)" }}>
              {t(language, "shell.reception")}
            </h1>
          </div>
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
        <div className={`flex items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          {pageAction && <div className="pointer-events-auto">{pageAction}</div>}

          {/* Undo */}
          {!pageAction && (
            <>
              <button
                className="btn-ghost"
                onClick={onUndo}
                aria-label={t(language, "navPanel.undo")}
              >
                <Undo2 className="w-4 h-4" />
              </button>

              <button
                className="btn-ghost"
                onClick={onRedo}
                aria-label={t(language, "navPanel.redo")}
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Language toggle */}
          <button
            className="btn-ghost text-xs font-mono"
            onClick={onToggleLanguage}
          >
            <Languages className="w-4 h-4" />
            {isRtl ? "EN" : "عربي"}
          </button>

          {/* User badge */}
          {user && (
            <div
              className="hidden md:flex items-center gap-3 px-3 py-1.5 rounded-xl border"
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
            className="btn-ghost text-xs"
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
  onNavigate
}: {
  currentRoute: string;
  user: User | null;
  language: Language;
  isRtl: boolean;
  onNavigate: (route: string) => void;
}) {
  const { data: pageVisibilityMatrix } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });
  const matrix = normalizePageVisibilityMatrix(pageVisibilityMatrix ?? DEFAULT_PAGE_VISIBILITY_MATRIX);
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user, matrix));

  return (
    <nav
      className="nav-shell hidden lg:flex flex-col w-60 min-h-full overflow-y-auto"
      style={{
        backgroundImage: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 5%, var(--background)) 0%, var(--background) 18%, var(--background) 100%)",
        backgroundColor: "var(--background)",
        borderRight: isRtl ? "none" : "1px solid var(--border)",
        borderLeft: isRtl ? "1px solid var(--border)" : "none"
      }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header panel */}
      <div className="p-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
        <PanelHeader language={language} isRtl={isRtl} />
      </div>

      {/* Navigation items */}
      <div className="p-2.5 space-y-1.5 flex-1">
        {visibleItems.map((item, index) => (
          <NavButton
            key={item.route}
            item={item}
            isActive={currentRoute === item.route}
            label={t(language, item.labelKey)}
            isRtl={isRtl}
            index={index}
            onClick={() => onNavigate(item.route)}
          />
        ))}
      </div>

      {/* Footer status */}
      <div
        className="nav-footer p-2.5 text-center border-t"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--muted)"
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
            {t(language, "shell.mwlActive")}
          </span>
        </div>
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
  onClose
}: {
  isOpen: boolean;
  currentRoute: string;
  user: User | null;
  language: Language;
  isRtl: boolean;
  onNavigate: (route: string) => void;
  onClose: () => void;
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

        {/* Footer */}
        <div
          className="p-3 text-center border-t mt-2"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center justify-center gap-2">
            <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
              {t(language, "shell.systemOperational")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
