import { Button } from "@/components/shared";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAppointments, recordReportOutput } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import { formatDateLy } from "@/lib/date-format";
import { chooseLocalized, statusLabel, t } from "@/lib/i18n";
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

  const caseCategory = searchParams.get("caseCategory");
  const filterSummary = [
    `${t(language, "print.dayList.filter.date")}: ${date ? formatDateLy(date) : "-"}`,
    searchParams.get("modalityId") ? `${t(language, "print.dayList.filter.modalityId")}: ${searchParams.get("modalityId")}` : t(language, "print.dayList.filter.allModalities"),
    searchParams.get("status") ? `${t(language, "print.dayList.filter.status")}: ${statusLabel(language, searchParams.get("status")!)}` : t(language, "print.dayList.filter.activeStatuses"),
    caseCategory ? `${t(language, "print.dayList.filter.category")}: ${caseCategory === "oncology" ? t(language, "appointments.create.oncology") : caseCategory === "non_oncology" ? t(language, "appointments.create.nonOncology") : caseCategory}` : t(language, "print.dayList.filter.allCategories"),
    searchParams.get("q") ? `${t(language, "print.dayList.filter.search")}: ${searchParams.get("q")}` : "",
  ].filter(Boolean);

  useEffect(() => {
    if (!autoprint || printed || isLoading || error || !date) return;
    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          await recordReportOutput({
            reportTemplate: "daily-appointments",
            outputType: "print",
            filters: queryParams,
            rowCount: appointments.length,
            includePhoneNumbers: false,
            includePatientIdentifiers: true,
          });
          try {
            if (!navigator.userAgent.includes("jsdom")) {
              window.focus();
            }
          } catch {
            // Some test/preview environments do not implement focus.
          }
          window.print();
          setPrinted(true);
        } catch {
          setPrinted(true);
        }
      })();
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [appointments.length, autoprint, date, error, isLoading, printed, queryParams]);

  return (
    <div className="print-route-page" dir={language === "ar" ? "rtl" : "ltr"}>
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        * { box-sizing: border-box; }
        body { background: #fff; color: #111827; }
        .print-route-page { min-height: 100vh; background: #fff; color: #111827; font-family: Arial, Helvetica, sans-serif; padding: 20px; }
        .screen-actions { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
        .screen-actions button { border: 1px solid #d1d5db; border-radius: 8px; background: #fff; padding: 8px 12px; font-weight: 700; }
        .print-sheet { border: 1px solid #2563eb; border-radius: 10px; padding: 14px; }
        .print-header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #d1d5db; padding-bottom: 10px; margin-bottom: 10px; }
        .brand { font-size: 18px; font-weight: 800; color: #2563eb; margin: 0; }
        .title { font-size: 22px; font-weight: 800; margin: 6px 0 0; }
        .meta { text-align: end; font-size: 11px; color: #4b5563; line-height: 1.45; }
        .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; font-size: 11px; }
        .filters span { border: 1px solid #d1d5db; border-radius: 999px; padding: 4px 8px; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        th, td { border: 1px solid #d1d5db; padding: 6px; text-align: start; vertical-align: top; }
        th { background: #eff6ff; color: #1e3a8a; font-size: 9px; text-transform: uppercase; letter-spacing: normal; }
        tbody tr:nth-child(even) { background: #f8fafc; }
        .arabic { direction: rtl; text-align: right; }
        .footer { display: flex; justify-content: space-between; border-top: 1px dashed #d1d5db; margin-top: 10px; padding-top: 8px; font-size: 10px; color: #6b7280; }
        @media screen {
          .print-table-scroll { overflow-x: auto; }
          .print-table-scroll table { min-width: 900px; }
        }
        @media screen and (max-width: 640px) {
          .print-header { flex-direction: column; gap: 8px; }
          .meta { text-align: start; }
        }
        @media print {
          .screen-actions { display: none !important; }
          .print-route-page { padding: 0; }
          .print-sheet { border: 0; border-radius: 0; padding: 0; }
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      <div className="screen-actions">
        <Button size="sm" variant="secondary" type="button" onClick={() => window.print()} disabled={isLoading || Boolean(error)}>
          {t(language, "print.dayList.print")}
        </Button>
      </div>
      <section className="print-sheet" data-testid="day-list-print-page">
        <header className="print-header">
          <div>
            <p className="brand">RISpro</p>
            <h1 className="title">{t(language, "print.dayList.title")}</h1>
            <p>{date ? formatDateLy(date) : t(language, "print.dayList.noDate")}</p>
          </div>
          <div className="meta">
            <div>{t(language, "print.dayList.printedAt")}: {new Date().toLocaleString(language === "ar" ? "ar-LY" : "en-GB")}</div>
            <div>{t(language, "print.dayList.totalRows")}: {appointments.length}</div>
            <div>{t(language, "print.dayList.paper")}: {t(language, "print.dayList.paperFormat")}</div>
          </div>
        </header>
        <div className="filters">
          {filterSummary.map((item) => <span key={item}>{item}</span>)}
        </div>
        {isLoading ? (
          <p>{t(language, "print.dayList.loading")}</p>
        ) : error ? (
          <p>{t(language, "print.dayList.loadError")}</p>
        ) : appointments.length === 0 ? (
          <p>{t(language, "print.dayList.empty")}</p>
        ) : (
          <div className="print-table-scroll"><AppointmentPrintTable appointments={appointments} columns={columns} language={language} /></div>
        )}
        <footer className="footer">
          <span>{t(language, "print.generatedBy")}</span>
          <span className="page-number">{t(language, "print.dayList.pageNumbersNote")}</span>
        </footer>
      </section>
    </div>
  );
}

function AppointmentPrintTable({ appointments, columns, language }: { appointments: AppointmentWithDetails[]; columns: string[]; language: "ar" | "en" }) {
  const visible = new Set(columns);
  const headers: Record<string, string> = {
    sequence: "#",
    patient: t(language, "print.patientLabel"),
    accession: t(language, "print.dayList.accessionColumn"),
    time: t(language, "print.dayList.column.time"),
    modality: t(language, "print.modalityLabel"),
    exam: t(language, "print.examLabel"),
    category: t(language, "appointments.create.caseCategory"),
    priority: t(language, "print.priorityLabel"),
    status: t(language, "print.statusLabel"),
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
