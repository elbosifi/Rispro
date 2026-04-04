import { useQuery } from "@tanstack/react-query";
import { fetchQueueSnapshot, fetchAppointmentLookups, fetchDaySettings } from "@/lib/api-hooks";
import { PageContainer } from "@/components/layout/page-container";
import { useAuth } from "@/providers/auth-provider";

function StatCard({
  label,
  value,
  icon,
  tone = "default"
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "default" | "good" | "warn" | "alert";
}) {
  const toneStyles = {
    default: "bg-white dark:bg-stone-800 border-stone-200 dark:border-stone-700",
    good: "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800",
    warn: "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800",
    alert: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
  };

  const valueColors = {
    default: "text-stone-900 dark:text-white",
    good: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    alert: "text-red-700 dark:text-red-400"
  };

  return (
    <div className={`rounded-2xl p-5 border shadow-sm ${toneStyles[tone]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-stone-500 dark:text-stone-400">
            {label}
          </p>
          <p className={`mt-2 text-3xl font-bold ${valueColors[tone]}`}>
            {value}
          </p>
        </div>
        <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-500 dark:text-stone-300">
          {icon}
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();

  const { data: lookups, isLoading: lookupsLoading } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const { data: queue } = useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueueSnapshot,
    staleTime: 1000 * 10
  });

  useQuery({
    queryKey: ["day-settings"],
    queryFn: fetchDaySettings,
    staleTime: 1000 * 60
  });

  const activeModalities = lookups?.modalities.filter((m) => m.isActive).length ?? 0;
  const todayQueueCount = queue?.summary?.total_appointments ?? 0;
  const waitingCount = queue?.summary?.waiting_count ?? 0;
  const noShowCount = queue?.summary?.no_show_count ?? 0;

  return (
    <PageContainer>
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-900 dark:text-white">
              Welcome, {user?.fullName}
            </h2>
            <p className="text-stone-500 dark:text-stone-400 mt-1">
              System dashboard for today's operations
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
            <span className="h-2 w-2 rounded-full bg-teal-500 animate-pulse" />
            <span className="text-xs font-medium text-teal-700 dark:text-teal-300">
              {user?.role === "supervisor" ? "Supervisor Mode" : "Reception Mode"}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Today's Queue"
            value={lookupsLoading ? "..." : todayQueueCount}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
            }
            tone="default"
          />
          <StatCard
            label="Waiting Patients"
            value={waitingCount}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            tone={waitingCount > 5 ? "warn" : "good"}
          />
          <StatCard
            label="No-Show Review"
            value={noShowCount}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            }
            tone={noShowCount > 0 ? "alert" : "default"}
          />
          <StatCard
            label="Active Modalities"
            value={lookupsLoading ? "..." : activeModalities}
            icon={
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            }
            tone="default"
          />
        </div>

        {/* Info Banner */}
        <div className="rounded-2xl p-6 border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              <svg className="h-6 w-6 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                New Frontend Active
              </h3>
              <div className="mt-2 text-sm text-blue-700 dark:text-blue-400">
                <p>
                  You are viewing the new React frontend. Pages are being migrated progressively.
                  Core features like Auth and Dashboard are fully operational.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
