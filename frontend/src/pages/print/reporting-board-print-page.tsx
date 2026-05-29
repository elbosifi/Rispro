import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchReportingBoardCases, fetchReportingBoardSavedViewByToken } from "@/lib/api-hooks";
import { useAuth } from "@/providers/auth-provider";
import type { ReportingBoardCaseRow, ReportingBoardFilters } from "@/types/api";

function filtersFromParams(params: URLSearchParams): ReportingBoardFilters {
  const filters: ReportingBoardFilters = {};
  ["dateFrom", "dateTo", "cutoffDate", "modalityCode", "assignmentStatus", "caseCategory", "reportStatus", "priorityCode"].forEach((key) => {
    const value = params.get(key);
    if (value) (filters as Record<string, string>)[key] = value;
  });
  ["modalityId", "assignedDoctorId", "limit", "offset"].forEach((key) => {
    const value = params.get(key);
    if (value) (filters as Record<string, number>)[key] = Number(value);
  });
  const requiresReport = params.get("requiresReport");
  if (requiresReport) filters.requiresReport = requiresReport === "true";
  return filters;
}

function patientName(row: ReportingBoardCaseRow): string {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
}

export default function ReportingBoardPrintPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [printed, setPrinted] = useState(false);
  const savedViewToken = searchParams.get("savedViewToken");
  const autoprint = searchParams.get("autoprint") === "1";
  const selectedIds = useMemo(() => new Set((searchParams.get("appointmentIds") || "").split(",").map(Number).filter(Boolean)), [searchParams]);

  const savedViewQuery = useQuery({
    queryKey: ["print", "reporting-board", "saved-view", savedViewToken],
    queryFn: () => fetchReportingBoardSavedViewByToken(savedViewToken || ""),
    enabled: Boolean(savedViewToken),
  });
  const filters = useMemo(() => ({
    ...filtersFromParams(searchParams),
    ...(savedViewQuery.data?.filters ?? {}),
    limit: Number(searchParams.get("limit") || savedViewQuery.data?.filters.limit || 100),
  }), [savedViewQuery.data?.filters, searchParams]);
  const casesQuery = useQuery({
    queryKey: ["print", "reporting-board", "cases", filters],
    queryFn: () => fetchReportingBoardCases(filters),
    enabled: !savedViewToken || Boolean(savedViewQuery.data),
  });

  const cases = useMemo(() => {
    const rows = casesQuery.data?.cases ?? [];
    return selectedIds.size > 0 ? rows.filter((row) => selectedIds.has(row.appointmentId)) : rows;
  }, [casesQuery.data?.cases, selectedIds]);

  useEffect(() => {
    if (!autoprint || printed || casesQuery.isLoading || casesQuery.error) return;
    const timeout = window.setTimeout(() => {
      try {
        if (!navigator.userAgent.includes("jsdom")) window.focus();
      } catch {
        // Test environments may not implement focus.
      }
      window.print();
      setPrinted(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [autoprint, casesQuery.error, casesQuery.isLoading, printed]);

  const filterSummary = [
    savedViewQuery.data?.name ? `Saved view: ${savedViewQuery.data.name}` : "Current Reporting Board filters",
    `Cutoff: ${casesQuery.data?.filters.cutoffDate ?? casesQuery.data?.filters.dateFrom ?? "-"}`,
    filters.modalityCode ? `Modality: ${filters.modalityCode}` : filters.modalityId ? `Modality ID: ${filters.modalityId}` : "Configured modalities",
    filters.assignedDoctorId ? `Doctor ID: ${filters.assignedDoctorId}` : filters.assignmentStatus ? `Assignment: ${filters.assignmentStatus}` : "All assignments",
    filters.reportStatus ? `Report: ${String(filters.reportStatus).replaceAll("_", " ")}` : "",
  ].filter(Boolean);

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
        .signature { min-width: 120px; height: 28px; }
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
        <button type="button" onClick={() => window.print()} disabled={casesQuery.isLoading || Boolean(casesQuery.error)}>
          Print
        </button>
      </div>
      <section className="print-sheet" data-testid="reporting-board-print-page">
        <header className="print-header">
          <div>
            <p className="brand">RISpro</p>
            <h1 className="title">RISpro Reporting Assignment List</h1>
            <p>{savedViewQuery.data?.name ?? "Reporting Board handoff"}</p>
          </div>
          <div className="meta">
            <div>Generated: {new Date().toLocaleString()}</div>
            <div>Generated by: {user?.fullName ?? user?.username ?? "-"}</div>
            <div>Total cases: {cases.length}</div>
            <div>Cutoff date: {casesQuery.data?.filters.cutoffDate ?? casesQuery.data?.filters.dateFrom ?? "-"}</div>
          </div>
        </header>
        <div className="filters">
          {filterSummary.map((item) => <span key={item}>{item}</span>)}
        </div>
        {casesQuery.isLoading ? (
          <p>Loading reporting board print data...</p>
        ) : casesQuery.error ? (
          <p>Could not load reporting board print data.</p>
        ) : cases.length === 0 ? (
          <p>No reporting board cases match these filters.</p>
        ) : (
          <table>
            <thead>
              <tr>
                {["Priority", "Patient", "MRN", "Accession", "Appointment", "Modality", "Exam", "Category", "Assigned doctor", "Report status", "Notes / signature"].map((header) => <th key={header}>{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {cases.map((row) => (
                <tr key={row.appointmentId}>
                  <td>{row.reportingPriorityName ?? row.reportingPriorityCode ?? "-"}</td>
                  <td>{patientName(row)}</td>
                  <td>{row.patientMrn ?? "-"}</td>
                  <td>{row.accessionNumber}</td>
                  <td>{row.bookingDate} {row.bookingTime ?? ""}</td>
                  <td>{row.modalityCode}</td>
                  <td>{row.examTypeName ?? "-"}</td>
                  <td>{row.caseCategory}</td>
                  <td>{row.assignedDoctorName ?? "Unassigned"}</td>
                  <td>{row.reportStatus.replaceAll("_", " ")}</td>
                  <td className="signature" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <footer className="footer">
          <span>Generated by RISpro</span>
          <span>Page numbers are provided by the browser print dialog.</span>
        </footer>
      </section>
    </div>
  );
}
