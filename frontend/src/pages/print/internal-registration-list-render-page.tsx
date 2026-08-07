import { useEffect } from "react";
import { mapAppointmentsWithDetails } from "@/lib/mappers";
import { prepareAppointmentListHtml } from "@/lib/registration-list-printing";

export default function InternalRegistrationListRenderPage() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;
    void (async () => {
      const response = await fetch(`/api/internal/appointment-slip-render/registration-list/data?token=${encodeURIComponent(token)}`, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Registration-list render data could not be loaded.");
      const data = await response.json() as { appointments: Array<Record<string, unknown>>; label: string };
      const html = prepareAppointmentListHtml(mapAppointmentsWithDetails(data.appointments), data.label, new Date(), true);
      document.open(); document.write(html); document.close();
    })().catch(() => { document.body.textContent = "Registration-list rendering failed."; });
  }, []);
  return null;
}
