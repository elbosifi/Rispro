import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoginPage } from "@/pages/auth/login-page";
import { DashboardPage } from "@/pages/dashboard/dashboard-page";
import { PlaceholderPage } from "@/pages/placeholder/placeholder-page";
import SearchPage from "@/pages/search/search-page";
import PatientsPage from "@/pages/patients/patients-page";
import AppointmentsPage from "@/pages/appointments/appointments-page";
import RegistrationsPage from "@/pages/registrations/registrations-page";
import QueuePage from "@/pages/queue/queue-page";
import { TopBar, SideNav, MobileDrawer } from "@/components/layout/navigation";
import { QueryProvider } from "@/providers/query-provider";

const ROUTE_PATHS: Record<string, string> = {
  dashboard: "/",
  patients: "/patients",
  appointments: "/appointments",
  calendar: "/calendar",
  registrations: "/registrations",
  queue: "/queue",
  modality: "/modality",
  doctor: "/doctor",
  print: "/print",
  statistics: "/statistics",
  search: "/search",
  pacs: "/pacs",
  settings: "/settings"
};

const PATH_TO_ROUTE = Object.fromEntries(
  Object.entries(ROUTE_PATHS).map(([k, v]) => [v === "/" ? "/" : v.slice(1), k])
);

function getStoredLanguage(): "ar" | "en" {
  return (localStorage.getItem("rispro-language") as "ar" | "en") || "ar";
}

function getStoredTheme(): "light" | "dark" {
  return (localStorage.getItem("rispro-theme") as "light" | "dark") || "light";
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [language, setLanguage] = useState<"ar" | "en">(getStoredLanguage);
  const [theme, setTheme] = useState<"light" | "dark">(getStoredTheme);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rispro-theme", theme);
  }, [theme]);

  // Apply language / direction
  useEffect(() => {
    document.documentElement.setAttribute("lang", language);
    document.documentElement.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
    localStorage.setItem("rispro-language", language);
  }, [language]);

  const handleNavigate = useCallback(
    (route: string) => {
      const path = ROUTE_PATHS[route];
      if (path) {
        localStorage.setItem("rispro-route", route);
        navigate(path);
      }
    },
    [navigate]
  );

  // Determine current route key for sidebar highlighting
  const currentRoute = (() => {
    const pathname = location.pathname;
    return PATH_TO_ROUTE[pathname === "/" ? "/" : pathname.slice(1)] || "dashboard";
  })();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-stone-50 dark:bg-stone-900">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-stone-300 border-t-teal-600" />
      </div>
    );
  }

  // If not authenticated, the Routes component handles redirecting to /login
  // If we are here, user is authenticated (or loading)
  if (!user) {
    return null; // Let router handle redirect
  }

  return (
    <div className="flex flex-col min-h-screen bg-stone-50 dark:bg-stone-900" dir={language === "ar" ? "rtl" : "ltr"}>
      <TopBar
        user={user}
        language={language}
        onToggleLanguage={() => setLanguage((l) => (l === "ar" ? "en" : "ar"))}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onLogout={logout}
        onMobileNavToggle={() => setMobileNavOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <SideNav
          currentRoute={currentRoute}
          user={user}
          language={language}
          onNavigate={handleNavigate}
        />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/calendar" element={<PlaceholderPage route="calendar" />} />
            <Route path="/registrations" element={<RegistrationsPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/modality" element={<PlaceholderPage route="modality" />} />
            <Route path="/doctor" element={<PlaceholderPage route="doctor" />} />
            <Route path="/print" element={<PlaceholderPage route="print" />} />
            <Route path="/statistics" element={<PlaceholderPage route="statistics" />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/pacs" element={<PlaceholderPage route="pacs" />} />
            <Route path="/settings" element={<PlaceholderPage route="settings" />} />
            
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <MobileDrawer
        isOpen={mobileNavOpen}
        currentRoute={currentRoute}
        user={user}
        language={language}
        onNavigate={handleNavigate}
        onClose={() => setMobileNavOpen(false)}
      />
    </div>
  );
}

function RouterConfig() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AppContent />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <QueryProvider>
        <AuthProvider>
          <RouterConfig />
        </AuthProvider>
      </QueryProvider>
    </BrowserRouter>
  );
}
