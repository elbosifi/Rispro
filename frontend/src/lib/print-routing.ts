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
