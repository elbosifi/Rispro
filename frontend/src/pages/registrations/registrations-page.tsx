import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelAppointment,
  fetchAppointments,
  fetchAppointmentLookups,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { pushToast } from "@/lib/toast";
import { Card, Button, SearchInput } from "@/components/shared";

interface RegistrationsFilters {
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  query: string;
  statuses: string[];
}

const DEFAULT_FILTERS: RegistrationsFilters = {
  date: todayIsoDateLy(),
  dateFrom: todayIsoDateLy(),
  dateTo: todayIsoDateLy(),
  modalityId: "",
  query: "",
  statuses: ["scheduled", "arrived", "waiting"],
};

export default function RegistrationsPage() {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RegistrationsFilters>(DEFAULT_FILTERS);
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentWithDetails | null>(null);

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["registrations", filters],
    queryFn: () =>
      fetchAppointments({
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        modalityId: filters.modalityId,
        q: filters.query,
        status: filters.statuses,
      }),
    staleTime: 1000 * 30,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelAppointment(id, "Cancelled from registrations"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      pushToast({
        type: "success",
        title: "Appointment cancelled",
        message: "Appointment status changed to cancelled.",
      });
      setSelectedAppointment(null);
    },
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: "Cancel failed",
        message: err?.message || "Could not cancel appointment.",
      });
    },
  });

  const modalities = lookups?.modalities ?? [];

  const handleFilterChange = <K extends keyof RegistrationsFilters>(
    key: K,
    value: RegistrationsFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleDateChange = (key: "date" | "dateFrom" | "dateTo", value: string) => {
    setFilters((current) => {
      if (key === "date") {
        return {
          ...current,
          date: value,
          dateFrom: "",
          dateTo: "",
        };
      }

      return {
        ...current,
        [key]: value,
        date: "",
      };
    });
  };

  const handleStatusToggle = (status: string) => {
    setFilters((current) => {
      const nextStatuses = current.statuses.includes(status)
        ? current.statuses.filter((entry) => entry !== status)
        : [...current.statuses, status];

      return {
        ...current,
        statuses: nextStatuses.length > 0 ? nextStatuses : current.statuses,
      };
    });
  };

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSelectedAppointment(null);
  };

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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-3 rounded-full border border-accent/30 bg-accent/5 px-5 py-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="font-mono text-xs uppercase tracking-[0.15em] text-accent">
              REGISTRATIONS
            </span>
          </span>
        </div>
        <h1
          className="text-3xl font-display"
          style={{ color: "var(--foreground)" }}
        >
          Appointment <span className="gradient-text">Registrations</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="p-5 sm:p-6">
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="text-lg font-semibold">
                    {t("registrations.filters")}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-xl">
                    Use a date or date range, then narrow by modality, status, or a quick text search.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleResetFilters}
                  className="sm:self-start w-full sm:w-auto"
                >
                  {t("registrations.reset")}
                </Button>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-5">
                <div className="space-y-4 rounded-2xl border border-border bg-muted/20 p-4">
                  <div>
                    <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
                      {t("registrations.dateFilters")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("registrations.dateFiltersHint")}
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="rounded-xl border border-border bg-background p-3">
                      <DateInput
                        label={t("registrations.date")}
                        value={filters.date}
                        onChange={(value) => handleDateChange("date", value)}
                      />
                    </div>

                    <div className="rounded-xl border border-border bg-background p-3">
                      <div className="mb-3">
                        <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
                          {t("registrations.dateFrom")} / {t("registrations.dateTo")}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t("registrations.rangeHint")}
                        </p>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <DateInput
                          label={t("registrations.dateFrom")}
                          value={filters.dateFrom}
                          onChange={(value) => handleDateChange("dateFrom", value)}
                        />
                        <DateInput
                          label={t("registrations.dateTo")}
                          value={filters.dateTo}
                          onChange={(value) => handleDateChange("dateTo", value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-4">
                  <div>
                    <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">
                      {t("registrations.searchFilters")}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("registrations.searchFiltersHint")}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5 text-muted-foreground">
                        {t("registrations.modality")}
                      </label>
                      <select
                        value={filters.modalityId}
                        onChange={(e) => handleFilterChange("modalityId", e.target.value)}
                        className="input-premium input-ltr w-full min-h-12"
                      >
                        <option value="">{t("registrations.all")}</option>
                        {modalities.map((modality: any) => (
                          <option key={modality.id} value={String(modality.id)}>
                            {modality.nameEn ?? modality.name ?? modality.code ?? `#${modality.id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-mono-data uppercase tracking-[0.08em] mb-1.5 text-muted-foreground">
                        {t("registrations.search")}
                      </label>
                      <SearchInput
                        placeholder={t("registrations.searchPlaceholder")}
                        value={filters.query}
                        onChange={(e) => handleFilterChange("query", e.target.value)}
                        showClearButton
                        onClear={() => handleFilterChange("query", "")}
                        className="w-full min-h-12"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">
                    {t("registrations.status")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("registrations.statusHint")}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {["scheduled", "arrived", "waiting", "completed", "no-show", "cancelled"].map(
                    (status) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleStatusToggle(status)}
                        className={`min-h-10 px-3 py-2 rounded-full text-xs font-medium transition-colors ${
                          filters.statuses.includes(status)
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                        }`}
                      >
                        {status}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="text-xl font-semibold">
                {t("registrations.title")}
              </h3>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : appointments.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {t("queue.empty")}
                </div>
              ) : (
                <ul className="divide-y divide-border max-h-[500px] overflow-y-auto">
                  {appointments.map((apt: AppointmentWithDetails) => (
                    <li
                      key={apt.id}
                      onClick={() => setSelectedAppointment(apt)}
                      className={`p-4 hover:bg-muted/50 transition-colors cursor-pointer ${
                        selectedAppointment?.id === apt.id ? "bg-accent/10" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium">
                            {chooseLocalized(
                              language,
                              apt.arabicFullName,
                              apt.englishFullName,
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground font-mono">
                            {apt.accessionNumber} • {apt.modalityNameEn}
                          </p>
                        </div>
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {statusLabel(language, apt.status)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          {selectedAppointment ? (
            <Card className="p-6">
              <div className="flex items-center justify-between gap-3 mb-6">
                <h3 className="text-xl font-semibold">
                  {t("calendar.title")}
                </h3>
                <Button
                  onClick={() =>
                    navigate(`/print?appointmentId=${selectedAppointment.id}`)
                  }
                >
                  Print
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <Field
                  label={t("registrations.patient")}
                  value={chooseLocalized(
                    language,
                    selectedAppointment.arabicFullName,
                    selectedAppointment.englishFullName,
                  )}
                />
                <Field
                  label={t("registrations.modality")}
                  value={chooseLocalized(
                    language,
                    selectedAppointment.modalityNameAr,
                    selectedAppointment.modalityNameEn,
                  )}
                />
                <Field
                  label={t("registrations.date")}
                  value={formatDateLy(selectedAppointment.appointmentDate)}
                />
                <Field
                  label={t("registrations.statusCol")}
                  value={statusLabel(language, selectedAppointment.status)}
                />
                <Field
                  label={t("registrations.walkIn")}
                  value={
                    selectedAppointment.isWalkIn
                      ? t("registrations.yes")
                      : t("registrations.no")
                  }
                />
                <Field
                  label={t("registrations.notes")}
                  value={selectedAppointment.notes}
                />
              </div>
              <div className="mt-6">
                <RequestDocumentsPanel
                  appointmentId={selectedAppointment.id}
                  patientId={selectedAppointment.patientId}
                  appointmentRefType="v2_booking"
                  title="Request Documents"
                />
              </div>
              <div className="mt-6">
                {["scheduled", "arrived", "waiting"].includes(
                  selectedAppointment.status,
                ) && (
                  <div className="mb-3 flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      style={{ color: "#ef4444" }}
                      onClick={() => {
                        if (!window.confirm("Cancel this appointment?")) return;
                        cancelMutation.mutate(selectedAppointment.id);
                      }}
                    >
                      Cancel appointment
                    </Button>
                  </div>
                )}
                <AppointmentEditor
                  appointment={selectedAppointment}
                  lookups={lookups}
                  onUpdated={(updated) => setSelectedAppointment(updated)}
                  onDeleted={() => setSelectedAppointment(null)}
                />
              </div>
            </Card>
          ) : (
            <Card className="p-6 h-full flex items-center justify-center">
              <p className="text-muted-foreground text-center">
                {t("doctor.selectPrompt")}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
