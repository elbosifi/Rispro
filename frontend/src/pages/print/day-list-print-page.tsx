import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

const DEFAULT_COLUMNS = ["sequence", "patient", "accession", "time", "modality", "exam", "category", "priority", "status"];

export default function DayListPrintPage() {
  const { language } = useLanguage();
  const [searchParams] = useSearchParams();
  const [printed, setPrinted] = useState(false);
  const date = searchParams.get("date") || "";
  const autoprint = searchParams.get("autoprint") === "1";
  const columns = (searchParams.get("columns") || DEFAULT_COLUMNS.join(",")).split(",").filter(Boolean);

  const queryParams = useMemo(() => {
    const params: Record<string, string> = { date, sort: searchParams.get("sort") || "time-asc" };
    ["modalityId", "status", "caseCategory", "q"].forEach((key) => {
      const value = searchParams.get(key);
      if (value) params[key] = value;
    });
    return params;
  }, [date, searchParams]);

  const { data: appointments = [], isLoading, error } = useQuery({
    queryKey: ["day-list-print", queryParams],
    queryFn: () => fetchAppointments(queryParams),
    enabled: Boolean(date),
    staleTime: 0,
  });

  const filterSummary = [
    `Date: ${date || "-"}`,
    searchParams.get("modalityId") ? `Modality ID: ${searchParams.get("modalityId")}` : "All modalities",
    searchParams.get("status") ? `Status: ${searchParams.get("status")}` : "Active statuses",
    searchParams.get("caseCategory") ? `Category: ${searchParams.get("caseCategory")}` : "All categories",
    searchParams.get("q") ? `Search: ${searchParams.get("q")}` : "",
  ].filter(Boolean);

  useEffect(() => {
    if (!autoprint || printed || isLoading || error || !date) return;
    const timeout = window.setTimeout(() => {
      try {
        if (navigator.userAgent.includes("jsdom")) {
          window.print();
          setPrinted(true);
          return;
        }
        window.focus();
      } catch {
        // Some test/preview environments do not implement focus.
      }
      window.print();
      setPrinted(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [autoprint, date, error, isLoading, printed]);

  return (
    <div className="print-route-page">
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        * { box-sizing: border-box; }
        body { background: #fff; color: #111827; }
        .print-route-page { min-height: 100vh; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; padding: 20px; }
        .screen-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
        .screen-actions button { border: 1px solid #d1d5db; border-radius: 8px; background: #fff; padding: 8px 12px; font-weight: 700; }
        .print-sheet { border: 1px solid #0f766e; border-radius: 10px; padding: 14px; }
        .print-header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; margin-bottom: 10px; }
        .brand { font-size: 18px; font-weight: 800; color: #0f766e; margin: 0; }
        .title { font-size: 22px; font-weight: 800; margin: 6px 0 0; }
        .meta { text-align: right; font-size: 11px; color: #4b5563; line-height: 1.45; }
        .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; font-size: 11px; }
        .filters span { border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
        th { background: #e6f4f1; color: #064e3b; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        .arabic { direction: rtl; text-align: right; }
        .footer { display: flex; justify-content: space-between; border-top: 1px dashed #d1d5db; margin-top: 10px; padding-top: 8px; font-size: 10px; color: #6b7280; }
        @media print {
          .screen-actions { display: none !important; }
          .print-route-page { padding: 0; }
          .print-sheet { border: 0; border-radius: 0; padding: 0; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      <div className="screen-actions">
        <button type="button" onClick={() => window.print()} disabled={isLoading || Boolean(error)}>
          Print
        </button>
      </div>
      <section className="print-sheet" data-testid="day-list-print-page">
        <header className="print-header">
          <div>
            <p className="brand">RISpro</p>
            <h1 className="title">Daily Appointment List</h1>
            <p>{date ? formatDateLy(date) : "No date selected"}</p>
          </div>
          <div className="meta">
            <div>Printed at: {new Date().toLocaleString()}</div>
            <div>Total rows: {appointments.length}</div>
            <div>Paper: A4 landscape</div>
          </div>
        </header>
        <div className="filters">
          {filterSummary.map((item) => <span key={item}>{item}</span>)}
        </div>
        {isLoading ? (
          <p>Loading print data...</p>
        ) : error ? (
          <p>Could not load print data.</p>
        ) : appointments.length === 0 ? (
          <p>No appointments match these filters.</p>
        ) : (
          <AppointmentPrintTable appointments={appointments} columns={columns} language={language} />
        )}
        <footer className="footer">
          <span>Generated by RISpro</span>
          <span className="page-number">Page numbers are provided by the browser print dialog.</span>
        </footer>
      </section>
    </div>
  );
}

function AppointmentPrintTable({ appointments, columns, language }: { appointments: AppointmentWithDetails[]; columns: string[]; language: "ar" | "en" }) {
  const visible = new Set(columns);
  const headers: Record<string, string> = {
    sequence: "#",
    patient: "Patient",
    accession: "Accession",
    time: "Time",
    modality: "Modality",
    exam: "Exam",
    category: "Category",
    priority: "Priority",
    status: "Status",
  };
  return (
    <table>
      <thead>
        <tr>
          {columns.map((column) => <th key={column}>{headers[column] || column}</th>)}
        </tr>
      </thead>
      <tbody>
        {appointments.map((appointment, index) => (
          <tr key={appointment.id}>
            {visible.has("sequence") ? <td>{appointment.dailySequence || index + 1}</td> : null}
            {visible.has("patient") ? <td className="arabic">{chooseLocalized(language, appointment.arabicFullName, appointment.englishFullName)}</td> : null}
            {visible.has("accession") ? <td>{appointment.accessionNumber}</td> : null}
            {visible.has("time") ? <td>{appointment.bookingTime || "-"}</td> : null}
            {visible.has("modality") ? <td>{chooseLocalized(language, appointment.modalityNameAr, appointment.modalityNameEn) || "-"}</td> : null}
            {visible.has("exam") ? <td>{chooseLocalized(language, appointment.examNameAr, appointment.examNameEn) || "-"}</td> : null}
            {visible.has("category") ? <td>{appointment.caseCategory || "-"}</td> : null}
            {visible.has("priority") ? <td>{chooseLocalized(language, appointment.priorityNameAr, appointment.priorityNameEn) || "-"}</td> : null}
            {visible.has("status") ? <td>{statusLabel(language, appointment.status)}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
