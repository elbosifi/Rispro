import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoginPage } from "@/pages/auth/login-page";
import { DashboardPage } from "@/pages/dashboard/dashboard-page";
import SearchPage from "@/pages/search/search-page";
import PatientsPage from "@/pages/patients/patients-page";
import EditPatientPage from "@/pages/patients/edit-patient-page";
import AppointmentsPage from "@/pages/appointments/appointments-page";
import CalendarPage from "@/pages/calendar/calendar-page";
import RegistrationsPage from "@/pages/registrations/registrations-page";
import QueuePage from "@/pages/queue/queue-page";
import ModalityPage from "@/pages/modality/modality-page";
import DoctorPage from "@/pages/doctor/doctor-page";
import PrintPage from "@/pages/print/print-page";
import StatisticsPage from "@/pages/statistics/statistics-page";
import PacsPage from "@/pages/pacs/pacs-page";
import SettingsPage from "@/pages/settings/settings-page";
import { TopBar, SideNav, MobileDrawer } from "@/components/layout/navigation";
import { ToastViewport } from "@/components/common/toast-viewport";
import { QueryProvider } from "@/providers/query-provider";
import { LanguageProvider, useLanguage } from "@/providers/language-provider";

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

function getStoredTheme(): "light" | "dark" {
  return (localStorage.getItem("rispro-theme") as "light" | "dark") || "light";
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading, logout } = useAuth();
  const { language, toggleLanguage } = useLanguage();
  const isArabic = language === "ar";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(getStoredTheme);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rispro-theme", theme);
  }, [theme]);

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
    <div className="flex flex-col min-h-screen bg-stone-50 dark:bg-stone-900" dir={isArabic ? "rtl" : "ltr"}>
      <TopBar
        user={user}
        language={language}
        isRtl={isArabic}
        onUndo={() => navigate(-1)}
        onRedo={() => navigate(1)}
        onToggleLanguage={toggleLanguage}
        onToggleTheme={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
        onLogout={logout}
        onMobileNavToggle={() => setMobileNavOpen(true)}
      />

      <div className={`flex flex-1 overflow-hidden ${isArabic ? "flex-row-reverse" : ""}`}>
        <SideNav
          currentRoute={currentRoute}
          user={user}
          language={language}
          isRtl={isArabic}
          onNavigate={handleNavigate}
        />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6" dir={isArabic ? "rtl" : "ltr"}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id/edit" element={<EditPatientPage />} />
            <Route path="/appointments" element={<AppointmentsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/registrations" element={<RegistrationsPage />} />
            <Route path="/queue" element={<QueuePage />} />
            <Route path="/modality" element={<ModalityPage />} />
            <Route path="/doctor" element={<DoctorPage />} />
            <Route path="/print" element={<PrintPage />} />
            <Route path="/statistics" element={<StatisticsPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/pacs" element={<PacsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>

      <MobileDrawer
        isOpen={mobileNavOpen}
        currentRoute={currentRoute}
        user={user}
        language={language}
        isRtl={language === "ar"}
        onNavigate={handleNavigate}
        onClose={() => setMobileNavOpen(false)}
      />

      <ToastViewport />
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
    <LanguageProvider>
      <BrowserRouter>
        <QueryProvider>
          <AuthProvider>
            <RouterConfig />
          </AuthProvider>
        </QueryProvider>
      </BrowserRouter>
    </LanguageProvider>
  );
}
