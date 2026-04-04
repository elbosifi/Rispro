import type { User } from "@/types/api";

interface NavItemConfig {
  route: string;
  labelEn: string;
  labelAr: string;
  icon: string;
  roles?: string[];
}

export const NAV_ITEMS: NavItemConfig[] = [
  { route: "dashboard", labelEn: "Dashboard", labelAr: "لوحة التحكم", icon: "📊" },
  { route: "patients", labelEn: "Register patient", labelAr: "تسجيل مريض", icon: "👤" },
  { route: "appointments", labelEn: "Create appointment", labelAr: "إنشاء موعد", icon: "📅" },
  { route: "calendar", labelEn: "Calendar", labelAr: "التقويم", icon: "🗓️" },
  { route: "registrations", labelEn: "Registrations", labelAr: "التسجيلات", icon: "📋" },
  { route: "queue", labelEn: "Queue", labelAr: "قائمة الانتظار", icon: "🚶" },
  { route: "modality", labelEn: "Modality board", labelAr: "لوحة الأجهزة", icon: "🖥️", roles: ["modality_staff", "supervisor"] },
  { route: "doctor", labelEn: "Doctor home", labelAr: "صفحة الطبيب", icon: "🩺" },
  { route: "print", labelEn: "Printing", labelAr: "الطباعة", icon: "🖨️" },
  { route: "statistics", labelEn: "Statistics", labelAr: "الإحصائيات", icon: "📈" },
  { route: "search", labelEn: "Search patients", labelAr: "بحث المرضى", icon: "🔍" },
  { route: "pacs", labelEn: "PACS", labelAr: "أرشيف الصور", icon: "🏥" },
  { route: "settings", labelEn: "Settings", labelAr: "الإعدادات", icon: "⚙️", roles: ["supervisor"] }
];

function canAccess(item: NavItemConfig, user: User | null): boolean {
  if (!item.roles) return true;
  if (!user) return false;
  return item.roles.includes(user.role);
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
  language: "ar" | "en";
  onToggleLanguage: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  onMobileNavToggle: () => void;
}) {
  const isRtl = language === "ar";

  return (
    <header className="sticky top-0 z-50 border-b" style={{ backgroundColor: "var(--surface-strong)", borderColor: "var(--line)" }}>
      <div className="flex items-center justify-between h-16 px-4">
        <button
          className="lg:hidden p-2 rounded-lg hover:opacity-80"
          style={{ color: "var(--text)" }}
          onClick={onMobileNavToggle}
          aria-label="Toggle navigation"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold" style={{ color: "var(--teal)" }}>
            {isRtl ? "الاستقبال" : "Reception"}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-lg transition-opacity hover:opacity-80"
            style={{ backgroundColor: "var(--bg-soft)", color: "var(--muted)" }}
            onClick={onToggleLanguage}
          >
            {isRtl ? "EN" : "عربي"}
          </button>

          <button
            className="p-2 rounded-lg transition-opacity hover:opacity-80"
            style={{ color: "var(--muted)" }}
            onClick={onToggleTheme}
            aria-label="Toggle theme"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </button>

          {user && (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: "var(--bg-soft)" }}>
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {user.fullName}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--teal)", color: "white" }}>
                {user.role}
              </span>
            </div>
          )}

          <button
            className="px-3 py-1.5 text-sm rounded-lg transition-opacity hover:opacity-80"
            style={{ backgroundColor: "var(--red)", color: "white" }}
            onClick={onLogout}
          >
            {isRtl ? "تسجيل خروج" : "Sign out"}
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
  language: "ar" | "en";
  onNavigate: (route: string) => void;
}) {
  const isRtl = language === "ar";
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user));

  return (
    <nav
      className="hidden lg:flex flex-col w-64 min-h-full border-e overflow-y-auto"
      style={{ backgroundColor: "var(--surface)", borderColor: "var(--line)" }}
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="p-4 space-y-1">
        {visibleItems.map((item) => {
          const isActive = currentRoute === item.route;
          return (
            <button
              key={item.route}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive ? "shadow-sm" : "hover:opacity-80"
              }`}
              style={{
                backgroundColor: isActive ? "var(--teal)" : "transparent",
                color: isActive ? "white" : "var(--text)"
              }}
              onClick={() => onNavigate(item.route)}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{isRtl ? item.labelAr : item.labelEn}</span>
            </button>
          );
        })}
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
  language: "ar" | "en";
  onNavigate: (route: string) => void;
  onClose: () => void;
}) {
  const isRtl = language === "ar";
  const visibleItems = NAV_ITEMS.filter((item) => canAccess(item, user));

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className={`absolute top-0 ${isRtl ? "right-0" : "left-0"} bottom-0 w-72 overflow-y-auto`}
        style={{ backgroundColor: "var(--surface-strong)" }}
        dir={isRtl ? "rtl" : "ltr"}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-lg font-bold" style={{ color: "var(--teal)" }}>
            {isRtl ? "القائمة" : "Menu"}
          </h2>
          <button
            className="p-2 rounded-lg hover:opacity-80"
            style={{ color: "var(--muted)" }}
            onClick={onClose}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-1">
          {visibleItems.map((item) => {
            const isActive = currentRoute === item.route;
            return (
              <button
                key={item.route}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive ? "shadow-sm" : "hover:opacity-80"
                }`}
                style={{
                  backgroundColor: isActive ? "var(--teal)" : "transparent",
                  color: isActive ? "white" : "var(--text)"
                }}
                onClick={() => {
                  onNavigate(item.route);
                  onClose();
                }}
              >
                <span className="text-lg">{item.icon}</span>
                <span>{isRtl ? item.labelAr : item.labelEn}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
