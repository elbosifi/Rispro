import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import { DEFAULT_APPOINTMENT_SLIP_SETTINGS, DEFAULT_PATIENT_QR_SETTINGS, fetchAppointmentSlipSettings, fetchPatientQrSettings, getAppointmentById } from "@/lib/api-hooks";
import { prepareAppointmentSlipHtml, printAppointmentSlip } from "@/lib/print-utils";
import { Button, Card } from "@/components/shared";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { ReportCenter } from "./report-center";

function describeError(error: unknown) { return error instanceof ApiError ? `HTTP ${error.status}: ${error.message}` : error instanceof Error ? error.message : error ? String(error) : ""; }

export default function PrintPage() {
  const [params] = useSearchParams();
  return params.get("appointmentId") ? <DirectAppointmentPrintPage /> : <ReportCenter />;
}

function DirectAppointmentPrintPage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [autoprintDoneKey, setAutoprintDoneKey] = useState<string | null>(null);
  const appointmentId = Number(params.get("appointmentId"));
  const autoprint = params.get("autoprint") === "1";
  const appointment = useQuery({ queryKey: ["print-appointment", appointmentId], queryFn: () => getAppointmentById(appointmentId), enabled: Number.isSafeInteger(appointmentId) && appointmentId > 0, staleTime: 0, refetchOnMount: "always" });
  const slipSettings = useQuery({ queryKey: ["appointment-slip-settings"], queryFn: fetchAppointmentSlipSettings, staleTime: 60_000 });
  const patientQrSettings = useQuery({ queryKey: ["patient-qr-settings"], queryFn: fetchPatientQrSettings, staleTime: 60_000 });
  const settingsFailed = Boolean(slipSettings.error || patientQrSettings.error);
  const options = useMemo(() => ({ slipSettings: slipSettings.data ?? DEFAULT_APPOINTMENT_SLIP_SETTINGS, patientQrSettings: patientQrSettings.data ?? DEFAULT_PATIENT_QR_SETTINGS }), [patientQrSettings.data, slipSettings.data]);
  const ready = Boolean(appointment.data && !appointment.isLoading && !appointment.isFetching && !appointment.error && !settingsFailed);
  const key = `${appointmentId}:${autoprint}`;
  const preview = useQuery({ queryKey: ["print-appointment-slip-preview", appointment.data?.id, appointment.data?.updatedAt, options], queryFn: () => appointment.data ? prepareAppointmentSlipHtml(appointment.data, options) : null, enabled: ready, staleTime: 0 });
  useEffect(() => {
    if (!autoprint || !ready || autoprintDoneKey === key || !appointment.data) return;
    const timer = window.setTimeout(() => { printAppointmentSlip(appointment.data!, options); setAutoprintDoneKey(key); }, 300);
    return () => window.clearTimeout(timer);
  }, [appointment.data, autoprint, autoprintDoneKey, key, options, ready]);
  const settingsMessage = slipSettings.error && patientQrSettings.error ? "Appointment Slip Settings and Patient QR Settings could not be loaded." : slipSettings.error ? "Appointment Slip Settings could not be loaded." : patientQrSettings.error ? "Patient QR Settings could not be loaded." : "";
  return <div className="max-w-5xl mx-auto p-4 space-y-4"><Card className="p-4 sm:p-6 space-y-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-xl sm:text-2xl font-bold">{t(language, "print.previewTitle")}</h2><p className="text-sm text-muted-foreground">{t(language, "print.previewSubtitle")}</p>{settingsFailed ? <div className="mt-2 text-sm text-amber-700"><p>{settingsMessage} Using defaults is not permitted for this preview.</p>{slipSettings.error ? <p>Appointment Slip Settings error: {describeError(slipSettings.error) || "Unknown error"}</p> : null}{patientQrSettings.error ? <p>Patient QR Settings error: {describeError(patientQrSettings.error) || "Unknown error"}</p> : null}</div> : null}</div><div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => navigate("/print")}>{t(language, "common.cancel")}</Button><Button onClick={() => appointment.data && printAppointmentSlip(appointment.data, options)} disabled={!ready || preview.isFetching}>{t(language, "print.confirmPrint")}</Button></div></div>{appointment.error ? <div className="p-8 text-center text-rose-700"><p>Appointment could not be loaded.</p><p className="mt-1 text-sm">{describeError(appointment.error) || "Unknown error"}</p></div> : appointment.isLoading || preview.isFetching ? <div className="p-8 text-center text-muted-foreground">{t(language, "print.loading")}</div> : preview.data ? <div className="overflow-auto rounded-xl border border-border bg-muted/20 p-3"><iframe key={preview.data} title="Appointment slip preview" srcDoc={preview.data} className="h-[1120px] w-full rounded-lg bg-white shadow-sm" loading="eager" /></div> : settingsFailed ? <div className="p-8 text-center text-amber-700">{settingsMessage}</div> : <div className="p-8 text-center text-muted-foreground">{t(language, "print.loading")}</div>}</Card></div>;
}
