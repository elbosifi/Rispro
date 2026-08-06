import { useEffect } from "react";
import { mapAppointmentWithDetails } from "@/lib/mappers";
import { prepareAppointmentSlipHtml } from "@/lib/print-utils";
import type { AppointmentSlipSettings, PatientQrSettings } from "@/lib/api-hooks";

export default function InternalAppointmentSlipRenderPage() {
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) return;
    void (async () => {
      const response = await fetch(`/api/internal/appointment-slip-render/data?token=${encodeURIComponent(token)}`, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("Appointment-slip render data could not be loaded.");
      const data = await response.json() as { appointment: Record<string, unknown>; slipSettings: AppointmentSlipSettings; patientQrSettings: PatientQrSettings };
      const html = await prepareAppointmentSlipHtml(mapAppointmentWithDetails(data.appointment), {
        slipSettings: data.slipSettings,
        patientQrSettings: data.patientQrSettings,
      });
      document.open();
      document.write(html);
      document.close();
    })().catch(() => {
      document.body.textContent = "Appointment-slip rendering failed.";
    });
  }, []);
  return null;
}
