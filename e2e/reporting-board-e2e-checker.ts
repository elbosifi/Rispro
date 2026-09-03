import { pool } from "../src/db/pool.js";
import type { checkSonicDicomReportStatusesBatch } from "../src/services/sonicdicom-report-service.js";

type AssignmentBatchChecker = typeof checkSonicDicomReportStatusesBatch;
type CheckerResult = Awaited<ReturnType<AssignmentBatchChecker>> extends Map<number, infer Result> ? Result : never;

export const e2eReportingBoardAssignmentBatchChecker: AssignmentBatchChecker = async (contexts) => {
  const ids = [...new Set(contexts.map((context) => context.bookingId))];
  const cached = ids.length
    ? await pool.query<{ appointment_id: number; report_status: string; report_final_at: string | null }>(
      `select appointment_id, report_status, report_final_at
       from doctor_portal.reporting_board_sonicdicom_cache
       where appointment_id = any($1::bigint[])`,
      [ids],
    )
    : { rows: [] };
  const byAppointmentId = new Map(cached.rows.map((row) => [Number(row.appointment_id), row]));
  return new Map(contexts.map((context) => {
    const row = byAppointmentId.get(context.bookingId);
    const result: CheckerResult = row?.report_status === "draft"
      ? { state: "draft", canViewReport: false, source: "sonicdicom", reportFinalAt: null }
      : row?.report_status === "no_report"
        ? { state: "no_report", canViewReport: false, source: "sonicdicom", reportFinalAt: null }
        : row?.report_status === "final"
          ? { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: row.report_final_at }
          : { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null };
    return [context.bookingId, result];
  }));
};
