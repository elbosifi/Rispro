import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, GitMerge, Loader2, Search, ShieldCheck, Trash2, UserRoundCheck, XCircle } from "lucide-react";
import {
  dismissPatientDuplicate,
  fetchPatientDuplicateCandidates,
  fetchPatientDuplicateDetail,
  mergePatientDuplicate,
  safeDeleteDuplicatePatient,
} from "@/lib/api-hooks";
import { ApiError } from "@/lib/api-client";
import { pushToast } from "@/lib/toast";
import { Button, Badge } from "@/components/shared";
import type { PatientDuplicateBlockers, PatientDuplicateCandidate, PatientDuplicateSummary } from "@/types/api";

interface PatientDuplicateResolverSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

type SelectedAction =
  | { type: "merge"; targetId: number; sourceId: number }
  | { type: "delete"; patientId: number }
  | null;

const REAUTH_QUERY_KEY = ["settings", "patient-duplicates"];

function isReAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.message.includes("re-authentication");
}

function displayPatientName(patient: PatientDuplicateSummary): string {
  return patient.arabicFullName || patient.englishFullName || `Patient ${patient.id}`;
}

function formatReason(reason: string): string {
  return reason.replace(/_/g, " ");
}

function PatientMiniCard({ patient }: { patient: PatientDuplicateSummary }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{displayPatientName(patient)}</p>
          <p className="truncate text-xs text-muted-foreground">{patient.englishFullName || "No English name"}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">#{patient.id}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="truncate text-muted-foreground">MRN: <b className="font-mono text-foreground">{patient.mrn || "-"}</b></span>
        <span className="truncate text-muted-foreground">ID: <b className="font-mono text-foreground">{patient.nationalId || patient.identifierValue || "-"}</b></span>
        <span className="truncate text-muted-foreground">Phone: <b className="font-mono text-foreground">{patient.phone1 || "-"}</b></span>
        <span className="truncate text-muted-foreground">Age: <b className="text-foreground">{patient.ageYears || "-"}</b></span>
      </div>
    </div>
  );
}

function BlockerSummary({ blockers }: { blockers: PatientDuplicateBlockers }) {
  if (blockers.total === 0) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck size={13} /> Safe delete available</span>;
  }

  const parts = [
    blockers.legacyAppointments ? `${blockers.legacyAppointments} legacy appt` : "",
    blockers.v2Bookings ? `${blockers.v2Bookings} booking` : "",
    blockers.documents ? `${blockers.documents} document` : "",
    blockers.scanSessions ? `${blockers.scanSessions} scan` : "",
    blockers.patientImportRows ? `${blockers.patientImportRows} import` : "",
    blockers.dicomRemapJobs ? `${blockers.dicomRemapJobs} DICOM` : "",
    blockers.webPushRows ? `${blockers.webPushRows} notification` : "",
  ].filter(Boolean);

  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
      <AlertTriangle size={13} />
      {parts.join(", ")}
    </span>
  );
}

function CandidateButton({
  candidate,
  selected,
  onSelect,
}: {
  candidate: PatientDuplicateCandidate;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-border bg-background hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">{candidate.score}% match</span>
        <span className="text-xs text-muted-foreground">#{candidate.patientA.id} / #{candidate.patientB.id}</span>
      </div>
      <div className="mt-2 space-y-1">
        <p className="truncate text-sm">{displayPatientName(candidate.patientA)}</p>
        <p className="truncate text-sm">{displayPatientName(candidate.patientB)}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {candidate.reasons.slice(0, 4).map((reason) => (
          <Badge key={reason} variant="neutral" className="text-[10px]">{formatReason(reason)}</Badge>
        ))}
      </div>
    </button>
  );
}

export default function PatientDuplicateResolverSection({ onReAuthRequired }: PatientDuplicateResolverSectionProps) {
  const queryClient = useQueryClient();
  const [selectedPair, setSelectedPair] = useState<[number, number] | null>(null);
  const [query, setQuery] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [selectedAction, setSelectedAction] = useState<SelectedAction>(null);
  const [confirmationText, setConfirmationText] = useState("");

  const candidatesQuery = useQuery({
    queryKey: REAUTH_QUERY_KEY,
    queryFn: fetchPatientDuplicateCandidates,
    retry: false,
  });

  const candidates = candidatesQuery.data?.candidates || [];
  const filteredCandidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((candidate) => {
      const haystack = [
        candidate.patientA.id,
        candidate.patientA.mrn,
        candidate.patientA.nationalId,
        candidate.patientA.identifierValue,
        candidate.patientA.arabicFullName,
        candidate.patientA.englishFullName,
        candidate.patientA.phone1,
        candidate.patientB.id,
        candidate.patientB.mrn,
        candidate.patientB.nationalId,
        candidate.patientB.identifierValue,
        candidate.patientB.arabicFullName,
        candidate.patientB.englishFullName,
        candidate.patientB.phone1,
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [candidates, query]);

  const activePair = selectedPair || (filteredCandidates[0] ? [filteredCandidates[0].patientA.id, filteredCandidates[0].patientB.id] as [number, number] : null);

  const detailQuery = useQuery({
    queryKey: ["settings", "patient-duplicates", activePair?.[0], activePair?.[1]],
    queryFn: () => fetchPatientDuplicateDetail(activePair![0], activePair![1]),
    enabled: Boolean(activePair),
    retry: false,
  });

  const invalidateDuplicates = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: REAUTH_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ["settings", "patient-duplicates"] }),
    ]);
  };

  const dismissMutation = useMutation({
    mutationFn: () => {
      if (!activePair) throw new Error("Select a candidate first.");
      return dismissPatientDuplicate(activePair[0], activePair[1], dismissReason);
    },
    onSuccess: async () => {
      setDismissReason("");
      setSelectedPair(null);
      pushToast({ type: "success", title: "Duplicate candidate dismissed" });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
    },
  });

  const mergeMutation = useMutation({
    mutationFn: (action: Extract<SelectedAction, { type: "merge" }>) => mergePatientDuplicate(action.targetId, action.sourceId, confirmationText),
    onSuccess: async () => {
      setSelectedAction(null);
      setConfirmationText("");
      setSelectedPair(null);
      pushToast({ type: "success", title: "Patients merged" });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (action: Extract<SelectedAction, { type: "delete" }>) => safeDeleteDuplicatePatient(action.patientId, confirmationText),
    onSuccess: async () => {
      setSelectedAction(null);
      setConfirmationText("");
      setSelectedPair(null);
      pushToast({ type: "success", title: "Patient safely deleted" });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
    },
  });

  if (isReAuthError(candidatesQuery.error) || isReAuthError(detailQuery.error)) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <p className="font-semibold">Supervisor re-authentication is required.</p>
        <Button type="button" className="mt-3" size="sm" onClick={() => onReAuthRequired(REAUTH_QUERY_KEY)}>
          Re-authenticate
        </Button>
      </div>
    );
  }

  if (candidatesQuery.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading duplicate candidates...</div>;
  }

  const detail = detailQuery.data;
  const activeCandidate = detail?.candidate;
  const actionLabel = selectedAction?.type === "merge" ? "MERGE" : selectedAction?.type === "delete" ? "DELETE" : "";
  const actionReady = selectedAction && confirmationText.trim().toUpperCase() === actionLabel;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Fuzzy matches at {candidatesQuery.data?.threshold || 75}% or higher.</p>
          <p className="text-sm font-semibold text-foreground">{candidates.length} candidate pair{candidates.length === 1 ? "" : "s"} found</p>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="input-premium h-10 w-full pl-9" placeholder="Search candidates" />
        </div>
      </div>

      {filteredCandidates.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">No duplicate candidates need review.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,360px)_1fr]">
          <div className="max-h-[720px] space-y-2 overflow-y-auto pr-1">
            {filteredCandidates.map((candidate) => (
              <CandidateButton
                key={`${candidate.patientA.id}-${candidate.patientB.id}`}
                candidate={candidate}
                selected={activePair?.[0] === candidate.patientA.id && activePair?.[1] === candidate.patientB.id}
                onSelect={() => {
                  setSelectedPair([candidate.patientA.id, candidate.patientB.id]);
                  setSelectedAction(null);
                  setConfirmationText("");
                }}
              />
            ))}
          </div>

          <div className="rounded-lg border border-border bg-background p-4">
            {detailQuery.isLoading || !activeCandidate ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading comparison...</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold">{activeCandidate.score}% duplicate confidence</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {activeCandidate.reasons.map((reason) => <Badge key={reason} variant="neutral">{formatReason(reason)}</Badge>)}
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => dismissMutation.mutate()} disabled={dismissMutation.isPending}>
                    <XCircle size={16} />
                    Dismiss
                  </Button>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="space-y-3">
                    <PatientMiniCard patient={activeCandidate.patientA} />
                    <BlockerSummary blockers={activeCandidate.blockersA} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign(`/patients/${activeCandidate.patientA.id}/edit`)}>
                        <UserRoundCheck size={15} /> Open
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedAction({ type: "merge", targetId: activeCandidate.patientB.id, sourceId: activeCandidate.patientA.id }); setConfirmationText(""); }}>
                        <GitMerge size={15} /> Merge into B
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!activeCandidate.canSafeDeleteA} onClick={() => { setSelectedAction({ type: "delete", patientId: activeCandidate.patientA.id }); setConfirmationText(""); }}>
                        <Trash2 size={15} /> Safe delete
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <PatientMiniCard patient={activeCandidate.patientB} />
                    <BlockerSummary blockers={activeCandidate.blockersB} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign(`/patients/${activeCandidate.patientB.id}/edit`)}>
                        <UserRoundCheck size={15} /> Open
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedAction({ type: "merge", targetId: activeCandidate.patientA.id, sourceId: activeCandidate.patientB.id }); setConfirmationText(""); }}>
                        <GitMerge size={15} /> Merge into A
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!activeCandidate.canSafeDeleteB} onClick={() => { setSelectedAction({ type: "delete", patientId: activeCandidate.patientB.id }); setConfirmationText(""); }}>
                        <Trash2 size={15} /> Safe delete
                      </Button>
                    </div>
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Dismiss reason</span>
                  <input value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} className="input-premium h-10 w-full" placeholder="Optional note for audit log" />
                </label>

                {selectedAction ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                    <p className="text-sm font-semibold">
                      Type {actionLabel} to confirm {selectedAction.type === "merge" ? `merging patient #${selectedAction.sourceId} into #${selectedAction.targetId}` : `safe deleting patient #${selectedAction.patientId}`}.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="input-premium h-10 flex-1 bg-white" placeholder={actionLabel} />
                      <Button
                        type="button"
                        size="sm"
                        disabled={!actionReady || mergeMutation.isPending || deleteMutation.isPending}
                        onClick={() => {
                          if (!selectedAction) return;
                          if (selectedAction.type === "merge") mergeMutation.mutate(selectedAction);
                          if (selectedAction.type === "delete") deleteMutation.mutate(selectedAction);
                        }}
                      >
                        Confirm
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
