import type { User } from "@/types/api";
import { t, type Language } from "@/lib/i18n";

type NavIcon =
  | "dashboard"
  | "patients"
  | "appointments"
  | "calendar"
  | "registrations"
  | "queue"
  | "modality"
  | "doctor"
  | "print"
  | "statistics"
  | "search"
  | "pacs"
  | "settings";

interface NavItemConfig {
  route: string;
  labelKey:
    | "nav.dashboard"
    | "nav.patients"
    | "nav.appointments"
    | "nav.calendar"
    | "nav.registrations"
    | "nav.queue"
    | "nav.modality"
    | "nav.doctor"
    | "nav.print"
    | "nav.statistics"
    | "nav.search"
    | "nav.pacs"
    | "nav.settings";
  icon: NavIcon;
  roles?: string[];
}

export const NAV_ITEMS: NavItemConfig[] = [
  { route: "dashboard", labelKey: "nav.dashboard", icon: "dashboard" },
  { route: "patients", labelKey: "nav.patients", icon: "patients" },
  { route: "appointments", labelKey: "nav.appointments", icon: "appointments" },
  { route: "calendar", labelKey: "nav.calendar", icon: "calendar" },
  { route: "registrations", labelKey: "nav.registrations", icon: "registrations" },
  { route: "queue", labelKey: "nav.queue", icon: "queue" },
  { route: "modality", labelKey: "nav.modality", icon: "modality", roles: ["modality_staff", "supervisor"] },
  { route: "doctor", labelKey: "nav.doctor", icon: "doctor" },
  { route: "print", labelKey: "nav.print", icon: "print" },
  { route: "statistics", labelKey: "nav.statistics", icon: "statistics" },
  { route: "search", labelKey: "nav.search", icon: "search" },
  { route: "pacs", labelKey: "nav.pacs", icon: "pacs" },
  { route: "settings", labelKey: "nav.settings", icon: "settings", roles: ["supervisor"] }
];

function canAccess(item: NavItemConfig, user: User | null): boolean {
  if (!item.roles) return true;
  if (!user) return false;
  return item.roles.includes(user.role);
}

function NavIconGlyph({ icon }: { icon: NavIcon }) {
  const common = { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24" };
  switch (icon) {
    case "dashboard":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M3 13h8V3H3v10zm10 8h8V3h-8v18zM3 21h8v-6H3v6z" /></svg>;
    case "patients":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M16 14a4 4 0 10-8 0m8 0a4 4 0 11-8 0m8 0H8m10 7a6 6 0 00-12 0" /></svg>;
    case "appointments":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
    case "calendar":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M7 3v3m10-3v3M4 10h16M5 21h14a1 1 0 001-1V7a1 1 0 00-1-1H5a1 1 0 00-1 1v13a1 1 0 001 1z" /></svg>;
    case "registrations":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6M9 8h6M5 3h14a2 2 0 012 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 012-2z" /></svg>;
    case "queue":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M9 11h6m-6 4h6M4 7h16M6 19h12a2 2 0 002-2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
    case "modality":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M4 6h16v10H4V6zm2 14h12M9 16v4m6-4v4" /></svg>;
    case "doctor":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6m13-7H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2z" /></svg>;
    case "print":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M6 9V4h12v5M6 18h12v2H6v-2zm-2-7h16a2 2 0 012 2v3H2v-3a2 2 0 012-2z" /></svg>;
    case "statistics":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M7 20V10m5 10V6m5 14v-4" /></svg>;
    case "search":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.3-4.3m1.8-5.2a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>;
    case "pacs":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2zm3-7h8" /></svg>;
    case "settings":
      return <svg {...common}><path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M10.3 3.9l.4-1.4h2.6l.4 1.4a1 1 0 00.9.7l1.5.1 1.3-1 1.8 1.8-1 1.3.1 1.5a1 1 0 00.7.9l1.4.4v2.6l-1.4.4a1 1 0 00-.7.9l-.1 1.5 1 1.3-1.8 1.8-1.3-1-1.5.1a1 1 0 00-.9.7l-.4 1.4h-2.6l-.4-1.4a1 1 0 00-.9-.7l-1.5-.1-1.3 1-1.8-1.8 1-1.3-.1-1.5a1 1 0 00-.7-.9l-1.4-.4V10l1.4-.4a1 1 0 00.7-.9l.1-1.5-1-1.3 1.8-1.8 1.3 1 1.5-.1a1 1 0 00.9-.7zM12 15.5A3.5 3.5 0 1012 8a3.5 3.5 0 000 7.5z" /></svg>;
  }
}

function PanelHeader({ language }: { language: Language }) {
  return (
    <div className="rounded-3xl p-4 text-white shadow-sm" style={{ background: "linear-gradient(135deg, var(--teal), var(--teal-strong))" }}>
      <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">{t(language, "shell.menu")}</p>
      <p className="mt-1 text-lg font-bold">{t(language, "shell.reception")}</p>
      <p className="mt-2 text-xs opacity-80 leading-relaxed">
        {language === "ar"
          ? "تنقل سريع بين أقسام الاستقبال والمهام اليومية"
          : "Fast access to reception and daily workflows"}
      </p>
    </div>
  );
}

function NavButton({
  item,
  isActive,
  label,
  onClick
}: {
  item: NavItemConfig;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`group w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-sm font-medium transition-all border ${
        isActive ? "shadow-sm scale-[1.01]" : "hover:shadow-sm hover:-translate-y-[1px]"
      }`}
      style={{
        backgroundColor: isActive ? "var(--teal)" : "var(--surface-strong)",
        color: isActive ? "white" : "var(--text)",
        borderColor: isActive ? "transparent" : "var(--line)"
      }}
      onClick={onClick}
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isActive ? "bg-white/15" : "bg-stone-100 dark:bg-stone-700/60"}`}>
        <NavIconGlyph icon={item.icon} />
      </span>
      <span className="flex-1 text-start leading-tight">{label}</span>
      {isActive && <span className="h-2 w-2 rounded-full bg-white/90" />}
    </button>
  );
}

export function TopBar({
  user,
  language,
  onToggleLanguage,
  onToggleTheme,
  onLogout,
  onMobileNavToggle
}: {
  user: User | null;
  language: Language;
  onToggleLanguage: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  onMobileNavToggle: () => void;
}) {
  const isArabic = language === "ar";

  return (
    <header className="sticky top-0 z-50 border-b backdrop-blur-xl shadow-sm" style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between h-18 px-4 lg:px-6">
        <button
          className="lg:hidden p-2.5 rounded-xl border hover:opacity-90"
          style={{ color: "var(--text)", backgroundColor: "var(--bg-soft)", borderColor: "var(--line)" }}
          onClick={onMobileNavToggle}
          aria-label={t(language, "shell.toggleNav")}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-sm" style={{ background: "linear-gradient(180deg, var(--teal), var(--teal-strong))" }}>
            <span className="text-sm font-bold">R</span>
          </div>
          <div>
            <h1 className="text-xl lg:text-2xl font-extrabold tracking-tight" style={{ color: "var(--teal)" }}>
              {t(language, "shell.reception")}
            </h1>
            <p className="text-[11px] lg:text-xs uppercase tracking-[0.24em]" style={{ color: "var(--muted)" }}>
              Radiology Information System
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-2 text-sm rounded-xl transition-all hover:opacity-90 border"
            style={{ backgroundColor: "var(--bg-soft)", color: "var(--muted)", borderColor: "var(--line)" }}
            onClick={onToggleLanguage}
          >
            {isArabic ? "EN" : "عربي"}
          </button>

          <button
            className="p-2.5 rounded-xl transition-all hover:opacity-90 border"
            style={{ color: "var(--muted)", backgroundColor: "var(--bg-soft)", borderColor: "var(--line)" }}
            onClick={onToggleTheme}
            aria-label={t(language, "shell.toggleTheme")}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>

          {user && (
            <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-2xl border" style={{ backgroundColor: "var(--bg-soft)", borderColor: "var(--line)" }}>
              <div className="flex h-9 w-9 items-center justify-center rounded-full text-white text-sm font-bold" style={{ background: "linear-gradient(180deg, var(--teal), var(--teal-strong))" }}>
                {user.fullName?.trim()?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="leading-tight">
                <span className="block text-sm font-semibold" style={{ color: "var(--text)" }}>
                  {user.fullName}
                </span>
                <span className="block text-[11px] uppercase tracking-[0.18em]" style={{ color: "var(--muted)" }}>
                  {user.role}
                </span>
              </div>
            </div>
          )}

          <button
            className="px-4 py-2 text-sm rounded-xl transition-all hover:opacity-90 shadow-sm"
            style={{ background: "linear-gradient(180deg, var(--red), #991b1b)", color: "white" }}
            onClick={onLogout}
          >
            {t(language, "common.signOut")}
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
  onNavigate
}: {
  currentRoute: string;
  user: User | null;
  language: Language;
  onNavigate: (route: string) => void;
}) {
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user));

  return (
    <nav className="hidden lg:flex flex-col w-72 min-h-full border-e overflow-y-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }} dir="ltr">
      <div className="p-4 border-b" style={{ borderColor: "var(--line)" }}>
        <PanelHeader language={language} />
      </div>

      <div className="p-3 space-y-2">
        {visibleItems.map((item) => (
          <NavButton
            key={item.route}
            item={item}
            isActive={currentRoute === item.route}
            label={t(language, item.labelKey)}
            onClick={() => onNavigate(item.route)}
          />
        ))}
      </div>
    </nav>
  );
}

export function MobileDrawer({
  isOpen,
  currentRoute,
  user,
  language,
  onNavigate,
  onClose
}: {
  isOpen: boolean;
  currentRoute: string;
  user: User | null;
  language: Language;
  onNavigate: (route: string) => void;
  onClose: () => void;
}) {
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute top-0 left-0 bottom-0 w-80 overflow-y-auto shadow-2xl" style={{ backgroundColor: "var(--surface-strong)" }} dir="ltr">
        <div className="p-4 border-b relative" style={{ borderColor: "var(--line)" }}>
          <PanelHeader language={language} />
          <button className="absolute right-4 top-4 p-2.5 rounded-xl hover:opacity-90 border" style={{ color: "var(--muted)", backgroundColor: "var(--surface-strong)", borderColor: "var(--line)" }} onClick={onClose}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-3 space-y-2">
          {visibleItems.map((item) => (
            <NavButton
              key={item.route}
              item={item}
              isActive={currentRoute === item.route}
              label={t(language, item.labelKey)}
              onClick={() => {
                onNavigate(item.route);
                onClose();
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
