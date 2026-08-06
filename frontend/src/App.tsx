import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from "react-router-dom";
import { useState, useCallback, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { AuthProvider } from "@/providers/auth-provider-component";
import { ActionPinIdleLock, ActionPinProvider } from "@/providers/action-pin-provider";
import { PageAccessRoute } from "@/components/auth/page-access-route";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ActionPinSettingsButton } from "@/components/auth/action-pin-settings-button";
import { PasskeySettingsButton } from "@/components/auth/passkey-settings-button";
import { WorkstationPrintingButton } from "@/components/printing/workstation-printing-button";
import { QzConnectionManager } from "@/components/printing/qz-connection-manager";
import WorkstationPrintingPage from "@/pages/workstation/workstation-printing-page";
import { canAccessWorkstationPrinting } from "@/lib/workstation-printing-access";
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
import NoShowReviewPage from "@/pages/queue/no-show-review-page";
import ModalityPage from "@/pages/modality/modality-page";
import DocumentIngestionPage from "@/pages/modality/document-ingestion-page";
import ComparisonsPage from "@/pages/comparisons/comparisons-page";
import DoctorPage from "@/pages/doctor/doctor-page";
import { ReportingBoardMobilePage } from "@/pages/doctor/reporting-board-mobile-page";
import PrintPage from "@/pages/print/print-page";
import DayListPrintPage from "@/pages/print/day-list-print-page";
import ReportingBoardPrintPage from "@/pages/print/reporting-board-print-page";
import InternalAppointmentSlipRenderPage from "@/pages/print/internal-appointment-slip-render-page";
import StatisticsPage from "@/pages/statistics/statistics-page";
import PacsPage from "@/pages/pacs/pacs-page";
import PacsRemapPage from "@/pages/pacs/pacs-remap-page";
import WorklistMonitorPage from "@/pages/worklist-monitor/worklist-monitor-page";
import RequestScansPage from "@/pages/request-scans/request-scans-page";
import SettingsPage from "@/pages/settings/settings-page";
import LegacyAccessViewerPage from "@/pages/legacy-access-viewer/legacy-access-viewer-page";
import PublicCancelAppointmentPage from "@/pages/public/cancel-appointment-page";
import { AppointmentCreatePage, SchedulingAdminPage } from "@/v2/appointments";
import { SchedulingOverrideApprovalCenter } from "@/v2/appointments/components/SchedulingOverrideApprovalCenter";
import { NoShowReviewTopBarAction, TopBar, SideNav, MobileDrawer } from "@/components/layout/navigation";
import { hasDoctorWorkspaceAccess } from "@/components/layout/navigation.helpers";
import { PatientDrawer } from "@/components/patients/patient-drawer";
import { ToastViewport } from "@/components/common/toast-viewport";
import { QueryProvider } from "@/providers/query-provider";
import { useLanguage } from "@/providers/language-provider";
import { LanguageProvider } from "@/providers/language-provider-component";
import { fetchDoctorMe, fetchPageVisibilityMatrix } from "@/lib/api-hooks";
import { APP_PATH_TO_ROUTE, APP_ROUTE_PATHS, APP_ROUTE_TITLE_KEYS } from "@/lib/route-registry";
import {
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  getDefaultLandingRouteForRole,
  normalizePageVisibilityMatrix,
  canRoleAccessRoute,
  type PageVisibilityRouteKey
} from "@/lib/page-visibility";

function getLandingPath(route: PageVisibilityRouteKey): string {
  if (route === "dashboard") {
    return "/dashboard";
  }
  return APP_ROUTE_PATHS[route] || "/dashboard";
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ backgroundColor: "var(--background)" }}>
      <div className="spinner-industrial h-12 w-12" />
    </div>
  );
}

function AuthenticatedQzConnectionManager() {
  const { user } = useAuth();
  return <QzConnectionManager enabled={Boolean(user && canAccessWorkstationPrinting(user.role))} />;
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

function EnglishOnlyRoute({ children }: { children: ReactNode }) {
  const { language } = useLanguage();

  useEffect(() => {
    document.documentElement.setAttribute("lang", "en");
    document.documentElement.setAttribute("dir", "ltr");

    return () => {
      document.documentElement.setAttribute("lang", language === "ar" ? "ar-LY" : "en");
      document.documentElement.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
    };
  }, [language]);

  return <div lang="en" dir="ltr">{children}</div>;
}

function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isLoading, logout } = useAuth();
  const { language, toggleLanguage, t } = useLanguage();
  const isArabic = language === "ar";
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [globalPatientId, setGlobalPatientId] = useState<number | null>(null);
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
  const effectiveDefaultLandingPath =
    doctorMe?.hasActiveDoctorProfile && !doctorMe.canAccessCoreWorkspace ? "/doctor/dashboard" : defaultLandingPath;

  const handleNavigate = useCallback(
    (route: string) => {
      const path = APP_ROUTE_PATHS[route as keyof typeof APP_ROUTE_PATHS];
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
    if (pathname.startsWith("/modality/document-ingestion")) {
      return "modality";
    }
    return APP_PATH_TO_ROUTE[pathname === "/" ? "/" : pathname.slice(1)] || "dashboard";
  })();

  const isPatientCreate = location.pathname === "/patients/new";
  const isPatientEdit = /^\/patients\/\d+\/edit$/.test(location.pathname);
  const routePageTitleKey = APP_ROUTE_TITLE_KEYS[currentRoute as keyof typeof APP_ROUTE_TITLE_KEYS];
  const sidebarPreferenceKey = "rispro-sidebar-collapsed";
  const hasSavedSidebarPreference = localStorage.getItem(sidebarPreferenceKey) != null;
  const [desktopNavCollapsedPreference, setDesktopNavCollapsedPreference] = useState(() => {
    const saved = localStorage.getItem(sidebarPreferenceKey);
    return saved === "true";
  });
  const desktopNavCollapsed = hasSavedSidebarPreference
    ? desktopNavCollapsedPreference
    : currentRoute === "modality";

  const toggleDesktopNavCollapsed = useCallback(() => {
    setDesktopNavCollapsedPreference((current) => {
      const next = !current;
      localStorage.setItem(sidebarPreferenceKey, String(next));
      return next;
    });
  }, []);

  const pageTitle = isPatientCreate
    ? t("patients.registerTitle")
    : isPatientEdit
      ? t("patients.editTitle")
      : routePageTitleKey
        ? t(routePageTitleKey)
        : null;

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
            className="inline-flex h-8 flex-shrink-0 items-center justify-center gap-1.5 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap shadow-sm transition-all hover:shadow-md active:scale-95 lg:h-10 lg:gap-2 lg:px-3 lg:text-xs"
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
        extraActions={(
          <>
            <NoShowReviewTopBarAction enabled={canRoleAccessRoute(normalizedMatrix, "queue", user.role)} />
            <SchedulingOverrideApprovalCenter user={user} />
          </>
        )}
        accountMenuActions={<><WorkstationPrintingButton /><PasskeySettingsButton /><ActionPinSettingsButton variant="drawer" /></>}
        canAccessSettings={canRoleAccessRoute(normalizedMatrix, "settings", user.role)}
        onSettings={() => navigate("/settings")}
        onUndo={() => navigate(-1)}
        onRedo={() => navigate(1)}
        onToggleLanguage={toggleLanguage}
        onLogout={logout}
        onMobileNavToggle={() => setMobileNavOpen(true)}
        canSearchPatients={canRoleAccessRoute(normalizedMatrix, "patients", user.role)}
        canSearchRegistrations={canRoleAccessRoute(normalizedMatrix, "registrations", user.role)}
        onPatientSearchSelect={setGlobalPatientId}
        onRegistrationSearchSelect={(appointment) => navigate(`/registrations?appointmentId=${appointment.id}&patientId=${appointment.patientId}&tab=details`)}
        canAccessDoctorWorkspace={hasDoctorWorkspaceAccess(doctorMe)}
        canAccessCoreWorkspace
        onWorkspaceNavigate={navigate}
      />

      <div className="flex flex-1 overflow-hidden">
        <SideNav
          currentRoute={currentRoute}
          user={user}
          language={language}
          isRtl={isArabic}
          collapsed={desktopNavCollapsed}
          onToggleCollapsed={toggleDesktopNavCollapsed}
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
            <Route path="/appointments" element={guardedPage("appointments", <AppointmentCreatePage />)} />
            <Route path="/scheduling/override-requests" element={guardedPage("scheduling.override.requests", <SchedulingOverrideRequestsPage />)} />
            <Route path="/appointments/legacy" element={<Navigate to="/appointments" replace />} />
            <Route path="/calendar" element={guardedPage("calendar", <CalendarPage />)} />
            <Route path="/registrations" element={guardedPage("registrations", <RegistrationsPage />)} />
            <Route path="/request-scans" element={guardedPage("request.scans", <RequestScansPage />)} />
            <Route path="/queue" element={guardedPage("queue", <QueuePage />)} />
            <Route path="/queue/no-shows" element={guardedPage("queue", <NoShowReviewPage />)} />
            <Route path="/modality" element={guardedPage("modality", <ModalityPage />)} />
            <Route path="/modality/document-ingestion" element={guardedPage("modality", <DocumentIngestionPage />)} />
            <Route path="/comparisons" element={guardedPage("comparisons", <ComparisonsPage />)} />
            <Route path="/comparisons/:id" element={guardedPage("comparisons", <ComparisonsPage />)} />
            <Route path="/print" element={guardedPage("print", <PrintPage />)} />
            <Route path="/statistics" element={guardedPage("statistics", <StatisticsPage />)} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/pacs" element={guardedPage("pacs", <PacsPage />)} />
            <Route path="/pacs/remap" element={guardedPage("pacs.remap", <PacsRemapPage />)} />
            <Route path="/worklist-monitor" element={guardedPage("worklist.monitor", <WorklistMonitorPage />)} />
            <Route path="/settings" element={guardedPage("settings", <SettingsPage />)} />
            <Route path="/workstation/printing" element={canAccessWorkstationPrinting(user.role) ? <WorkstationPrintingPage /> : <Navigate to="/" replace />} />
            <Route path="/legacy-access-viewer" element={guardedPage("legacy", <LegacyAccessViewerPage />)} />
            <Route path="/v2/appointments" element={<Navigate to="/appointments" replace />} />
            <Route
              path="/v2/appointments/admin"
              element={(user.role === "supervisor" || user.role === "super_admin")
                ? guardedPage("v2.appointments.admin", <SchedulingAdminPage />)
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
        onToggleLanguage={toggleLanguage}
        onLogout={logout}
        accountActions={<><WorkstationPrintingButton /><PasskeySettingsButton /><ActionPinSettingsButton variant="drawer" /></>}
      />

      <ToastViewport />
      {globalPatientId != null ? <PatientDrawer patientId={globalPatientId} onClose={() => setGlobalPatientId(null)} /> : null}
    </div>
  );
}

function LegacyReportingWorklistRedirect() {
  const { token = "" } = useParams();
  const location = useLocation();
  return <Navigate to={`/reporting/worklist/${encodeURIComponent(token)}${location.search}`} replace />;
}

function DoctorWorkspaceRoute() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return <EnglishOnlyRoute><DoctorPage user={user} onLogout={logout} /></EnglishOnlyRoute>;
}

function RouterConfig() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/public/appointment" element={<PublicCancelAppointmentPage />} />
      <Route path="/public/cancel-appointment" element={<PublicCancelAppointmentPage />} />
      <Route path="/reporting/worklist/:token" element={<EnglishOnlyRoute><ReportingBoardMobilePage /></EnglishOnlyRoute>} />
      <Route path="/mobile/reporting-view/:token" element={<LegacyReportingWorklistRedirect />} />
      <Route path="/print/day-list" element={<ProtectedRoute><DayListPrintPage /></ProtectedRoute>} />
      <Route path="/print/reporting-board" element={<ProtectedRoute><ReportingBoardPrintPage /></ProtectedRoute>} />
      <Route path="/print/internal/appointment-slip" element={<InternalAppointmentSlipRenderPage />} />
      <Route
        path="/queue/check-in"
        element={<QueueCheckInAccessRoute />}
      />
      <Route
        path="/doctor/*"
        element={
          <ProtectedRoute>
            <DoctorWorkspaceRoute />
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
          <ActionPinProvider>
            <AuthProvider>
              <AuthenticatedQzConnectionManager />
              <ActionPinIdleLock>
                <RouterConfig />
              </ActionPinIdleLock>
            </AuthProvider>
          </ActionPinProvider>
        </QueryProvider>
      </BrowserRouter>
    </LanguageProvider>
  );
}
