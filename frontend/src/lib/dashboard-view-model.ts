import type { AppointmentStatistics, AppointmentStatus, QueueSnapshot, AppointmentLookups } from "@/types/api";

export type DashboardTone = "default" | "good" | "warn" | "alert";

export const DASHBOARD_THRESHOLDS = {
  noShow: { warningMin: 1, alertMin: 4 },
  inQueue: { goodMax: 5, warningMax: 10 },
  completionRatio: { warningBelow: 0.4, alertBelow: 0.25, minSample: 10 }
} as const;

const STATUS_ORDER: AppointmentStatus[] = [
  "scheduled",
  "arrived",
  "waiting",
  "in-progress",
  "completed",
  "no-show",
  "cancelled"
];

export interface DashboardKpis {
  totalAppointments: number;
  arrivedCount: number;
  inQueueCount: number;
  completedCount: number;
  noShowCount: number;
  walkInCount: number;
  activeModalities: number;
  waitingCount: number;
  completionRatio: number;
}

export interface DashboardViewModel {
  kpis: DashboardKpis;
  tones: {
    noShow: DashboardTone;
    inQueue: DashboardTone;
    completion: DashboardTone;
  };
  statuses: { status: AppointmentStatus; count: number }[];
  modalities: AppointmentStatistics["modalityBreakdown"];
  queueHealth: {
    reviewActive: boolean;
    reviewTime: string;
    noShowCandidates: number;
  };
}

function statusToneByThreshold(value: number, warningMin: number, alertMin: number): DashboardTone {
  if (value >= alertMin) return "alert";
  if (value >= warningMin) return "warn";
  return "default";
}

function inQueueToneByThreshold(value: number): DashboardTone {
  if (value <= DASHBOARD_THRESHOLDS.inQueue.goodMax) return "good";
  if (value <= DASHBOARD_THRESHOLDS.inQueue.warningMax) return "warn";
  return "alert";
}

function completionTone(totalAppointments: number, completionRatio: number): DashboardTone {
  if (totalAppointments < DASHBOARD_THRESHOLDS.completionRatio.minSample) {
    return "default";
  }
  if (completionRatio < DASHBOARD_THRESHOLDS.completionRatio.alertBelow) {
    return "alert";
  }
  if (completionRatio < DASHBOARD_THRESHOLDS.completionRatio.warningBelow) {
    return "warn";
  }
  return "good";
}

export function buildDashboardViewModel(
  queue: QueueSnapshot | undefined,
  statistics: AppointmentStatistics | undefined,
  lookups: AppointmentLookups | undefined
): DashboardViewModel {
  const summary = statistics?.summary;
  const totalAppointments = summary?.totalAppointments ?? 0;
  const completedCount = summary?.completedCount ?? 0;
  const inQueueCount = summary?.inQueueCount ?? 0;
  const noShowCount = summary?.noShowCount ?? 0;
  const walkInCount = summary?.walkInCount ?? 0;
  const activeModalities = lookups?.modalities?.filter((m) => m.isActive).length ?? 0;
  const arrivedCount = queue?.summary?.arrived_count ?? 0;
  const waitingCount = queue?.summary?.waiting_count ?? 0;
  const completionRatio = totalAppointments > 0 ? completedCount / totalAppointments : 0;

  const statusMap = new Map<AppointmentStatus, number>();
  for (const status of STATUS_ORDER) {
    statusMap.set(status, 0);
  }

  for (const row of statistics?.statusBreakdown ?? []) {
    if (statusMap.has(row.status as AppointmentStatus)) {
      statusMap.set(row.status as AppointmentStatus, row.count);
    }
  }

  const statuses = STATUS_ORDER.map((status) => ({
    status,
    count: statusMap.get(status) ?? 0
  }));

  const modalities = [...(statistics?.modalityBreakdown ?? [])].sort((a, b) => b.totalCount - a.totalCount);

  return {
    kpis: {
      totalAppointments,
      arrivedCount,
      inQueueCount,
      completedCount,
      noShowCount,
      walkInCount,
      activeModalities,
      waitingCount,
      completionRatio
    },
    tones: {
      noShow: statusToneByThreshold(noShowCount, DASHBOARD_THRESHOLDS.noShow.warningMin, DASHBOARD_THRESHOLDS.noShow.alertMin),
      inQueue: inQueueToneByThreshold(inQueueCount),
      completion: completionTone(totalAppointments, completionRatio)
    },
    statuses,
    modalities,
    queueHealth: {
      reviewActive: Boolean(queue?.reviewActive),
      reviewTime: queue?.reviewTime ?? "",
      noShowCandidates: queue?.noShowCandidates?.length ?? 0
    }
  };
}

