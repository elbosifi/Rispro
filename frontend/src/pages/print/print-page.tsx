import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchAppointments,
  fetchAppointmentLookups,
  getAppointmentById,
} from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { printAppointmentSlip } from "@/lib/print-utils";
import { DateInput } from "@/components/common/date-input";
import { AppointmentEditor } from "@/components/appointments/appointment-editor";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { Button, Card } from "@/components/shared";

function EditedBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      Edited
    </span>
  );
}

export default function PrintPage() {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentWithDetails | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [autoprintDone, setAutoprintDone] = useState(false);
  const appointmentIdParam = searchParams.get("appointmentId");
  const autoprintParam = searchParams.get("autoprint") === "1";
  const printTargetKey = `appointment:${appointmentIdParam ?? ""}`;

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

  const { data: appointmentById } = useQuery({
    queryKey: ["print-appointment", appointmentIdParam],
    queryFn: () => getAppointmentById(parseInt(appointmentIdParam!, 10)),
    enabled: !!appointmentIdParam && !isNaN(parseInt(appointmentIdParam, 10)),
    staleTime: 1000 * 30,
  });

  useEffect(() => {
    if (appointmentById && !autoprintDone) {
      setSelectedAppointment(appointmentById);
      if (autoprintParam) {
        setTimeout(() => {
          printAppointmentSlip(appointmentById);
          setAutoprintDone(true);
        }, 300);
      }
    }
  }, [appointmentById, autoprintParam, autoprintDone]);

  function handlePrintSlip(appointment: AppointmentWithDetails) {
    printAppointmentSlip(appointment);
  }

  function handlePrintList(
    appointments: AppointmentWithDetails[],
    date: string,
  ) {
    // Print list functionality
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

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold">{t(language, "print.title")}</h2>
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
              {t(language, "print.listHeading", { count: appointments.length })}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={appointments.length === 0}
                onClick={() => handlePrintList(appointments, date)}
              >
                {t(language, "print.printList")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!selectedAppointment}
                onClick={() =>
                  selectedAppointment && handlePrintSlip(selectedAppointment)
                }
              >
                {t(language, "print.printSlip")}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
