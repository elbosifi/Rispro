import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, ExternalLink, XCircle } from "lucide-react";
import { Button, Badge } from "@/components/shared";
import { confirmComparisonMaterials, fetchComparisonRequest, fetchComparisonRequests } from "@/lib/api-hooks";
import { formatDateTimeLy } from "@/lib/date-format";
import { pushToast } from "@/lib/toast";
import { useAuth } from "@/providers/auth-provider";
import type { ComparisonRequest } from "@/types/api";

const CONFIRM_ROLES = new Set(["modality_staff", "doctor", "supervisor", "super_admin"]);

function patientName(row: ComparisonRequest) {
  return row.patientEnglishName || row.patientArabicName || row.patientMrn || `Patient ${row.patientId}`;
}

function statusVariant(status: ComparisonRequest["status"]) {
  if (status === "finalized") return "success";
  if (status === "cancelled") return "error";
  if (status === "pending_upload_confirmation") return "warning";
  return "neutral";
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
    onError: (err) => {
      pushToast({ type: "error", title: "Confirmation failed", message: err instanceof Error ? err.message : "Unable to confirm comparison materials." });
    },
  });
  const canSubmit = imageAvailabilityConfirmed && documentsAvailabilityConfirmed && selectedPriorConfirmed && !mutation.isPending;

  if (row.status !== "pending_upload_confirmation") return null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="grid gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={imageAvailabilityConfirmed} onChange={(event) => setImageAvailabilityConfirmed(event.target.checked)} />
          <span>I confirm that previous images are uploaded or available in PACS.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={documentsAvailabilityConfirmed} onChange={(event) => setDocumentsAvailabilityConfirmed(event.target.checked)} />
          <span>I confirm that required comparison documents/papers are uploaded or available in PACS.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={selectedPriorConfirmed} onChange={(event) => setSelectedPriorConfirmed(event.target.checked)} />
          <span>I confirm that the selected previous RISpro study is correct.</span>
        </label>
        <textarea
          value={materialsConfirmationNote}
          onChange={(event) => setMaterialsConfirmationNote(event.target.value)}
          className="min-h-20 rounded-lg border border-border bg-background px-3 py-2"
          placeholder="Optional confirmation note"
        />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
          <CheckCircle2 size={16} />
          Confirm and send to reporting pool
        </Button>
      </div>
    </div>
  );
}

function ComparisonRow({ row, canConfirm }: { row: ComparisonRequest; canConfirm: boolean }) {
  return (
    <article className="rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{patientName(row)}</h3>
            <Badge variant={statusVariant(row.status)} size="sm">{row.status.replaceAll("_", " ")}</Badge>
            <Badge variant="neutral" size="sm">{row.linkedModalityCode || "Modality"}</Badge>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Previous study: {[row.linkedStudyDate, row.linkedExamName, row.linkedPreviousAccessionNumber].filter(Boolean).join(" | ") || `Booking #${row.linkedPreviousBookingId}`}
          </div>
          <p className="mt-2 text-sm">{row.reason}</p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Created {formatDateTimeLy(row.createdAt)}</div>
          <div>By {row.createdByName || (row.createdBy ? `#${row.createdBy}` : "-")}</div>
          <Link to={`/comparisons/${row.id}`} className="mt-2 inline-flex items-center gap-1 font-semibold text-accent">
            <ExternalLink size={13} />
            Internal link
          </Link>
        </div>
      </div>
      {row.materialsConfirmed ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-emerald-700">
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} /> Images confirmed</span>
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} /> Documents/papers confirmed</span>
          <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} /> Prior study confirmed</span>
        </div>
      ) : (
        <div className="mt-3 inline-flex items-center gap-1 text-xs text-amber-700">
          <XCircle size={13} />
          Waiting for PACS readiness confirmation
        </div>
      )}
      {canConfirm ? <ConfirmationPanel row={row} /> : null}
    </article>
  );
}

export default function ComparisonsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const canConfirm = Boolean(user && CONFIRM_ROLES.has(user.role));
  const selectedId = id ? Number(id) : null;
  const listQuery = useQuery({
    queryKey: ["comparison-requests"],
    queryFn: () => fetchComparisonRequests(),
    enabled: !selectedId,
  });
  const detailQuery = useQuery({
    queryKey: ["comparison-request", selectedId],
    queryFn: () => fetchComparisonRequest(selectedId!),
    enabled: Boolean(selectedId),
  });
  const rows = selectedId ? (detailQuery.data ? [detailQuery.data] : []) : listQuery.data ?? [];
  const isLoading = selectedId ? detailQuery.isLoading : listQuery.isLoading;
  const error = selectedId ? detailQuery.error : listQuery.error;

  return (
    <main className="space-y-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Comparisons</h1>
          <p className="text-sm text-muted-foreground">Confirmation-only worklist for PACS-ready comparison requests.</p>
        </div>
        {selectedId ? <Link to="/comparisons" className="text-sm font-semibold text-accent">All comparison requests</Link> : null}
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading comparison requests...</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Unable to load comparison requests."}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">No comparison requests found.</p>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => <ComparisonRow key={row.id} row={row} canConfirm={canConfirm} />)}
        </div>
      )}
    </main>
  );
}
