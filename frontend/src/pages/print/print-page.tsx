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

function EditedBadge() {
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Edited</span>;
}

export default function PrintPage() {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(todayIsoDateLy());
  const [modalityId, setModalityId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentWithDetails | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [autoprintDone, setAutoprintDone] = useState(false);
  const appointmentIdParam = searchParams.get("appointmentId");
  const autoprintParam = searchParams.get("autoprint") === "1";
  const printTargetKey = `appointment:${appointmentIdParam ?? ""}`;

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5
  });

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ["print-appointments", date, modalityId, query],
    queryFn: () => fetchAppointments({ date, ...(modalityId && { modalityId }), ...(query && { q: query }) }),
    staleTime: 1000 * 30
  });

  const { data: appointmentById } = useQuery({
    queryKey: ["print-appointment", appointmentIdParam],
    queryFn: () => getAppointmentById(parseInt(appointmentIdParam!, 10)),
    enabled: !!appointmentIdParam && !isNaN(parseInt(appointmentIdParam, 10)),
    staleTime: 1000 * 30
  });

  useEffect(() => {
    const dateParam = searchParams.get("date");
    if (dateParam) setDate(dateParam);
  }, [searchParams]);

  useEffect(() => {
    setAutoprintDone(false);
  }, [printTargetKey]);

  useEffect(() => {
    if (appointmentById) {
      setSelectedAppointment(appointmentById);
      setIsEditing(false);
    }
  }, [appointmentById]);

  useEffect(() => {
    if (!appointmentIdParam) return;
    const match = appointments.find((apt) => String(apt.id) === appointmentIdParam);
    if (match) setSelectedAppointment(match);
  }, [appointmentIdParam, appointments]);

  useEffect(() => {
    if (!autoprintParam || !selectedAppointment || autoprintDone) return;
    setAutoprintDone(true);
    printAppointmentSlip(selectedAppointment);
  }, [autoprintParam, selectedAppointment, autoprintDone]);

  const handlePrintSlip = (apt: AppointmentWithDetails) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const now = new Date().toLocaleString();
    printWindow.document.write(`
      <html>
        <head>
          <title>Appointment Slip</title>
          <style>
            @page { size: A5 portrait; margin: 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
            .slip { width: 100%; min-height: 100%; border: 2px solid #0f766e; border-radius: 14px; padding: 16px; }
            .header { text-align: center; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #d1d5db; }
            .brand { margin: 0; font-size: 20px; font-weight: 800; color: #0f766e; }
            .title { margin: 4px 0 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.16em; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; font-size: 12px; }
            .field { min-height: 48px; padding: 8px 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; }
            .field.full { grid-column: 1 / -1; }
            .label { display: block; margin-bottom: 4px; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
            .value { font-size: 13px; font-weight: 700; color: #111827; word-break: break-word; }
            .footer { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #d1d5db; display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: #6b7280; }
            .rtl { direction: rtl; text-align: right; }
          </style>
        </head>
        <body>
          <div class="slip">
            <div class="header">
              <p class="brand">RISpro Reception</p>
              <p class="title">Appointment Slip</p>
            </div>
            <div class="meta">
              ${slipField("Accession", apt.accessionNumber)}
              ${slipField("Appointment Date", formatDateLy(apt.appointmentDate))}
              ${slipField("Patient", apt.arabicFullName, true)}
              ${slipField("English Name", apt.englishFullName || "—")}
              ${slipField("National ID", apt.nationalId || "—")}
              ${slipField("MRN", apt.mrn || "—")}
              ${slipField("Age / Sex", `${apt.ageYears ?? "—"}${apt.demographicsEstimated ? " (Estimated)" : ""} / ${apt.sex || "—"}`)}
              ${slipField("Phone", apt.phone1 || "—")}
              ${slipField("Modality", apt.modalityNameEn || "—")}
              ${(apt.modalityGeneralInstructionAr || apt.modalityGeneralInstructionEn) ? slipField("Modality Notes", apt.modalityGeneralInstructionAr || apt.modalityGeneralInstructionEn || "—", Boolean(apt.modalityGeneralInstructionAr)) : ""}
              ${slipField("Exam", apt.examNameEn || "—")}
              ${slipField("Priority", apt.priorityNameEn || "Routine")}
              ${slipField("Status", apt.status || "—")}
              ${slipField("Walk-In", apt.isWalkIn ? "Yes" : "No")}
              ${slipField("Sequence", String(apt.dailySequence ?? "—"))}
              ${slipField("Slot", apt.modalitySlotNumber ? String(apt.modalitySlotNumber) : "—")}
              ${slipField("Created", apt.createdAt ? formatDateLy(apt.createdAt) : "—")}
              ${apt.notes ? `<div class="field full"><span class="label">Notes</span><span class="value">${escapeHtml(apt.notes)}</span></div>` : ""}
            </div>
            <div class="footer">
              <span>Printed by RISpro</span>
              <span>${escapeHtml(now)}</span>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const handlePrintList = (list: AppointmentWithDetails[], listDate: string) => {
    if (list.length === 0) return;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const now = new Date().toLocaleString();
    printWindow.document.write(`
      <html>
        <head>
          <title>Appointment List</title>
          <style>
            @page { size: A4 landscape; margin: 8mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
            .slip { width: 100%; min-height: 100%; border: 1.5px solid #0f766e; border-radius: 12px; padding: 10px; }
            .header { text-align: center; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid #d1d5db; }
            .brand { margin: 0; font-size: 17px; font-weight: 800; color: #0f766e; }
            .title { margin: 3px 0 0; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.14em; }
            .summary { margin: 0 0 8px; font-size: 10px; color: #374151; text-align: center; }
            .row {
              display: grid;
              grid-template-columns: 22mm 2fr 22mm 1fr 22mm 1.1fr 22mm 1.5fr;
              gap: 5px 7px;
              align-items: center;
              padding: 10px 12px;
              border-bottom: 1px solid #e5e7eb;
              font-size: 11px;
            }
            .row:nth-child(odd) {
              background: #f8fafc;
            }
            .row:nth-child(even) {
              background: #eef6f5;
            }
            .label { font-size: 8.5px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
            .value { font-size: 11px; font-weight: 700; color: #111827; word-break: break-word; line-height: 1.25; }
            .arabic { direction: rtl; text-align: right; }
            .footer { margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d1d5db; display: flex; justify-content: space-between; gap: 12px; font-size: 8px; color: #6b7280; }
          </style>
        </head>
        <body>
          <div class="slip">
            <div class="header">
              <p class="brand">RISpro Reception</p>
              <p class="title">Appointment List</p>
            </div>
            <p class="summary">Date: ${escapeHtml(formatDateLy(listDate))} - Total: ${list.length}</p>
            ${list
              .map(
                (apt) => `
                <div class="row">
                  <span class="label">Accession</span><span class="value">${escapeHtml(apt.accessionNumber)}</span>
                  <span class="label">Patient</span><span class="value arabic">${escapeHtml(apt.arabicFullName)}</span>
                  <span class="label">Modality</span><span class="value">${escapeHtml(apt.modalityNameEn || "—")}</span>
                  <span class="label">Status</span><span class="value">${escapeHtml(apt.status || "—")}</span>
                  <span class="label">Exam</span><span class="value">${escapeHtml(apt.examNameEn || "—")}</span>
                  <span class="label">Slot</span><span class="value">${escapeHtml(apt.modalitySlotNumber ? String(apt.modalitySlotNumber) : "—")}</span>
                  <span class="label">Priority</span><span class="value">${escapeHtml(apt.priorityNameEn || "Routine")}</span>
                  <span class="label">Notes</span><span class="value arabic">${escapeHtml(apt.notes || "—")}</span>
                </div>
              `
              )
              .join("")}
            <div class="footer">
              <span>Printed by RISpro</span>
              <span>${escapeHtml(now)}</span>
            </div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const todayList = () => {
    const today = todayIsoDateLy();
    setDate(today);
    setModalityId("");
    setQuery("");
  };

  const tomorrowList = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().slice(0, 10));
    setModalityId("");
    setQuery("");
  };

  const modalities = lookups?.modalities ?? [];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t(language, "print.title")}</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={todayList} className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 transition-colors">
            {t(language, "print.today")}
          </button>
          <button type="button" onClick={tomorrowList} className="px-4 py-2 rounded-xl bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm font-medium hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors">
            {t(language, "print.tomorrow")}
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DateInput label={t(language, "common.date")} value={date} onChange={setDate} />
          <Select
            label={t(language, "common.modality")}
            value={modalityId}
            onChange={setModalityId}
            options={[
              { value: "", label: t(language, "print.all") },
              ...modalities.map((m: any) => ({
                value: m.id.toString(),
                label: m.nameEn
              }))
            ]}
          />
          <Input label={t(language, "common.search")} type="text" value={query} onChange={setQuery} placeholder={t(language, "print.searchPlaceholder")} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-stone-200 dark:border-stone-700">
            <h3 className="font-semibold text-stone-900 dark:text-white">{t(language, "print.listHeading", { count: appointments.length })}</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={appointments.length === 0}
                onClick={() => handlePrintList(appointments, date)}
                className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-40 transition-colors"
              >
                {t(language, "print.printList")}
              </button>
              <button
                type="button"
                disabled={!selectedAppointment}
                onClick={() => selectedAppointment && handlePrintSlip(selectedAppointment)}
                className="px-3 py-1.5 rounded-lg bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm font-medium hover:bg-stone-200 dark:hover:bg-stone-600 disabled:opacity-40 transition-colors"
              >
                {t(language, "print.printSelected")}
              </button>
            </div>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-stone-500">{t(language, "print.loading")}</div>
          ) : appointments.length === 0 ? (
            <div className="p-8 text-center text-stone-500">{t(language, "print.empty")}</div>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-700 max-h-[600px] overflow-y-auto">
              {appointments.map((apt) => (
                <li key={apt.id}>
                  <div className="p-4 flex items-center justify-between hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors">
                    <button onClick={() => setSelectedAppointment(apt)} className="text-right flex-1">
                      <p className="font-medium text-stone-900 dark:text-white">{apt.accessionNumber}</p>
                      <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                        {apt.arabicFullName} • {apt.modalityNameEn}
                      </p>
                    </button>
                    <button
                      onClick={() => handlePrintSlip(apt)}
                      className="ml-4 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      {t(language, "common.print")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          {selectedAppointment ? (
            <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-stone-900 dark:text-white">{t(language, "print.slipPreview")}</h3>
                  {selectedAppointment.updatedAt && selectedAppointment.createdAt && selectedAppointment.updatedAt !== selectedAppointment.createdAt && (
                    <EditedBadge />
                  )}
                </div>
                <button
                  onClick={() => handlePrintSlip(selectedAppointment)}
                  className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {t(language, "print.printSlip")}
                </button>
              </div>
              <div className="space-y-4 border-2 border-dashed border-stone-300 dark:border-stone-600 rounded-lg p-6 max-w-[148mm] mx-auto">
                <div className="text-center pb-4 border-b border-stone-200 dark:border-stone-700">
                  <h2 className="text-2xl font-bold text-teal-700 dark:text-teal-500">RISpro Reception</h2>
                  <p className="text-xs tracking-[0.2em] uppercase text-stone-500 dark:text-stone-400">Appointment Slip</p>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Field label="Accession" value={selectedAppointment.accessionNumber} />
                  <Field label="Appointment Date" value={formatDateLy(selectedAppointment.appointmentDate)} />
                  <Field label="Patient" value={selectedAppointment.arabicFullName} rtl />
                  <Field label="English Name" value={selectedAppointment.englishFullName || "—"} />
                  <Field label="National ID" value={selectedAppointment.nationalId || "—"} />
                  <Field label="MRN" value={selectedAppointment.mrn || "—"} />
                  <Field label="Age / Sex" value={`${selectedAppointment.ageYears ?? "—"}${selectedAppointment.demographicsEstimated ? " (Estimated)" : ""} / ${selectedAppointment.sex || "—"}`} />
                  <Field label="Phone" value={selectedAppointment.phone1 || "—"} />
                  <Field label="Modality" value={selectedAppointment.modalityNameEn || "—"} />
                  {(selectedAppointment.modalityGeneralInstructionAr || selectedAppointment.modalityGeneralInstructionEn) && (
                    <div className="col-span-2">
                      <Field
                        label="Modality Notes"
                        value={selectedAppointment.modalityGeneralInstructionAr || selectedAppointment.modalityGeneralInstructionEn || "—"}
                        rtl={Boolean(selectedAppointment.modalityGeneralInstructionAr)}
                      />
                    </div>
                  )}
                  <Field label="Exam" value={selectedAppointment.examNameEn || "—"} />
                  <Field label="Priority" value={selectedAppointment.priorityNameEn || "Routine"} />
                  <Field label="Status" value={selectedAppointment.status || "—"} />
                  <Field label="Walk-In" value={selectedAppointment.isWalkIn ? "Yes" : "No"} />
                  <Field label="Sequence" value={String(selectedAppointment.dailySequence ?? "—")} />
                  <Field label="Slot" value={selectedAppointment.modalitySlotNumber ? String(selectedAppointment.modalitySlotNumber) : "—"} />
                  <Field label="Created" value={selectedAppointment.createdAt ? formatDateLy(selectedAppointment.createdAt) : "—"} />
                  <div className="col-span-2">
                    <Field label="Notes" value={selectedAppointment.notes || "—"} />
                  </div>
                </div>
              </div>

              {/* Edit toggle */}
              <div className="mt-6">
                <RequestDocumentsPanel
                  appointmentId={selectedAppointment.id}
                  patientId={selectedAppointment.patientId}
                  appointmentRefType="v2_booking"
                  title="Request Documents"
                />
              </div>

              <div className="mt-6 flex gap-3">
                {!isEditing ? (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 transition-colors"
                  >
                    Edit appointment
                  </button>
                ) : (
                  <div className="w-full">
                    <AppointmentEditor
                      appointment={selectedAppointment}
                      lookups={lookups}
                      defaultOpen
                      onUpdated={(updated) => {
                        setSelectedAppointment(updated);
                        setIsEditing(false);
                      }}
                      onDeleted={() => {
                        setSelectedAppointment(null);
                        setIsEditing(false);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 p-8">
              <p className="text-stone-500 dark:text-stone-400">{t(language, "print.selectPrompt")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Input({
  label,
  type,
  value,
  onChange,
  placeholder
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-stone-700 dark:text-stone-300 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
      />
    </div>
  );
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
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 rounded-lg border bg-stone-50 dark:bg-stone-700 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500 outline-none"
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

function Field({
  label,
  value,
  rtl = false
}: {
  label: string;
  value: any;
  rtl?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-700/40 p-3 ${label === "Notes" ? "col-span-2" : ""} ${rtl ? "rtl" : ""}`}>
      <p className="text-stone-500 dark:text-stone-400 text-[11px] uppercase tracking-[0.14em] mb-1">{label}</p>
      <p className="text-stone-900 dark:text-white font-semibold text-base leading-snug break-words">{value ?? "—"}</p>
    </div>
  );
}

function slipField(label: string, value: any, rtl = false) {
  return `
    <div class="field ${rtl ? "rtl" : ""}">
      <span class="label">${escapeHtml(label)}</span>
      <span class="value">${escapeHtml(value ?? "—")}</span>
    </div>
  `;
}

function escapeHtml(value: any): string {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
