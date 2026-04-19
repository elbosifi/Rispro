import type { User } from "@/types/api";
import { t, type Language } from "@/lib/i18n";
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
  | "modality"
  | "doctor"
  | "print"
  | "statistics"
  | "pacs"
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
    | "nav.modality"
    | "nav.doctor"
    | "nav.print"
    | "nav.statistics"
    | "nav.pacs"
    | "nav.settings"
    | "nav.legacyReception";
  icon: NavIcon;
  roles?: string[];
}

export const NAV_ITEMS: NavItemConfig[] = [
  { route: "dashboard", labelKey: "nav.dashboard", icon: "dashboard" },
  { route: "patients", labelKey: "nav.patients", icon: "patients" },
  { route: "appointments", labelKey: "nav.appointments", icon: "appointments" },
  { route: "v2.appointments.admin", labelKey: "nav.appointmentsV2Admin", icon: "appointmentsV2Admin", roles: ["supervisor"] },
  { route: "calendar", labelKey: "nav.calendar", icon: "calendar" },
  { route: "registrations", labelKey: "nav.registrations", icon: "registrations" },
  { route: "queue", labelKey: "nav.queue", icon: "queue" },
  { route: "modality", labelKey: "nav.modality", icon: "modality" },
  { route: "doctor", labelKey: "nav.doctor", icon: "doctor" },
  { route: "print", labelKey: "nav.print", icon: "print" },
  { route: "statistics", labelKey: "nav.statistics", icon: "statistics" },
  { route: "pacs", labelKey: "nav.pacs", icon: "pacs" },
  { route: "legacy", labelKey: "nav.legacyReception", icon: "legacy" },
  { route: "settings", labelKey: "nav.settings", icon: "settings", roles: ["supervisor"] }
];

function canAccess(item: NavItemConfig, user: User | null): boolean {
  if (!item.roles) return true;
  if (!user) return false;
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
  modality: Monitor,
  doctor: UserCheck,
  print: Printer,
  statistics: BarChart3,
  pacs: Database,
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
      className={`rounded-xl p-6 text-white relative overflow-hidden ${isRtl ? "text-center" : ""}`}
      style={{
        background: "linear-gradient(135deg, var(--accent), var(--accent-secondary))",
        boxShadow: "var(--shadow-accent-lg)"
      }}
    >
      <p className="text-xs uppercase tracking-[0.2em] opacity-80 font-mono">{t(language, "shell.menu")}</p>
      <p className="mt-2 text-xl font-display">{t(language, "shell.reception")}</p>
      <div className="flex items-center justify-center gap-2 mt-3">
        <span className="h-2 w-2 rounded-full bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
        <span className="text-xs uppercase tracking-[0.15em] opacity-80 font-mono">SYSTEM ONLINE</span>
      </div>
    </div>
  );
}

function NavButton({
  item,
  isActive,
  label,
  isRtl,
  onClick
}: {
  item: NavItemConfig;
  isActive: boolean;
  label: string;
  isRtl: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`group w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
        isRtl ? "flex-row-reverse text-end" : ""
      }`}
      style={{
        backgroundColor: isActive ? "rgba(0, 82, 255, 0.1)" : "transparent",
        color: isActive ? "var(--accent)" : "var(--foreground)",
        border: isActive ? "1px solid rgba(0, 82, 255, 0.3)" : "1px solid transparent",
        boxShadow: isActive ? "var(--shadow-sm)" : "none"
      }}
      onClick={onClick}
    >
      <span
        className="flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 group-hover:scale-105"
        style={{
          backgroundColor: isActive ? "var(--accent)" : "var(--muted)",
          color: isActive ? "white" : "var(--muted-foreground)",
          boxShadow: isActive ? "var(--shadow-accent)" : "none"
        }}
      >
        <NavIconGlyph icon={item.icon} size={18} />
      </span>
      <span className={`flex-1 leading-tight text-sm uppercase tracking-[0.1em] ${isRtl ? "text-end" : "text-start"}`}>{label}</span>
      {isActive && (
        <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_6px_rgba(0,82,255,0.6)]" />
      )}
    </button>
  );
}

export function TopBar({
  user,
  language,
  isRtl,
  onUndo,
  onRedo,
  onToggleLanguage,
  onLogout,
  onMobileNavToggle
}: {
  user: User | null;
  language: Language;
  isRtl: boolean;
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
      <div className={`flex items-center justify-between h-14 px-4 lg:px-6 gap-3 ${isRtl ? "flex-row-reverse" : ""}`}>
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
            className="hidden sm:flex h-10 w-10 items-center justify-center rounded-xl text-white relative"
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
            <h1 className="text-lg font-display" style={{ color: "var(--foreground)" }}>
              {t(language, "shell.reception")}
            </h1>
          </div>
        </div>

        {/* Actions */}
        <div className={`flex items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          {/* Undo */}
          <button
            className="btn-ghost"
            onClick={onUndo}
            aria-label={t(language, "navPanel.undo")}
          >
            <Undo2 className="w-4 h-4" />
          </button>

          {/* Redo */}
          <button
            className="btn-ghost"
            onClick={onRedo}
            aria-label={t(language, "navPanel.redo")}
          >
            <Redo2 className="w-4 h-4" />
          </button>

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
              className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl border"
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
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user));

  return (
    <nav
      className="hidden lg:flex flex-col w-64 min-h-full overflow-y-auto"
      style={{
        backgroundColor: "var(--background)",
        borderRight: isRtl ? "none" : "1px solid var(--border)",
        borderLeft: isRtl ? "1px solid var(--border)" : "none"
      }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* Header panel */}
      <div className="p-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <PanelHeader language={language} isRtl={isRtl} />
      </div>

      {/* Navigation items */}
      <div className="p-3 space-y-2 flex-1">
        {visibleItems.map((item) => (
          <NavButton
            key={item.route}
            item={item}
            isActive={currentRoute === item.route}
            label={t(language, item.labelKey)}
            isRtl={isRtl}
            onClick={() => onNavigate(item.route)}
          />
        ))}
      </div>

      {/* Footer status */}
      <div
        className="p-3 text-center border-t"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--muted)"
        }}
      >
        <div className="flex items-center justify-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.15em] font-mono text-muted-foreground">
            MWL ACTIVE
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
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user));

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
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation items */}
        <div className="p-3 space-y-2">
          {visibleItems.map((item) => (
            <NavButton
              key={item.route}
              item={item}
              isActive={currentRoute === item.route}
              label={t(language, item.labelKey)}
              isRtl={isRtl}
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
              SYSTEM OPERATIONAL
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
