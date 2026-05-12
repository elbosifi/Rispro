import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import {
  DEFAULT_APPOINTMENT_SLIP_SETTINGS,
  DEFAULT_PATIENT_QR_SETTINGS,
  fetchAppointments,
  fetchAppointmentLookups,
  fetchAppointmentSlipSettings,
  fetchPatientQrSettings,
  getAppointmentById,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import {
  filterVisibleAppointments,
  prepareAppointmentSlipHtml,
  printAppointmentList,
  printAppointmentSlip,
} from "@/lib/print-utils";
import { buildAppointmentPrintUrl } from "@/lib/print-routing";
import { DateInput } from "@/components/common/date-input";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { Button, Card } from "@/components/shared";
import { ReportCenter } from "./report-center";

function describeQueryError(error: unknown): string {
  if (!error) return "";
  if (error instanceof ApiError) {
    return `HTTP ${error.status}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function EditedBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      Edited
    </span>
  );
}

export default function PrintPage() {
  const [searchParams] = useSearchParams();
  return searchParams.get("appointmentId") ? <DirectAppointmentPrintPage /> : <ReportCenter />;
}

function DirectAppointmentPrintPage() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [slipPreviewHtml, setSlipPreviewHtml] = useState<string | null>(null);
  const [slipPreviewLoading, setSlipPreviewLoading] = useState(false);
  const [autoprintDone, setAutoprintDone] = useState(false);
  const appointmentIdParam = searchParams.get("appointmentId");
  const isDirectPreview = Boolean(appointmentIdParam);
  const autoprintParam = searchParams.get("autoprint") === "1";
  const appointmentIdNumber = appointmentIdParam ? parseInt(appointmentIdParam, 10) : NaN;

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["print-appointments", date, modalityId, query],
    queryFn: () =>
      fetchAppointments({
        date,
        ...(modalityId && { modalityId }),
        ...(query && { q: query }),
      }),
    staleTime: 1000 * 30,
  });
  const visibleAppointments = useMemo(() => filterVisibleAppointments(appointments), [appointments]);

  const {
    data: appointmentById,
    isLoading: appointmentByIdLoading,
    error: appointmentByIdError,
  } = useQuery({
    queryKey: ["print-appointment", appointmentIdParam],
    queryFn: () => getAppointmentById(appointmentIdNumber),
    enabled: isDirectPreview && !isNaN(appointmentIdNumber),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const {
    data: slipSettings,
    error: slipSettingsError,
  } = useQuery({
    queryKey: ["appointment-slip-settings"],
    queryFn: fetchAppointmentSlipSettings,
    staleTime: 1000 * 60,
  });
  const {
    data: patientQrSettings,
    error: patientQrSettingsError,
  } = useQuery({
    queryKey: ["patient-qr-settings"],
    queryFn: fetchPatientQrSettings,
    staleTime: 1000 * 60,
  });
  const effectiveSlipSettings = slipSettings ?? DEFAULT_APPOINTMENT_SLIP_SETTINGS;
  const effectivePatientQrSettings = patientQrSettings ?? DEFAULT_PATIENT_QR_SETTINGS;
  const renderOptions = useMemo(
    () => ({ slipSettings: effectiveSlipSettings, patientQrSettings: effectivePatientQrSettings }),
    [effectiveSlipSettings, effectivePatientQrSettings]
  );
  const settingsReady = Boolean(renderOptions);
  const slipSettingsFailed = Boolean(slipSettingsError);
  const patientQrSettingsFailed = Boolean(patientQrSettingsError);
  const settingsLoadFailed = slipSettingsFailed || patientQrSettingsFailed;
  const slipSettingsErrorDetails = describeQueryError(slipSettingsError);
  const patientQrSettingsErrorDetails = describeQueryError(patientQrSettingsError);
  const settingsFailureSummary = slipSettingsFailed && patientQrSettingsFailed
    ? "Appointment Slip Settings and Patient QR Settings could not be loaded. Using defaults for this print preview."
    : slipSettingsFailed
      ? "Appointment Slip Settings could not be loaded. Using defaults for this print preview."
      : patientQrSettingsFailed
        ? "Patient QR Settings could not be loaded. Using defaults for this print preview."
        : "";
  const appointmentByIdErrorDetails = describeQueryError(appointmentByIdError);
  const activePrintAppointment = isDirectPreview ? (appointmentById ?? null) : selectedAppointment;

  useEffect(() => {
    if (!isDirectPreview) return;
    setAutoprintDone(false);
  }, [appointmentIdParam, autoprintParam, isDirectPreview]);

  useEffect(() => {
    let cancelled = false;
    if (!isDirectPreview || !activePrintAppointment || !renderOptions || appointmentByIdLoading || appointmentByIdError || settingsLoadFailed) {
      return () => {
        cancelled = true;
      };
    }
    setSlipPreviewLoading(true);
    void prepareAppointmentSlipHtml(activePrintAppointment, renderOptions)
      .then((html) => {
        if (cancelled || !html) return;
        setSlipPreviewHtml(html);
      })
      .finally(() => {
        if (!cancelled) setSlipPreviewLoading(false);
      });

    if (autoprintParam && !autoprintDone) {
      setTimeout(() => {
        printAppointmentSlip(activePrintAppointment, renderOptions);
        setAutoprintDone(true);
      }, 300);
    }
    return () => {
      cancelled = true;
    };
  }, [
    activePrintAppointment,
    appointmentByIdError,
    appointmentByIdLoading,
    autoprintParam,
    autoprintDone,
    isDirectPreview,
    renderOptions,
    settingsLoadFailed,
  ]);

  function openSlipPreview(appointment: AppointmentWithDetails) {
    navigate(buildAppointmentPrintUrl(appointment.id));
  }

  function handlePrintSlip(appointment: AppointmentWithDetails) {
    if (!renderOptions) return;
    printAppointmentSlip(appointment, renderOptions);
  }

  function handlePrintList(
    appointments: AppointmentWithDetails[],
    date: string,
  ) {
    printAppointmentList(appointments, date);
  }

  function todayList() {
    setDate(todayIsoDateLy());
  }

  function tomorrowList() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().slice(0, 10));
  }

  function Field({ label, value }: { label: string; value: any }) {
    return (
      <div className="p-3 rounded-xl border border-border bg-muted/30">
        <p className="text-xs uppercase tracking-[0.15em] font-mono text-muted-foreground mb-1">
          {label}
        </p>
        <p className="font-medium">{value ?? "—"}</p>
      </div>
    );
  }

  function Select({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
  }) {
    return (
      <div>
        <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">
          {label}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input-premium input-ltr w-full"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  function Input({
    label,
    value,
    onChange,
    placeholder,
    type = "text",
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
  }) {
    return (
      <div>
        <label className="block text-xs uppercase tracking-[0.15em] font-mono mb-2 text-muted-foreground">
          {label}
        </label>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="input-premium input-ltr w-full"
        />
      </div>
    );
  }

  const modalities = lookups?.modalities ?? [];

  useEffect(() => {
    if (isDirectPreview) return;
    if (visibleAppointments.length === 0) {
      setSelectedAppointment(null);
      return;
    }

    const matchingAppointment = selectedAppointment
      ? visibleAppointments.find((appointment) => appointment.id === selectedAppointment.id)
      : null;

    if (!selectedAppointment) {
      setSelectedAppointment(visibleAppointments[0]);
      return;
    }

    if (matchingAppointment && matchingAppointment !== selectedAppointment) {
      setSelectedAppointment(matchingAppointment);
      return;
    }

    if (!matchingAppointment) {
      setSelectedAppointment(visibleAppointments[0]);
    }
  }, [isDirectPreview, visibleAppointments, selectedAppointment]);

  if (isDirectPreview) {
    return (
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        <Card className="p-4 sm:p-6 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold">{t(language, "print.previewTitle")}</h2>
              <p className="text-sm text-muted-foreground">
                {t(language, "print.previewSubtitle")}
              </p>
              {settingsLoadFailed ? (
                <div className="mt-2 space-y-1 text-sm text-amber-700">
                  <p>{settingsFailureSummary}</p>
                  {slipSettingsFailed ? <p>Appointment Slip Settings error: {slipSettingsErrorDetails || "Unknown error"}</p> : null}
                  {patientQrSettingsFailed ? <p>Patient QR Settings error: {patientQrSettingsErrorDetails || "Unknown error"}</p> : null}
                  {import.meta.env.DEV ? (
                    <p className="font-mono text-xs text-amber-900">
                      debug: slip={slipSettingsErrorDetails || "ok"} | qr={patientQrSettingsErrorDetails || "ok"}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => navigate("/print")}>
                {t(language, "common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => activePrintAppointment && handlePrintSlip(activePrintAppointment)}
                disabled={!activePrintAppointment || appointmentByIdLoading || slipPreviewLoading || !settingsReady || settingsLoadFailed}
              >
                {t(language, "print.confirmPrint")}
              </Button>
            </div>
          </div>

          {appointmentByIdError ? (
            <div className="p-8 text-center text-rose-700">
              <p>Appointment could not be loaded.</p>
              <p className="mt-1 text-sm">{appointmentByIdErrorDetails || "Unknown error"}</p>
            </div>
          ) : appointmentByIdLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t(language, "print.loading")}
            </div>
          ) : slipPreviewLoading ? (
            <div className="p-8 text-center text-muted-foreground">
              {t(language, "print.loading")}
            </div>
          ) : slipPreviewHtml ? (
            <div className="overflow-auto rounded-xl border border-border bg-muted/20 p-3">
              <iframe
                key={slipPreviewHtml}
                title="Appointment slip preview"
                srcDoc={slipPreviewHtml}
                className="w-full h-[1120px] bg-white rounded-lg shadow-sm"
                loading="eager"
              />
            </div>
          ) : settingsLoadFailed ? (
            <div className="p-8 text-center text-amber-700">
              {settingsFailureSummary}
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              {t(language, "print.loading")}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 lg:hidden">
        <h2 className="text-xl sm:text-2xl font-bold">{t(language, "print.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={todayList}>
            {t(language, "print.today")}
          </Button>
          <Button type="button" variant="secondary" onClick={tomorrowList}>
            {t(language, "print.tomorrow")}
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DateInput
            label={t(language, "common.date")}
            value={date}
            onChange={setDate}
          />
          <Select
            label={t(language, "common.modality")}
            value={modalityId}
            onChange={setModalityId}
            options={[
              { value: "", label: t(language, "print.all") },
              ...modalities.map((m: any) => ({
                value: m.id.toString(),
                label: m.nameEn,
              })),
            ]}
          />
          <Input
            label={t(language, "common.search")}
            type="text"
            value={query}
            onChange={setQuery}
            placeholder={t(language, "print.searchPlaceholder")}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">
              {t(language, "print.listHeading", { count: visibleAppointments.length })}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={visibleAppointments.length === 0}
                onClick={() => handlePrintList(visibleAppointments, date)}
              >
                {t(language, "print.printList")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!selectedAppointment}
                onClick={() => selectedAppointment && openSlipPreview(selectedAppointment)}
              >
                {t(language, "print.printSlip")}
              </Button>
            </div>
          </div>

          <div className="p-4">
            {isLoading ? (
              <div className="p-6 text-center text-muted-foreground">
                {t(language, "print.loading")}
              </div>
            ) : visibleAppointments.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground">
                {t(language, "print.empty")}
              </div>
            ) : (
              <ul className="divide-y divide-border max-h-[520px] overflow-y-auto">
                {visibleAppointments.map((appointment) => (
                  <li
                    key={appointment.id}
                    className={`p-3 cursor-pointer transition-colors ${
                      selectedAppointment?.id === appointment.id ? "bg-accent/10" : "hover:bg-muted/40"
                    }`}
                    onClick={() => setSelectedAppointment(appointment)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">
                          {appointment.englishFullName || appointment.arabicFullName}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {appointment.accessionNumber} • {appointment.modalityNameEn || "—"} • {formatDateLy(appointment.appointmentDate)}
                        </p>
                      </div>
                      {selectedAppointment?.id === appointment.id ? <EditedBadge /> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="p-4 border-b border-border">
            <h3 className="font-semibold">{t(language, "print.slipPreview")}</h3>
          </div>

          <div className="p-4 space-y-4">
            {!selectedAppointment ? (
              <div className="p-6 text-center text-muted-foreground">
                {t(language, "print.selectPrompt")}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label={t(language, "print.patientLabel")} value={selectedAppointment.englishFullName || selectedAppointment.arabicFullName} />
                  <Field label={t(language, "print.accessionLabel")} value={selectedAppointment.accessionNumber} />
                  <Field label={t(language, "print.mrnLabel")} value={selectedAppointment.mrn || "—"} />
                  <Field label={t(language, "print.dateLabel")} value={formatDateLy(selectedAppointment.appointmentDate)} />
                  <Field label={t(language, "print.modalityLabel")} value={selectedAppointment.modalityNameEn || "—"} />
                  <Field label={t(language, "print.examLabel")} value={selectedAppointment.examNameEn || "—"} />
                  <Field label={t(language, "print.statusLabel")} value={selectedAppointment.status || "—"} />
                  <Field label={t(language, "print.walkInLabel")} value={selectedAppointment.isWalkIn ? t(language, "print.walkInYes") : t(language, "print.walkInNo")} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => openSlipPreview(selectedAppointment)}>
                    {t(language, "print.printSelected")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
