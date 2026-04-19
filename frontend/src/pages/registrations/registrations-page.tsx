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
import { Card, Button } from "@/components/shared";

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
    mutationFn: cancelAppointment,
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
          <Card className="overflow-hidden">
            <div className="p-4 border-b border-border">
              <h3 className="text-xl font-semibold">
                {t("registrations.title")}
              </h3>
            </div>
            <div className="p-4">
              {isLoading ? (
                <div className="p-8 text-center text-muted-foreground">
                  {t("registrations.loading")}
                </div>
              ) : appointments.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  {t("registrations.noAppointments")}
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
                  {t("registrations.appointmentDetails")}
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
                {t("registrations.selectPrompt")}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
