export function buildAppointmentPrintUrl(
  appointmentId: number | string,
  options: { autoprint?: boolean } = {}
): string {
  const searchParams = new URLSearchParams({ appointmentId: String(appointmentId) });
  if (options.autoprint) {
    searchParams.set("autoprint", "1");
  }
  return `/print?${searchParams.toString()}`;
}

export interface DayListPrintRouteOptions {
  date: string;
  modalityId?: string;
  status?: string;
  caseCategory?: string;
  q?: string;
  sort?: string;
  columns?: string[];
  autoprint?: boolean;
}

export function buildDayListPrintUrl(options: DayListPrintRouteOptions): string {
  const searchParams = new URLSearchParams({ date: options.date });
  if (options.modalityId) searchParams.set("modalityId", options.modalityId);
  if (options.status) searchParams.set("status", options.status);
  if (options.caseCategory) searchParams.set("caseCategory", options.caseCategory);
  if (options.q) searchParams.set("q", options.q);
  if (options.sort) searchParams.set("sort", options.sort);
  if (options.columns?.length) searchParams.set("columns", options.columns.join(","));
  if (options.autoprint) searchParams.set("autoprint", "1");
  return `/print/day-list?${searchParams.toString()}`;
}
