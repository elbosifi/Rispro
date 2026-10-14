const QUEUE_STATUSES = new Set(["arrived", "waiting"]);

export function shouldReplaceSanteHl7ForBooking(
  status: string,
  sendOnlyWhenPatientEntersQueue: boolean,
  currentProjectionExists = false,
): boolean {
  return QUEUE_STATUSES.has(status) || (status === "scheduled" && (!sendOnlyWhenPatientEntersQueue || currentProjectionExists));
}
