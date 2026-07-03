import { useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BriefcaseMedical,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  Stethoscope,
  Users,
} from "lucide-react";
import {
  dismissReportingBoardNotification,
  fetchDoctorMe,
  fetchReportingBoardNotifications,
  markAllReportingBoardNotificationsRead,
  markReportingBoardNotificationRead,
} from "@/lib/api-hooks";
import type { DoctorMe } from "@/types/api";
import { DoctorCasesPage } from "./doctor-cases-page";
import { DoctorProtocolsPage } from "./doctor-protocols-page";
import { DoctorRosterPage } from "./doctor-roster-page";
import { DoctorTeamWorkloadPage } from "./doctor-team-workload-page";
import { DoctorAvailabilityPage } from "./doctor-availability-page";
import { DoctorAdminDoctorsPage } from "./doctor-admin-doctors-page";
import { DoctorReportingBoardPage } from "./doctor-reporting-board-page";

type DoctorPortalNavItem = {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  management?: boolean;
};

const DOCTOR_NAV: DoctorPortalNavItem[] = [
  { path: "/doctor/my-work", label: "My Work", icon: LayoutDashboard },
  { path: "/doctor/today-cases", label: "Today’s Cases", icon: BriefcaseMedical },
  { path: "/doctor/protocols", label: "Protocols", icon: ClipboardList },
];

const SUPERVISOR_NAV: DoctorPortalNavItem[] = [
  { path: "/doctor/reporting-board", label: "Reporting Board", icon: ClipboardList, management: true },
  { path: "/doctor/roster-planner", label: "Roster Planner", icon: CalendarDays, management: true },
  { path: "/doctor/doctors-directory", label: "Doctors Directory", icon: Users, management: true },
  { path: "/doctor/advanced-setup", label: "Advanced Setup", icon: Settings, management: true },
];

function canAccessDoctorAdmin(me: DoctorMe): boolean {
  return Boolean(me.canAccessDoctorAdmin) || me.moduleCapabilities.includes("doctor_admin");
}

function canManageClinicalRoster(me: DoctorMe): boolean {
  return Boolean(me.canAccessClinicalDoctorPortal) && (me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin"));
}

function canManageProtocolLibrary(me: DoctorMe): boolean {
  return Boolean(me.isSuperAdmin || me.canAccessDoctorAdmin || me.canSupervise || me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin"));
}

function canAccessProtocolsPage(me: DoctorMe): boolean {
  return Boolean(me.canAssignProtocols || canManageProtocolLibrary(me));
}

function LoadingShell() {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
      <div className="spinner-industrial h-10 w-10" />
    </div>
  );
}

function DoctorPortalHome({ me }: { me: DoctorMe }) {
  const canAccessClinical = Boolean(me.canAccessClinicalDoctorPortal ?? me.hasActiveDoctorProfile);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          Doctor Portal
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">
          {me.profile?.displayName ?? "Doctor Portal admin"}
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label="Role" value={me.doctorRole?.replaceAll("_", " ") ?? (me.isSuperAdmin ? "super admin" : "admin")} />
        <SummaryTile label="Protocol permission" value={me.canAssignProtocols ? "Allowed" : "Not enabled"} />
        <SummaryTile label="Reporting permission" value={me.canFinalizeReports ? "Can finalize" : "Not enabled"} />
      </div>
      {!me.hasActiveDoctorProfile && me.canAccessDoctorAdmin ? (
        <PlaceholderPanel title="Doctor Portal administration" body="Use Doctors Directory to manage doctor profiles and modality permissions." />
      ) : (
        <PlaceholderPanel title="Clinical coordination workspace" body="Roster, case basket, protocol assignment, and workload dashboards are available from the navigation." />
      )}
      {canAccessClinical && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ShortcutCard title="My Roster" body="Review your published roster and assigned shifts." to="/doctor/roster" />
          <ShortcutCard title="Availability" body="Update availability and leave for roster planning." to="/doctor/availability" />
          <ShortcutCard title="My Cases" body="Open your report-required case worklist." to="/doctor/today-cases" />
          {canAccessProtocolsPage(me) && <ShortcutCard title="Protocols" body="Review and manage protocol tasks." to="/doctor/protocols" />}
        </section>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="mt-2 text-base font-semibold capitalize text-foreground">{value}</p>
    </div>
  );
}

function PlaceholderPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-lg border p-5" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>
        {body}
      </p>
    </section>
  );
}

function ShortcutCard({ title, body, to }: { title: string; body: string; to: string }) {
  return (
    <Link
      to={to}
      className="rounded-lg border p-4 text-left transition hover:border-teal-600"
      style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-5" style={{ color: "var(--text-muted)" }}>
        {body}
      </p>
    </Link>
  );
}

function SetupSectionButton({
  title,
  body,
  active,
  onClick,
}: {
  title: string;
  body: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border p-4 text-left transition hover:border-teal-600"
      style={{
        backgroundColor: active ? "color-mix(in srgb, var(--accent) 8%, var(--card))" : "var(--card)",
        borderColor: active ? "var(--accent)" : "var(--border)",
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-5" style={{ color: "var(--text-muted)" }}>
        {body}
      </p>
    </button>
  );
}

function DoctorAdvancedSetupPage({ me }: { me: DoctorMe }) {
  const canAccessClinical = Boolean(me.canAccessClinicalDoctorPortal ?? me.hasActiveDoctorProfile);
  const canManageRoster = canManageClinicalRoster(me);
  const canManageDoctors = canAccessDoctorAdmin(me);
  const canAccessManagementSetup = canManageClinicalRoster(me) || canAccessDoctorAdmin(me);
  const [selectedSection, setSelectedSection] = useState<"roster" | "doctors" | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          Doctor Portal
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Advanced Setup</h2>
      </div>
      {canAccessManagementSetup && (
        <section className="grid gap-3 md:grid-cols-3">
          {canManageRoster && (
            <SetupSectionButton
              title="Roster setup"
              body="Duty types, ABC mappings, XML import, templates, draft generation, exports, and notifications."
              active={selectedSection === "roster"}
              onClick={() => setSelectedSection("roster")}
            />
          )}
          {canManageDoctors && (
            <SetupSectionButton
              title="Doctor import/export"
              body="Download templates, export doctors, import CSV/XLSX, preview rows, and confirm imports."
              active={selectedSection === "doctors"}
              onClick={() => setSelectedSection("doctors")}
            />
          )}
          {canAccessClinical && (
            <ShortcutCard title="Workload setup" body="Open team workload summaries and workload catalog tools." to="/doctor/team-workload" />
          )}
        </section>
      )}
      {!selectedSection && (
        <PlaceholderPanel
          title="Choose a setup area"
          body="Select one of the setup cards above to open low-frequency roster or doctor import/export tools."
        />
      )}
      {selectedSection === "roster" && canManageRoster && <DoctorRosterPage me={me} management advanced />}
      {selectedSection === "doctors" && canManageDoctors && <DoctorAdminDoctorsPage me={me} advanced />}
    </div>
  );
}

function DoctorPortalRoutes({ me }: { me: DoctorMe }) {
  const canAccessClinical = Boolean(me.canAccessClinicalDoctorPortal ?? me.hasActiveDoctorProfile);
  const canManageRoster = canManageClinicalRoster(me);
  const canManageDoctors = canAccessDoctorAdmin(me);
  const canAccessAdvancedSetup = canManageRoster || canManageDoctors;

  return (
    <Routes>
      <Route index element={<Navigate to="/doctor/my-work" replace />} />
      <Route path="" element={<Navigate to="/doctor/my-work" replace />} />
      <Route path="dashboard" element={<Navigate to="/doctor/my-work" replace />} />
      <Route path="my-work" element={<DoctorPortalHome me={me} />} />
      <Route
        path="today-cases"
        element={canAccessClinical ? <DoctorCasesPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route path="cases" element={<Navigate to="/doctor/today-cases" replace />} />
      <Route
        path="reporting-board"
        element={canManageRoster ? <DoctorReportingBoardPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route
        path="reporting-board/saved/:token"
        element={canAccessClinical ? <DoctorReportingBoardPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route
        path="roster-planner"
        element={canManageRoster ? <DoctorRosterPage me={me} management /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route path="admin/roster" element={<Navigate to="/doctor/roster-planner" replace />} />
      <Route
        path="doctors-directory"
        element={canManageDoctors ? <DoctorAdminDoctorsPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route path="admin/doctors" element={<Navigate to="/doctor/doctors-directory" replace />} />
      <Route
        path="advanced-setup"
        element={canAccessAdvancedSetup ? <DoctorAdvancedSetupPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route
        path="roster"
        element={canAccessClinical ? <DoctorRosterPage me={me} management={false} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route
        path="availability"
        element={canAccessClinical ? <DoctorAvailabilityPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route
        path="protocols"
        element={canAccessProtocolsPage(me) ? <DoctorProtocolsPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route
        path="team-workload"
        element={canAccessClinical ? <DoctorTeamWorkloadPage me={me} /> : <Navigate to="/doctor/my-work" replace />}
      />
      <Route path="*" element={<Navigate to="/doctor/my-work" replace />} />
    </Routes>
  );
}

function ReportingBoardNotificationsButton() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const notificationsQuery = useQuery({
    queryKey: ["doctor", "reporting-board", "notifications"],
    queryFn: fetchReportingBoardNotifications,
    refetchInterval: 60_000,
  });
  const markReadMutation = useMutation({
    mutationFn: markReportingBoardNotificationRead,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "notifications"] }),
  });
  const dismissMutation = useMutation({
    mutationFn: dismissReportingBoardNotification,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "notifications"] }),
  });
  const readAllMutation = useMutation({
    mutationFn: markAllReportingBoardNotificationsRead,
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["doctor", "reporting-board", "notifications"] }),
  });
  const notifications = notificationsQuery.data ?? [];
  const unreadCount = notifications.filter((item) => item.status === "delivered" || item.status === "pending").length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="relative inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
        aria-label="Notifications"
      >
        <Bell size={14} />
        Notifications
        {unreadCount > 0 && (
          <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>
        )}
      </button>
      {open && (
        <section className="absolute right-0 z-50 mt-2 w-80 rounded-lg border p-3 shadow-xl" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            <button type="button" onClick={() => readAllMutation.mutate()} className="text-xs font-semibold" style={{ color: "var(--accent)" }}>
              Mark all read
            </button>
          </div>
          <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No notifications.</p>
            ) : (
              notifications.map((notification) => (
                <article key={notification.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: notification.status === "read" ? "var(--background)" : "color-mix(in srgb, var(--accent) 8%, var(--card))" }}>
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => {
                      markReadMutation.mutate(notification.id);
                      if (notification.actionUrl) navigate(notification.actionUrl);
                      setOpen(false);
                    }}
                  >
                    <span className="font-semibold text-foreground">{notification.title}</span>
                    <span className="mt-1 block text-xs leading-5" style={{ color: "var(--text-muted)" }}>{notification.body}</span>
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{new Date(notification.createdAt).toLocaleString()}</span>
                    <button type="button" onClick={() => dismissMutation.mutate(notification.id)} className="text-xs font-semibold text-red-700">
                      Dismiss
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export default function DoctorPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: me, isLoading } = useQuery({
    queryKey: ["doctor", "me"],
    queryFn: fetchDoctorMe,
    retry: false,
    staleTime: 1000 * 60,
  });

  const navItems = useMemo(() => {
    if (!me) return DOCTOR_NAV;
    const baseNav = (me.canAccessClinicalDoctorPortal ?? me.hasActiveDoctorProfile) ? DOCTOR_NAV.filter((item) => item.path !== "/doctor/protocols" || canAccessProtocolsPage(me)) : [];
    const byPath = new Map<string, DoctorPortalNavItem>();
    baseNav.forEach((item) => byPath.set(item.path, item));
    if (canManageClinicalRoster(me)) {
      byPath.set(SUPERVISOR_NAV[0].path, SUPERVISOR_NAV[0]);
      byPath.set(SUPERVISOR_NAV[1].path, SUPERVISOR_NAV[1]);
    }
    if (canAccessDoctorAdmin(me)) byPath.set(SUPERVISOR_NAV[2].path, SUPERVISOR_NAV[2]);
    if (canManageClinicalRoster(me) || canAccessDoctorAdmin(me)) byPath.set(SUPERVISOR_NAV[3].path, SUPERVISOR_NAV[3]);
    return [...byPath.values()];
  }, [me]);

  if (isLoading) return <LoadingShell />;

  if (!(me?.canAccessDoctorPortal ?? me?.hasActiveDoctorProfile ?? me?.canAccessDoctorAdmin)) {
    return <Navigate to="/" replace />;
  }

  if (location.pathname === "/doctor") {
    return <Navigate to="/doctor/my-work" replace />;
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }} lang="en" dir="ltr">
      <header className="border-b" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex h-14 items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg text-white" style={{ backgroundColor: "var(--accent)" }}>
              <Stethoscope size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-foreground">Doctor Portal</h1>
              <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                Team-based clinical workflow
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {me.hasActiveDoctorProfile && <ReportingBoardNotificationsButton />}
            {me.canAccessCoreWorkspace && (
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}
              >
                <LogOut size={14} />
                RISpro Core
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-1 lg:grid-cols-[240px_1fr]">
        <aside className="border-b p-3 lg:border-b-0 lg:border-r" style={{ borderColor: "var(--border)" }}>
          <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.path;
              return (
                <button
                  key={`${item.path}-${item.label}`}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium lg:w-full"
                  style={{
                    borderColor: active ? "var(--accent)" : "transparent",
                    backgroundColor: active ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "transparent",
                    color: active ? "var(--accent)" : "var(--foreground)",
                  }}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.management && <Settings size={13} className="ml-auto opacity-60" />}
                </button>
              );
            })}
          </nav>
        </aside>
        <main className="p-4 lg:p-6">
          <DoctorPortalRoutes me={me} />
        </main>
      </div>
    </div>
  );
}
