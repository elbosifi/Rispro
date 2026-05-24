import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { PageAccessRoute } from "@/components/auth/page-access-route";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { LoginPage } from "@/pages/auth/login-page";
import { DashboardPage } from "@/pages/dashboard/dashboard-page";
import SearchPage from "@/pages/search/search-page";
import PatientsPage from "@/pages/patients/patients-page";
import EditPatientPage from "@/pages/patients/edit-patient-page";
import PatientMergePage from "@/pages/patient-merge/patient-merge-page";
import NameDictionaryPage from "@/pages/name-dictionary/name-dictionary-page";
import CalendarPage from "@/pages/calendar/calendar-page";
import RegistrationsPage from "@/pages/registrations/registrations-page";
import SchedulingOverrideRequestsPage from "@/pages/scheduling-override-requests/scheduling-override-requests-page";
import QueuePage from "@/pages/queue/queue-page";
import QueueCheckInPage from "@/pages/queue/queue-check-in-page";
import ModalityPage from "@/pages/modality/modality-page";
import DoctorPage from "@/pages/doctor/doctor-page";
import PrintPage from "@/pages/print/print-page";
import DayListPrintPage from "@/pages/print/day-list-print-page";
import StatisticsPage from "@/pages/statistics/statistics-page";
import PacsPage from "@/pages/pacs/pacs-page";
import PacsRemapPage from "@/pages/pacs/pacs-remap-page";
import SettingsPage from "@/pages/settings/settings-page";
import LegacyAccessViewerPage from "@/pages/legacy-access-viewer/legacy-access-viewer-page";
import PublicCancelAppointmentPage from "@/pages/public/cancel-appointment-page";
import { AppointmentsV3CreatePage, SchedulingAdminV2Page } from "@/v2/appointments";
import { SchedulingOverrideApprovalCenter } from "@/v2/appointments/components/SchedulingOverrideApprovalCenter";
import { TopBar, SideNav, MobileDrawer } from "@/components/layout/navigation";
import { ToastViewport } from "@/components/common/toast-viewport";
import { QueryProvider } from "@/providers/query-provider";
import { LanguageProvider, useLanguage } from "@/providers/language-provider";
import { fetchDoctorMe, fetchPageVisibilityMatrix } from "@/lib/api-hooks";
import {
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  getDefaultLandingRouteForRole,
  normalizePageVisibilityMatrix,
  type PageVisibilityRouteKey
} from "@/lib/page-visibility";

const ROUTE_PATHS: Record<string, string> = {
  dashboard: "/",
  patients: "/patients",
  "patients.merge": "/patients/merge",
  "name.dictionary": "/name-dictionary",
  "patients.new": "/patients/new",
  appointments: "/appointments",
  "scheduling.override.requests": "/scheduling/override-requests",
  calendar: "/calendar",
  registrations: "/registrations",
  queue: "/queue",
  "queue.checkin": "/queue/check-in",
  modality: "/modality",
  doctor: "/doctor",
  print: "/print",
  statistics: "/statistics",
  search: "/search",
  pacs: "/pacs",
  "pacs.remap": "/pacs/remap",
  settings: "/settings",
  legacy: "/legacy-access-viewer",
  "v2.appointments.admin": "/v2/appointments/admin",
};

const PATH_TO_ROUTE = Object.fromEntries(
  Object.entries(ROUTE_PATHS).map(([k, v]) => [v === "/" ? "/" : v.slice(1), k])
);

function getLandingPath(route: PageVisibilityRouteKey): string {
  if (route === "dashboard") {
    return "/dashboard";
  }
  return ROUTE_PATHS[route] || "/dashboard";
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <div className="spinner-industrial h-12 w-12" />
    </div>
  );
}

function QueueCheckInAccessRoute() {
  const { user, isLoading } = useAuth();
  const { data: pageVisibilityMatrix, isLoading: isPageVisibilityLoading } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });
  const normalizedMatrix = normalizePageVisibilityMatrix(pageVisibilityMatrix ?? DEFAULT_PAGE_VISIBILITY_MATRIX);

  if (isLoading || isPageVisibilityLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <ProtectedRoute><QueueCheckInPage /></ProtectedRoute>;
  }

  const defaultLandingRoute = getDefaultLandingRouteForRole(normalizedMatrix, user.role);
  const defaultLandingPath = getLandingPath(defaultLandingRoute);

  return (
    <ProtectedRoute>
      <PageAccessRoute
        routeKey="queue.checkin"
        user={user}
        matrix={normalizedMatrix}
        defaultLandingPath={defaultLandingPath}
      >
        <QueueCheckInPage />
      </PageAccessRoute>
    </ProtectedRoute>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading, logout } = useAuth();
  const { language, toggleLanguage } = useLanguage();
  const isArabic = language === "ar";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { data: pageVisibilityMatrix, isLoading: isPageVisibilityLoading } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });
  const { data: doctorMe, isLoading: isDoctorMeLoading } = useQuery({
    queryKey: ["doctor", "me"],
    queryFn: fetchDoctorMe,
    enabled: Boolean(user),
    staleTime: 1000 * 60,
    retry: false,
  });
  const normalizedMatrix = normalizePageVisibilityMatrix(pageVisibilityMatrix ?? DEFAULT_PAGE_VISIBILITY_MATRIX);
  const defaultLandingRoute = getDefaultLandingRouteForRole(normalizedMatrix, user?.role ?? "receptionist");
  const defaultLandingPath = getLandingPath(defaultLandingRoute);
  const effectiveDefaultLandingPath = doctorMe?.hasActiveDoctorProfile ? "/doctor/dashboard" : defaultLandingPath;

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

  const currentRoute = (() => {
    const pathname = location.pathname;
    if (pathname.startsWith("/pacs/remap")) {
      return "pacs.remap";
    }
    if (pathname.startsWith("/patients/merge")) {
      return "patients.merge";
    }
    if (pathname.startsWith("/name-dictionary")) {
      return "name.dictionary";
    }
    return PATH_TO_ROUTE[pathname === "/" ? "/" : pathname.slice(1)] || "dashboard";
  })();

  const isPatientCreate = location.pathname === "/patients/new";
  const isPatientEdit = /^\/patients\/\d+\/edit$/.test(location.pathname);

  const pageTitle = isPatientCreate
    ? (language === "ar" ? "تسجيل مريض" : "Register Patient")
    : isPatientEdit
      ? (language === "ar" ? "تعديل مريض" : "Edit Patient")
      : (() => {
      switch (currentRoute) {
        case "dashboard":
          return language === "ar" ? "لوحة التحكم" : "Dashboard";
        case "patients":
          return language === "ar" ? "المرضى" : "Patients";
        case "patients.merge":
          return language === "ar" ? "Ø¯Ù…Ø¬ Ø§Ù„Ù…Ø±Ø¶Ù‰" : "Patient Merge";
        case "name.dictionary":
          return language === "ar" ? "Ù‚Ø§Ù…ÙˆØ³ Ø§Ù„Ø£Ø³Ù…Ø§Ø¡" : "Name Dictionary";
      case "appointments":
        return language === "ar" ? "إنشاء موعد" : "Create Appointment";
      case "scheduling.override.requests":
        return language === "ar" ? "طلبات التجاوز" : "Override Requests";
      case "calendar":
        return language === "ar" ? "التقويم" : "Calendar";
      case "registrations":
        return language === "ar" ? "التسجيلات" : "Registrations";
      case "queue":
        return language === "ar" ? "قائمة الانتظار" : "Queue";
      case "modality":
        return language === "ar" ? "الأجهزة" : "Modality";
      case "doctor":
        return language === "ar" ? "واجهة الطبيب" : "Doctor";
      case "print":
        return language === "ar" ? "الطباعة والتقارير" : "Print & Reports Center";
      case "statistics":
        return language === "ar" ? "الإحصاءات" : "Statistics";
      case "search":
        return language === "ar" ? "البحث" : "Search";
      case "pacs":
        return language === "ar" ? "PACS" : "PACS";
      case "pacs.remap":
        return language === "ar" ? "إعادة ربط PACS" : "PACS Remap";
      case "settings":
        return language === "ar" ? "الإعدادات" : "Settings";
      case "legacy":
        return language === "ar" ? "واجهة الاستقبال القديمة" : "Legacy Reception";
      case "v2.appointments.admin":
        return language === "ar" ? "إدارة المواعيد" : "Appointment Admin";
      default:
        return null;
      }
    })();

  if (isLoading || isPageVisibilityLoading || (location.pathname === "/" && isDoctorMeLoading)) {
    return <LoadingScreen />;
  }

  if (!user) {
    return null;
  }

  const guardedPage = (routeKey: PageVisibilityRouteKey, element: React.ReactNode) => (
    <PageAccessRoute
      routeKey={routeKey}
      user={user}
      matrix={normalizedMatrix}
      defaultLandingPath={effectiveDefaultLandingPath}
    >
      {element}
    </PageAccessRoute>
  );

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: "var(--background)" }} dir={isArabic ? "rtl" : "ltr"}>
      <TopBar
        user={user}
        language={language}
        isRtl={isArabic}
        pageTitle={pageTitle ?? undefined}
        pageAction={isPatientCreate || isPatientEdit ? (
          <button
            type="button"
            onClick={() => navigate("/patients")}
            aria-label={language === "ar" ? "رجوع" : "Back"}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap shadow-sm transition-all hover:shadow-md active:scale-95 flex-shrink-0"
            style={{
              backgroundColor: "var(--accent)",
              borderColor: "var(--accent)",
              color: "white"
            }}
          >
            <ArrowLeft size={16} strokeWidth={2.75} />
            <span className="leading-none">{language === "ar" ? "رجوع" : "Back"}</span>
          </button>
        ) : undefined}
        extraActions={<SchedulingOverrideApprovalCenter user={user} />}
        onUndo={() => navigate(-1)}
        onRedo={() => navigate(1)}
        onToggleLanguage={toggleLanguage}
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
            <Route path="/" element={<Navigate to={effectiveDefaultLandingPath} replace />} />
            <Route path="/dashboard" element={guardedPage("dashboard", <DashboardPage />)} />
            <Route path="/patients" element={guardedPage("patients", <PatientsPage />)} />
            <Route path="/patients/merge" element={guardedPage("patients.merge", <PatientMergePage />)} />
            <Route path="/name-dictionary" element={guardedPage("name.dictionary", <NameDictionaryPage />)} />
            <Route path="/patients/new" element={guardedPage("patients", <PatientsPage />)} />
            <Route path="/patients/:id/edit" element={guardedPage("patients", <EditPatientPage />)} />
            <Route path="/appointments" element={guardedPage("appointments", <AppointmentsV3CreatePage />)} />
            <Route path="/scheduling/override-requests" element={guardedPage("scheduling.override.requests", <SchedulingOverrideRequestsPage />)} />
            <Route path="/appointments/legacy" element={<Navigate to="/appointments" replace />} />
            <Route path="/calendar" element={guardedPage("calendar", <CalendarPage />)} />
            <Route path="/registrations" element={guardedPage("registrations", <RegistrationsPage />)} />
            <Route path="/queue" element={guardedPage("queue", <QueuePage />)} />
            <Route path="/modality" element={guardedPage("modality", <ModalityPage />)} />
            <Route path="/print" element={guardedPage("print", <PrintPage />)} />
            <Route path="/statistics" element={guardedPage("statistics", <StatisticsPage />)} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/pacs" element={guardedPage("pacs", <PacsPage />)} />
            <Route path="/pacs/remap" element={guardedPage("pacs.remap", <PacsRemapPage />)} />
            <Route path="/settings" element={guardedPage("settings", <SettingsPage />)} />
            <Route path="/legacy-access-viewer" element={guardedPage("legacy", <LegacyAccessViewerPage />)} />
            <Route path="/v2/appointments" element={<Navigate to="/appointments" replace />} />
            <Route
              path="/v2/appointments/admin"
              element={(user.role === "supervisor" || user.role === "super_admin")
                ? guardedPage("v2.appointments.admin", <SchedulingAdminV2Page />)
                : <Navigate to="/appointments" replace />}
            />

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
      <Route path="/public/appointment" element={<PublicCancelAppointmentPage />} />
      <Route path="/public/cancel-appointment" element={<PublicCancelAppointmentPage />} />
      <Route path="/print/day-list" element={<ProtectedRoute><DayListPrintPage /></ProtectedRoute>} />
      <Route
        path="/queue/check-in"
        element={<QueueCheckInAccessRoute />}
      />
      <Route
        path="/doctor/*"
        element={
          <ProtectedRoute>
            <DoctorPage />
          </ProtectedRoute>
        }
      />
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
