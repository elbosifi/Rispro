export function buildPatientAppointmentUrl(token: string, origin: string): string {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return "";
  return `${origin}/public/appointment?t=${encodeURIComponent(cleanToken)}`;
}
