import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { RequestDocumentsPanel } from "@/components/documents/request-documents-panel";
import { fetchReportingBoardMobileCase } from "@/lib/api/doctor-portal-reporting";
import { useAuth } from "@/providers/auth-provider";

export function ReportingWorklistDocumentsPage() {
  const { token = "", caseId = "" } = useParams<{ token: string; caseId: string }>();
  const { user } = useAuth();
  const appointmentId = Number(caseId);
  const validCaseId = Number.isSafeInteger(appointmentId) && appointmentId > 0;
  const caseQuery = useQuery({
    queryKey: ["reporting-worklist-documents", token, appointmentId, user?.id],
    queryFn: () => fetchReportingBoardMobileCase(token, appointmentId),
    enabled: Boolean(user) && Boolean(token) && validCaseId,
    retry: false,
  });

  const scopedAppointmentCase = user && caseQuery.data?.allowedActions.authenticated && !caseQuery.data.allowedActions.readOnly && caseQuery.data.case.caseType === "appointment"
    ? caseQuery.data.case
    : null;

  return (
    <main className="min-h-screen bg-slate-50 p-3 text-slate-900 sm:p-6">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Request &amp; clinical documents</h1>
            <p className="mt-1 text-sm text-slate-600">Read-only documents for this Personal Reporting Desk case.</p>
          </div>
          <Link
            to={`/reporting/worklist/${encodeURIComponent(token)}`}
            className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            Back to Personal Reporting Desk
          </Link>
        </header>

        {!user ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Sign in to view case documents.</p>
        ) : !validCaseId ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">This case is not available.</p>
        ) : caseQuery.isPending ? (
          <p role="status" className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">Checking case access…</p>
        ) : caseQuery.isError || !caseQuery.data ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">Could not load this case from the Personal Reporting Desk.</p>
        ) : !scopedAppointmentCase ? (
          <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Access denied. This case is not available for document review.</p>
        ) : (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Case details">
              <h2 className="text-base font-semibold">{scopedAppointmentCase.patientName}</h2>
              <dl className="mt-3 grid grid-cols-1 gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div><dt className="font-semibold text-slate-600">MRN</dt><dd className="break-all">{scopedAppointmentCase.mrn ?? "—"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Primary ID</dt><dd className="break-all">{scopedAppointmentCase.patientDicomId ?? "—"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Accession</dt><dd className="break-all">{scopedAppointmentCase.accessionNumber || "—"}</dd></div>
                <div><dt className="font-semibold text-slate-600">Modality</dt><dd>{scopedAppointmentCase.modality}</dd></div>
                <div><dt className="font-semibold text-slate-600">Exam</dt><dd>{scopedAppointmentCase.exam ?? "—"}</dd></div>
              </dl>
            </section>
            <section className="h-[calc(100vh-15rem)] min-h-[28rem]" aria-label="Request and clinical documents">
              <RequestDocumentsPanel
                appointmentId={scopedAppointmentCase.appointmentId}
                patientId={null}
                appointmentRefType="v2_booking"
                previewMode="inline"
                layout="workspace"
                readOnly
                enableLocalScan={false}
                enableAnnotations={false}
                reportingBoardScope={{ token, caseId: scopedAppointmentCase.appointmentId }}
                title="Request & clinical documents"
                pdfInitialSizingMode="fit-width"
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}
