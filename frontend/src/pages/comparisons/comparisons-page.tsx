import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, ExternalLink, ImageUp, Search, XCircle } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shared";
import {
  cancelComparisonRequest,
  confirmComparisonMaterials,
  fetchComparisonRequest,
  fetchComparisonRequests,
} from "@/lib/api-hooks";
import { formatDateTimeLy } from "@/lib/date-format";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import type { ComparisonRequest } from "@/types/api";
import { ComparisonDocumentsPanel } from "./comparison-documents-panel";

const CONFIRM_ROLES = new Set(["modality_staff", "doctor", "supervisor", "super_admin"]);
const CANCEL_ROLES = new Set(["supervisor", "super_admin"]);

const STATUS_OPTIONS = [
  ["active", "Active"],
  ["pending", "Pending"],
  ["ready", "Ready"],
  ["assigned", "Assigned"],
  ["finalized", "Finalized"],
  ["cancelled", "Cancelled"],
  ["all", "All"],
] as const;

function patientName(row: ComparisonRequest) {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
}

function statusVariant(status: ComparisonRequest["status"]) {
  if (status === "finalized" || status === "ready_for_reporting") return "success";
  if (status === "cancelled") return "error";
  if (status === "pending_upload_confirmation") return "warning";
  return "neutral";
}

function imageReadiness(row: ComparisonRequest): { label: string; tone: string } {
  if (row.remapJobStatus === "sent") return { label: "Sent / PACS ready", tone: "text-emerald-700" };
  if (row.remapJobStatus === "failed") return { label: "Failed", tone: "text-red-700" };
  if (row.remapJobStatus === "sending") return { label: "Sending to PACS", tone: "text-blue-700" };
  if (row.remapJobStatus === "remapped") return { label: "Preparing PACS send", tone: "text-blue-700" };
  if (row.remapJobStatus === "processing") return { label: "Processing", tone: "text-blue-700" };
  if (row.remapJobStatus === "uploaded") return { label: row.remapProcessingStage === "staging" ? "Uploading / staging" : "Queued", tone: "text-blue-700" };
  if (row.remapJobStatus === "awaiting_confirmation") return { label: "Staged; confirmation required", tone: "text-amber-700" };
  if (row.imageAvailabilityConfirmed) return { label: "Manually confirmed available", tone: "text-emerald-700" };
  return { label: "Not verified", tone: "text-amber-700" };
}

function ConfirmationPanel({ row }: { row: ComparisonRequest }) {
  const queryClient = useQueryClient();
  const [imageAvailabilityConfirmed, setImageAvailabilityConfirmed] = useState(false);
  const [documentsAvailabilityConfirmed, setDocumentsAvailabilityConfirmed] = useState(false);
  const [selectedPriorConfirmed, setSelectedPriorConfirmed] = useState(false);
  const [materialsConfirmationNote, setMaterialsConfirmationNote] = useState("");
  const mutation = useMutation({
    mutationFn: () => confirmComparisonMaterials(row.id, {
      imageAvailabilityConfirmed,
      documentsAvailabilityConfirmed,
      selectedPriorConfirmed,
      materialsConfirmationNote: materialsConfirmationNote.trim() || null,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["comparison-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["comparison-request", row.id] });
      void queryClient.invalidateQueries({ queryKey: ["reporting-board-cases"] });
      pushToast({ type: "success", title: "Comparison released", message: "Request is ready for reporting." });
    },
    onError: (error) => pushToast({
      type: "error",
      title: "Confirmation failed",
      message: error instanceof Error ? error.message : "Unable to confirm comparison materials.",
    }),
  });
  const canSubmit = imageAvailabilityConfirmed && documentsAvailabilityConfirmed && selectedPriorConfirmed && !mutation.isPending;
  if (row.status !== "pending_upload_confirmation") return null;

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3" aria-label="Final material confirmation">
      <h4 className="text-sm font-semibold">Final confirmation</h4>
      <p className="mb-2 text-xs text-muted-foreground">Material evidence is shown above; release remains an explicit human decision.</p>
      <div className="grid gap-2 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" checked={imageAvailabilityConfirmed} onChange={(event) => setImageAvailabilityConfirmed(event.target.checked)} /><span>I confirm that comparison images are available in PACS.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={documentsAvailabilityConfirmed} onChange={(event) => setDocumentsAvailabilityConfirmed(event.target.checked)} /><span>I confirm that required comparison documents/papers are available.</span></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={selectedPriorConfirmed} onChange={(event) => setSelectedPriorConfirmed(event.target.checked)} /><span>I confirm that the selected previous RISpro study is correct.</span></label>
        <textarea value={materialsConfirmationNote} onChange={(event) => setMaterialsConfirmationNote(event.target.value)} className="min-h-20 rounded-lg border border-border bg-background px-3 py-2" placeholder="Optional confirmation note" />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}><CheckCircle2 size={16} />Confirm and send to reporting pool</Button>
      </div>
    </section>
  );
}

function CancelComparisonDialog({ row, open, onClose }: { row: ComparisonRequest; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const mutation = useMutation({
    mutationFn: () => cancelComparisonRequest(row.id, { reason: reason.trim() }),
    onSuccess: () => {
      setReason("");
      onClose();
      void queryClient.invalidateQueries({ queryKey: ["comparison-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["comparison-request", row.id] });
      void queryClient.invalidateQueries({ queryKey: ["reporting-board-cases"] });
      pushToast({ type: "success", title: "Comparison request cancelled", message: "The cancellation was recorded for audit." });
    },
    onError: (error) => pushToast({ type: "error", title: "Cancellation failed", message: error instanceof Error ? error.message : "Unable to cancel the comparison request." }),
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent maxWidth="560px">
        <DialogHeader>
          <DialogTitle>Cancel comparison request</DialogTitle>
          <DialogDescription>This retains the request and its history. It does not delete clinical data.</DialogDescription>
        </DialogHeader>
        <dl className="grid gap-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <div><dt className="font-semibold">Patient</dt><dd>{patientName(row)}{row.patientMrn ? ` · ${row.patientMrn}` : ""}</dd></div>
          <div><dt className="font-semibold">Previous study</dt><dd>{[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ")}</dd></div>
          <div><dt className="font-semibold">Request reason</dt><dd>{row.reason}</dd></div>
          <div><dt className="font-semibold">Current status</dt><dd>{row.status.replaceAll("_", " ")}</dd></div>
        </dl>
        <label className="grid gap-1 text-sm font-semibold">Cancellation reason<textarea aria-label="Cancellation reason" value={reason} onChange={(event) => setReason(event.target.value)} className="min-h-24 rounded-lg border border-border bg-background px-3 py-2 font-normal" /></label>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>Keep request</Button>
          <Button type="button" variant="destructive" disabled={!reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>Cancel request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ComparisonRow({ row, canConfirm, canCancel }: { row: ComparisonRequest; canConfirm: boolean; canCancel: boolean }) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const image = imageReadiness(row);
  const canPrepare = row.status === "pending_upload_confirmation";
  const canCancelRequest = row.status !== "cancelled" && row.status !== "finalized";
  const remapParams = new URLSearchParams({
    comparisonRequestId: String(row.id),
    patientId: String(row.patientId),
    returnPath: `/comparisons/${row.id}`,
  });

  return (
    <article className="space-y-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{patientName(row)}</h3>
            <Badge variant={statusVariant(row.status)} size="sm">{row.status.replaceAll("_", " ")}</Badge>
            <Badge variant="neutral" size="sm">{row.linkedModalityCode || "Modality"}</Badge>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">Previous study: {[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ") || `Booking #${row.linkedPreviousBookingId}`}</div>
          <p className="mt-2 text-sm"><span className="font-semibold">Reason:</span> {row.reason}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Created {formatDateTimeLy(row.createdAt)}</div>
          <div>By {row.createdByName || (row.createdBy ? `#${row.createdBy}` : "-")}</div>
          <Link to={`/comparisons/${row.id}`} className="mt-2 inline-flex items-center gap-1 font-semibold text-accent"><ExternalLink size={13} />Open details</Link>
        </div>
      </div>

      <section className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-3" aria-label="Material readiness">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Images</h4>
          <p className={`text-xs font-semibold ${image.tone}`}>{image.label}</p>
          {row.remapJobId ? <p className="text-xs text-muted-foreground">Remap job #{row.remapJobId}{row.remapProcessingStage ? ` · ${row.remapProcessingStage.replaceAll("_", " ")}` : ""}</p> : null}
          {row.remapJobStatus === "failed" && row.remapErrorMessage ? <p className="text-xs text-red-700">{row.remapErrorMessage}</p> : null}
          {canPrepare ? <Link to={`/comparisons/${row.id}/remap?${remapParams.toString()}`} className="inline-flex items-center gap-1 text-xs font-semibold text-accent"><ImageUp size={14} />Upload / remap comparison study</Link> : null}
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Documents / papers</h4>
          <p className={`text-xs font-semibold ${row.documentCount > 0 ? "text-emerald-700" : "text-amber-700"}`}>{row.documentCount > 0 ? `${row.documentCount} attached` : "None attached"}</p>
          <p className="text-xs text-muted-foreground">Canonical RISpro document storage</p>
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Previous study</h4>
          <p className="text-xs">{[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ")}</p>
          <p className={`text-xs font-semibold ${row.selectedPriorConfirmed ? "text-emerald-700" : "text-amber-700"}`}>{row.selectedPriorConfirmed ? "Selected study confirmed" : "Not yet confirmed"}</p>
        </div>
      </section>

      <ComparisonDocumentsPanel comparisonRequestId={row.id} canAttach={canConfirm && canPrepare} canDelete={canCancel && canPrepare} />

      {row.materialsConfirmed ? (
        <div className="flex flex-wrap gap-2 text-xs text-emerald-700"><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />Images confirmed</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />Documents confirmed</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />Prior confirmed</span>{row.materialsConfirmedAt ? <span>by {row.materialsConfirmedByName || "staff"} · {formatDateTimeLy(row.materialsConfirmedAt)}</span> : null}</div>
      ) : (
        <div className="inline-flex items-center gap-1 text-xs text-amber-700"><XCircle size={13} />Waiting for final material confirmation</div>
      )}
      {row.assignedDoctorName ? <p className="text-xs text-muted-foreground">Assigned doctor: {row.assignedDoctorName}</p> : null}
      {row.finalizedAt ? <p className="text-xs text-emerald-700">Finalized {formatDateTimeLy(row.finalizedAt)} by {row.finalizedByName || "staff"}</p> : null}
      {row.status === "cancelled" ? <p className="rounded-md bg-red-50 p-2 text-xs text-red-800"><strong>Cancelled:</strong> {row.cancellationReason || "No reason recorded"}{row.cancelledAt ? ` · ${formatDateTimeLy(row.cancelledAt)}` : ""}</p> : null}
      {canConfirm ? <ConfirmationPanel row={row} /> : null}
      {canCancel && canCancelRequest ? <div className="flex justify-end"><Button type="button" variant="ghost" className="text-red-700" onClick={() => setCancelOpen(true)}>Cancel request</Button></div> : null}
      <CancelComparisonDialog row={row} open={cancelOpen} onClose={() => setCancelOpen(false)} />
    </article>
  );
}

export default function ComparisonsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [status, setStatus] = useState("active");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const canConfirm = Boolean(user && CONFIRM_ROLES.has(user.role));
  const canCancel = Boolean(user && CANCEL_ROLES.has(user.role));
  const selectedId = id ? Number(id) : null;
  const listQuery = useQuery({ queryKey: ["comparison-requests", status, search], queryFn: () => fetchComparisonRequests({ status, q: search || null }), enabled: !selectedId });
  const detailQuery = useQuery({ queryKey: ["comparison-request", selectedId], queryFn: () => fetchComparisonRequest(selectedId!), enabled: Boolean(selectedId), refetchInterval: (query) => {
    const remapStatus = (query.state.data as ComparisonRequest | undefined)?.remapJobStatus;
    return remapStatus && ["uploaded", "processing", "remapped", "sending", "awaiting_confirmation"].includes(remapStatus) ? 2_000 : false;
  } });
  const rows = selectedId ? (detailQuery.data ? [detailQuery.data] : []) : listQuery.data ?? [];
  const isLoading = selectedId ? detailQuery.isLoading : listQuery.isLoading;
  const error = selectedId ? detailQuery.error : listQuery.error;

  return (
    <main className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Comparison Preparation</h1><p className="text-sm text-muted-foreground">Prepare papers, PACS images, and prior-study evidence before reporting.</p></div>
        {selectedId ? <Link to="/comparisons" className="text-sm font-semibold text-accent">All comparison requests</Link> : null}
      </div>
      {!selectedId ? (
        <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-background p-3">
          <label className="grid gap-1 text-xs font-semibold">Status<select aria-label="Comparison status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal">{STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <form className="flex flex-1 items-end gap-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
            <label className="grid min-w-60 flex-1 gap-1 text-xs font-semibold">Search<input aria-label="Search comparison requests" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} className="h-10 rounded-md border border-border bg-background px-3 text-sm font-normal" placeholder="Patient, MRN, accession, exam, or reason" /></label>
            <Button type="submit" variant="secondary"><Search size={15} />Search</Button>
          </form>
        </div>
      ) : null}
      {isLoading ? <p className="text-sm text-muted-foreground">Loading comparison requests...</p> : error ? <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Unable to load comparison requests."}</p> : rows.length === 0 ? <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No comparison requests found.</p> : <div className="grid gap-3">{rows.map((row) => <ComparisonRow key={row.id} row={row} canConfirm={canConfirm} canCancel={canCancel} />)}</div>}
    </main>
  );
}
