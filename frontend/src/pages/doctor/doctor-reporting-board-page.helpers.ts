import type { ReportingBoardFilters } from "@/types/api";

function compactFilters(filters: ReportingBoardFilters): ReportingBoardFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  ) as ReportingBoardFilters;
}

export function isWindowsWorkstation(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`;
  return /\bWin/i.test(platform);
}

export function buildReportingBoardPrintUrl(input: {
  filters: ReportingBoardFilters;
  savedViewToken?: string | null;
  selectedAppointmentIds?: number[];
  autoprint?: boolean;
  selectedDoctorName?: string | null;
}): string {
  const params = new URLSearchParams();
  Object.entries(compactFilters(input.filters)).forEach(([key, value]) => params.set(key, String(value)));
  if (input.savedViewToken) params.set("savedViewToken", input.savedViewToken);
  if (input.selectedAppointmentIds?.length) params.set("appointmentIds", input.selectedAppointmentIds.join(","));
  if (input.selectedDoctorName) params.set("doctorName", input.selectedDoctorName);
  if (input.autoprint) params.set("autoprint", "1");
  return `/print/reporting-board?${params.toString()}`;
}
