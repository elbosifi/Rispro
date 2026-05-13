export interface RegistrationsFilters {
  dateMode: "all" | "single" | "range";
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  patientId?: string;
  query: string;
  statuses: string[];
}

export function buildRegistrationAppointmentQuery(filters: RegistrationsFilters) {
  const query: Record<string, string | string[]> = {
    modalityId: filters.modalityId,
    q: filters.query,
    status: filters.statuses,
  };

  if (filters.patientId) {
    query.patientId = filters.patientId;
  }

  if (filters.dateMode === "single") {
    query.dateFrom = filters.date;
    query.dateTo = filters.date;
  } else if (filters.dateMode === "range") {
    query.dateFrom = filters.dateFrom;
    query.dateTo = filters.dateTo;
  }

  return query;
}
