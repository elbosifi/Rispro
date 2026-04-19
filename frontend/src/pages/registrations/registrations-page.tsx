import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cancelAppointment, fetchAppointments, fetchAppointmentLookups } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { DateInput } from "@/components/common/date-input";
import { useLanguage } from "@/providers/language-provider";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { pushToast } from "@/lib/toast";
import { Card } from "@/components/shared/Card";
import { Input } from "@/components/shared/Input";

interface RegistrationsFilters {
  date: string;
  dateFrom: string;
  dateTo: string;
  modalityId: string;
  query: string;
  status: string[];
}

export default function RegistrationsPage() {
  const { language, t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<RegistrationsFilters>({
    date: todayIsoDateLy(),
    dateFrom: "",
    dateTo: "",
    modalityId: "",
    query: "",
    status: ["scheduled"]
  });

  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithDetails | null>(null);
  const cancelMutation = useMutation({
    mutationFn: (appointmentId: number) => cancelAppointment(appointmentId, "Cancelled from registrations"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["registrations"] });
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      pushToast({
        type: "success",
        title: "Appointment cancelled",
        message: "Appointment status changed to cancelled."
      });
      setSelectedAppointment(null);
    },
    onError: (err: any) => {
      pushToast({
        type: "error",
        title: "Cancel failed",
        message: err?.message || "Could not cancel appointment."
      });
    }
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["registrations", filters],
    queryFn: () => fetchRegistrations(filters)
  });

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const handleFilterChange = (key: keyof RegistrationsFilters, value: any) => {
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const handleStatusToggle = (status: string) => {
    setFilters((f) => {
      const current = f.status.includes(status);
      const newStatus = current ? f.status.filter((s) => s !== status) : [...f.status, status];
      return { ...f, status: newStatus.length > 0 ? newStatus : ["scheduled"] };
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t("registrations.title")}
          </h2>
        </div>
      </div>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <DateInput
            label={t("registrations.date")}
            value={filters.date}
            onChange={(v) => {
              handleFilterChange("date", v);
              handleFilterChange("dateFrom", "");
              handleFilterChange("dateTo", "");
            }}
          />
          <DateInput
            label={t("registrations.dateFrom")}
            value={filters.dateFrom}
            onChange={(v) => {
              handleFilterChange("dateFrom", v);
              if (v) handleFilterChange("date", "");
            }}
          />
          <DateInput
            label={t("registrations.dateTo")}
            value={filters.dateTo}
            onChange={(v) => {
              handleFilterChange("dateTo", v);
              if (v) handleFilterChange("date", "");
            }}
          />
          <Select
            label={t("registrations.modality")}
            value={filters.modalityId}
            onChange={(v) => handleFilterChange("modalityId", v)}
            options={[
              { value: "", label: t("registrations.all") },
              ...(lookups?.modalities ?? []).map((m) => ({
                value: m.id.toString(),
                label: chooseLocalized(language, m.nameAr, m.nameEn)
              }))
            ]}
          />
           <div>
             <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{t("registrations.search")}</label>
             <Input
               value={filters.query}
               onChange={(e) => handleFilterChange("query", e.target.value)}
               placeholder={t("registrations.searchPlaceholder")}
               dir="ltr"
             />
           </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-200 dark:border-stone-700">
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{t("registrations.status")}</span>
          {["scheduled", "arrived", "waiting", "completed", "no-show", "cancelled"].map((status) => (
            <button
              key={status}
              onClick={() => handleStatusToggle(status)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filters.status.includes(status)
                  ? "bg-teal-600 text-white"
                  : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-600"
              }`}
            >
              {statusLabel(language, status)}
            </button>
          ))}
         </div>
       </Card>

       <Card className="overflow-hidden">
        <div className="p-4 border-b border-stone-200 dark:border-stone-700">
          <h3 className="font-semibold text-stone-900 dark:text-white">
            {t("registrations.results", { count: isLoading ? "..." : appointments.length })}
          </h3>
        </div>
        {isLoading ? (
          <div className="p-8 text-center description-center">{t("common.loading")}</div>
        ) : appointments.length === 0 ? (
          <div className="p-8 text-center description-center">{t("registrations.noAppointmentsFound")}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
              <tr>
                <th className="text-start p-3">{t("registrations.accession")}</th>
                <th className="text-start p-3">{t("registrations.patient")}</th>
                <th className="text-start p-3">{t("registrations.dateCol")}</th>
                <th className="text-start p-3">{t("registrations.modalityCol")}</th>
                <th className="text-start p-3">{t("registrations.statusCol")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {appointments.map((apt) => (
                <tr
                  key={apt.id}
                  onClick={() => setSelectedAppointment(apt)}
                  className={`cursor-pointer transition-colors hover:bg-stone-50 dark:hover:bg-stone-700/50 ${
                    selectedAppointment?.id === apt.id ? "bg-teal-50 dark:bg-teal-900/20" : ""
                  }`}
                >
                  <td className="p-3 font-medium text-stone-900 dark:text-white">{apt.accessionNumber}</td>
                  <td className="p-3 text-stone-700 dark:text-stone-300">
                    {chooseLocalized(language, apt.arabicFullName, apt.englishFullName)}
                  </td>
                  <td className="p-3 description-center">{formatDateLy(apt.appointmentDate)}</td>
                  <td className="p-3 description-center">
                    {chooseLocalized(language, apt.modalityNameAr, apt.modalityNameEn)}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={apt.status} label={statusLabel(language, apt.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
           </table>
         )}
       </Card>

       {selectedAppointment && (
         <Card className="p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
                {t("registrations.details", { accession: selectedAppointment.accessionNumber })}
              </h3>
              {selectedAppointment.updatedAt && selectedAppointment.createdAt && selectedAppointment.updatedAt !== selectedAppointment.createdAt && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  Edited
                </span>
              )}
            </div>
            <button
              onClick={() => navigate(`/print?appointmentId=${selectedAppointment.id}`)}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Print
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field label={t("registrations.patient")} value={chooseLocalized(language, selectedAppointment.arabicFullName, selectedAppointment.englishFullName)} />
            <Field label={t("registrations.modality")} value={chooseLocalized(language, selectedAppointment.modalityNameAr, selectedAppointment.modalityNameEn)} />
            <Field label={t("registrations.date")} value={formatDateLy(selectedAppointment.appointmentDate)} />
            <Field label={t("registrations.statusCol")} value={statusLabel(language, selectedAppointment.status)} />
            <Field label={t("registrations.walkIn")} value={selectedAppointment.isWalkIn ? t("registrations.yes") : t("registrations.no")} />
            <Field label={t("registrations.notes")} value={selectedAppointment.notes} />
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
            {["scheduled", "arrived", "waiting"].includes(selectedAppointment.status) && (
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm("Cancel this appointment?")) return;
                    cancelMutation.mutate(selectedAppointment.id);
                  }}
                  className="rounded-lg bg-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600"
                >
                  Cancel appointment
                </button>
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
       )}
    </div>
  );
}

async function fetchRegistrations(filters: RegistrationsFilters) {
  const params: Record<string, string | string[]> = {};
  if (filters.dateFrom || filters.dateTo) {
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
  } else {
    params.date = filters.date;
  }
  if (filters.modalityId) params.modalityId = filters.modalityId;
  if (filters.query) params.q = filters.query;
  if (filters.status && filters.status.length > 0) {
    params.status = filters.status;
  }
  return fetchAppointments(params);
}



function Select({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-premium w-full">
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p className="description-center">{label}</p>
      <p className="mt-1 text-stone-900 dark:text-white font-medium">{value ?? "-"}</p>
    </div>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const styles: Record<string, string> = {
    scheduled: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400",
    arrived: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
    waiting: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
    completed: "bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400",
    "no-show": "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
    cancelled: "bg-stone-100 dark:bg-stone-900/30 text-stone-700 dark:text-stone-400"
  };

  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.scheduled}`}>{label}</span>;
}
