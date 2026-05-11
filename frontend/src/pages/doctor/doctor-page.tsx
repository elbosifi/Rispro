import { useMemo } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BriefcaseMedical,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Settings,
  Stethoscope,
  Users,
} from "lucide-react";
import { fetchDoctorMe } from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";
import type { DoctorMe } from "@/types/api";
import { DoctorCasesPage } from "./doctor-cases-page";
import { DoctorRosterPage } from "./doctor-roster-page";

type DoctorPortalNavItem = {
  path: string;
  label: string;
  icon: typeof LayoutDashboard;
  management?: boolean;
};

const DOCTOR_NAV: DoctorPortalNavItem[] = [
  { path: "/doctor/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/doctor/roster", label: "My Roster", icon: CalendarDays },
  { path: "/doctor/cases", label: "My Cases", icon: BriefcaseMedical },
  { path: "/doctor/protocols", label: "Protocols", icon: ClipboardList },
];

const SUPERVISOR_NAV: DoctorPortalNavItem[] = [
  { path: "/doctor/admin/roster", label: "Roster Management", icon: CalendarDays, management: true },
  { path: "/doctor/team-workload", label: "Team Workload", icon: Activity, management: true },
  { path: "/doctor/admin/doctors", label: "Doctors/Admin", icon: Users, management: true },
];

function isSupervisorOrAdmin(me: DoctorMe): boolean {
  return me.moduleCapabilities.includes("doctor_supervisor") || me.moduleCapabilities.includes("doctor_admin");
}

function LoadingShell() {
  return (
    <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: "var(--background)" }}>
      <div className="spinner-industrial h-10 w-10" />
    </div>
  );
}

function DoctorPortalHome({ me }: { me: DoctorMe }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
          Doctor Portal
        </p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">
          {me.profile?.displayName ?? "Doctor workspace"}
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label="Role" value={me.doctorRole?.replaceAll("_", " ") ?? "doctor"} />
        <SummaryTile label="Protocol permission" value={me.canAssignProtocols ? "Allowed" : "Not enabled"} />
        <SummaryTile label="Reporting permission" value={me.canFinalizeReports ? "Can finalize" : "Not enabled"} />
      </div>
      <PlaceholderPanel
        title="Clinical coordination workspace"
        body="Phase 1 enables identity, access control, and navigation only. Roster, case basket, protocol assignment, and workload dashboards will arrive in later phases."
      />
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

function DoctorPortalRoutes({ me }: { me: DoctorMe }) {
  const canManage = isSupervisorOrAdmin(me);

  return (
    <Routes>
      <Route index element={<Navigate to="/doctor/dashboard" replace />} />
      <Route path="" element={<Navigate to="/doctor/dashboard" replace />} />
      <Route path="dashboard" element={<DoctorPortalHome me={me} />} />
      <Route
        path="roster"
        element={<DoctorRosterPage me={me} management={false} />}
      />
      <Route
        path="cases"
        element={<DoctorCasesPage me={me} />}
      />
      <Route
        path="protocols"
        element={
          <PlaceholderPanel
            title="Protocols"
            body="Protocol assignment is deferred to Phase 4. This page does not create or update appointment protocols."
          />
        }
      />
      <Route
        path="team-workload"
        element={
          canManage ? (
            <PlaceholderPanel
              title="Team Workload"
              body="Team workload summaries are deferred to Phase 5. No workload units, ranking, salary, or productivity scoring are implemented here."
            />
          ) : (
            <Navigate to="/doctor/dashboard" replace />
          )
        }
      />
      <Route
        path="admin/roster"
        element={
          canManage ? (
            <DoctorRosterPage me={me} management />
          ) : (
            <Navigate to="/doctor/dashboard" replace />
          )
        }
      />
      <Route
        path="admin/doctors"
        element={
          canManage ? (
            <PlaceholderPanel
              title="Doctors/Admin"
              body="Doctor profile administration is available through the backend identity module. A full management UI is deferred beyond this shell."
            />
          ) : (
            <Navigate to="/doctor/dashboard" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/doctor/dashboard" replace />} />
    </Routes>
  );
}

export default function DoctorPage() {
  const { language } = useLanguage();
  const isRtl = language === "ar";
  const location = useLocation();
  const navigate = useNavigate();
  const { data: me, isLoading } = useQuery({
    queryKey: ["doctor", "me"],
    queryFn: fetchDoctorMe,
    retry: false,
    staleTime: 1000 * 60,
  });

  const navItems = useMemo(() => {
    if (!me || !isSupervisorOrAdmin(me)) return DOCTOR_NAV;
    const byPath = new Map<string, DoctorPortalNavItem>();
    [...DOCTOR_NAV, ...SUPERVISOR_NAV].forEach((item) => byPath.set(item.path, item));
    return [...byPath.values()];
  }, [me]);

  if (isLoading) return <LoadingShell />;

  if (!me?.hasActiveDoctorProfile) {
    return <Navigate to="/" replace />;
  }

  if (location.pathname === "/doctor") {
    return <Navigate to="/doctor/dashboard" replace />;
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--background)" }} dir={isRtl ? "rtl" : "ltr"}>
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
