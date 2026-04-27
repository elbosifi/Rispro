export interface RegistrationsFilters {
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  query: string;
  statuses: string[];
}

export function buildRegistrationAppointmentQuery(filters: RegistrationsFilters) {
  // Single-date selection should behave like a bounded range so the backend
  // never receives an open-ended appointment query.
  const effectiveDateFrom = filters.date || filters.dateFrom;
  const effectiveDateTo = filters.date || filters.dateTo;

  return {
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    modalityId: filters.modalityId,
    q: filters.query,
    status: filters.statuses,
  };
}
