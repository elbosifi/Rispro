import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, GitMerge, Loader2, Search, ShieldCheck, Trash2, UserPlus, UserRoundCheck, Users, XCircle } from "lucide-react";
import {
  dismissPatientDuplicate,
  fetchPatientDuplicateCandidates,
  fetchPatientDuplicateDetail,
  mergePatientDuplicate,
  mergePatientDuplicateGroup,
  safeDeleteDuplicatePatient,
  searchPatientsForDuplicateResolver,
} from "@/lib/api-hooks";
import { ApiError } from "@/lib/api-client";
import { pushToast } from "@/lib/toast";
import { Button, Badge } from "@/components/shared";
import type { Patient, PatientDuplicateBlockers, PatientDuplicateCandidate, PatientDuplicateSummary } from "@/types/api";

interface PatientDuplicateResolverSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

type SelectedAction =
  | { type: "merge"; targetId: number; sourceId: number }
  | { type: "mergeGroup"; targetId: number; sourceIds: number[] }
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

function patientToDuplicateSummary(patient: Patient): PatientDuplicateSummary {
  return {
    id: patient.id,
    mrn: patient.mrn || null,
    nationalId: patient.nationalId || null,
    identifierType: patient.identifierType || null,
    identifierValue: patient.identifierValue || null,
    arabicFullName: patient.arabicFullName,
    englishFullName: patient.englishFullName || null,
    ageYears: patient.ageYears,
    dateOfBirth: patient.estimatedDateOfBirth || null,
    sex: patient.sex || null,
    phone1: patient.phone1 || null,
    phone2: patient.phone2 || null,
    category: patient.category || null,
  };
}

function duplicateSummaryToPatient(patient: PatientDuplicateSummary): Patient {
  return {
    id: patient.id,
    mrn: patient.mrn,
    nationalId: patient.nationalId,
    identifierType: patient.identifierType,
    identifierValue: patient.identifierValue,
    category: patient.category,
    arabicFullName: patient.arabicFullName,
    englishFullName: patient.englishFullName,
    ageYears: patient.ageYears,
    estimatedDateOfBirth: patient.dateOfBirth,
    sex: patient.sex || "",
    phone1: patient.phone1 || "",
    phone2: patient.phone2,
  };
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
  const [candidateQuery, setCandidateQuery] = useState("");
  const [manualQuery, setManualQuery] = useState("");
  const [manualSelection, setManualSelection] = useState<Patient[]>([]);
  const [manualTargetId, setManualTargetId] = useState<number | null>(null);
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
    const needle = candidateQuery.trim().toLowerCase();
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
  }, [candidates, candidateQuery]);

  const manualSearchQuery = useQuery({
    queryKey: ["settings", "patient-duplicates", "manual-search", manualQuery.trim()],
    queryFn: () => searchPatientsForDuplicateResolver(manualQuery.trim()),
    enabled: manualQuery.trim().length >= 2,
    staleTime: 1000 * 30,
    retry: false,
  });

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

  const mergeGroupMutation = useMutation({
    mutationFn: (action: Extract<SelectedAction, { type: "mergeGroup" }>) => mergePatientDuplicateGroup(action.targetId, action.sourceIds, confirmationText),
    onSuccess: async () => {
      setSelectedAction(null);
      setConfirmationText("");
      setSelectedPair(null);
      setManualSelection([]);
      setManualTargetId(null);
      pushToast({ type: "success", title: "Selected patients merged" });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
    },
  });

  const addManualPatient = (patient: Patient) => {
    setManualSelection((current) => {
      if (current.some((selected) => selected.id === patient.id)) return current;
      const next = [...current, patient];
      if (!manualTargetId) setManualTargetId(patient.id);
      return next;
    });
  };

  const addCandidateToManualSet = (candidate: PatientDuplicateCandidate) => {
    addManualPatient(duplicateSummaryToPatient(candidate.patientA));
    addManualPatient(duplicateSummaryToPatient(candidate.patientB));
  };

  const removeManualPatient = (patientId: number) => {
    setManualSelection((current) => current.filter((patient) => patient.id !== patientId));
    if (manualTargetId === patientId) {
      const nextTarget = manualSelection.find((patient) => patient.id !== patientId)?.id ?? null;
      setManualTargetId(nextTarget);
    }
  };

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
  const actionLabel = selectedAction?.type === "merge" || selectedAction?.type === "mergeGroup" ? "MERGE" : selectedAction?.type === "delete" ? "DELETE" : "";
  const actionReady = selectedAction && confirmationText.trim().toUpperCase() === actionLabel;
  const manualTarget = manualSelection.find((patient) => patient.id === manualTargetId) || null;
  const manualSources = manualSelection.filter((patient) => patient.id !== manualTargetId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Fuzzy matches at {candidatesQuery.data?.threshold || 75}% or higher.</p>
          <p className="text-sm font-semibold text-foreground">{candidates.length} candidate pair{candidates.length === 1 ? "" : "s"} found</p>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} className="input-premium h-10 w-full pl-9" placeholder="Filter candidate queue" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Users size={18} className="text-accent" />
              <p className="text-base font-semibold text-foreground">Manual merge workbench</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Search any patient, build a merge set, choose the survivor, then merge all selected duplicate records into that patient.</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!manualTarget || manualSources.length === 0}
            onClick={() => {
              if (!manualTarget || manualSources.length === 0) return;
              setSelectedAction({ type: "mergeGroup", targetId: manualTarget.id, sourceIds: manualSources.map((patient) => patient.id) });
              setConfirmationText("");
            }}
          >
            <GitMerge size={15} />
            Merge selected
          </Button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(260px,420px)_1fr]">
          <div className="space-y-3">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={manualQuery}
                onChange={(event) => setManualQuery(event.target.value)}
                className="input-premium h-10 w-full pl-9"
                placeholder="Search by name, MRN, ID, or phone"
              />
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {manualQuery.trim().length < 2 ? (
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-muted-foreground">Type at least 2 characters to search manually.</div>
              ) : manualSearchQuery.isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Searching...</div>
              ) : (manualSearchQuery.data || []).length === 0 ? (
                <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">No patients found.</div>
              ) : (
                (manualSearchQuery.data || []).map((patient) => {
                  const isSelected = manualSelection.some((selected) => selected.id === patient.id);
                  return (
                    <button
                      key={patient.id}
                      type="button"
                      onClick={() => addManualPatient(patient)}
                      disabled={isSelected}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-border bg-background hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{patient.arabicFullName}</p>
                          <p className="truncate text-xs text-muted-foreground">{patient.englishFullName || "No English name"}</p>
                        </div>
                        {isSelected ? <CheckCircle2 size={16} className="shrink-0 text-emerald-600" /> : <UserPlus size={16} className="shrink-0 text-muted-foreground" />}
                      </div>
                      <p className="mt-2 truncate text-xs text-muted-foreground">#{patient.id} • {patient.mrn || "No MRN"} • {patient.nationalId || patient.identifierValue || "No ID"} • {patient.phone1 || "No phone"}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">Selected patients ({manualSelection.length})</p>
              <Button type="button" variant="ghost" size="sm" disabled={manualSelection.length === 0} onClick={() => { setManualSelection([]); setManualTargetId(null); }}>
                Clear
              </Button>
            </div>
            {manualSelection.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">No manual merge set yet. Add patients from search or from an automatic candidate.</div>
            ) : (
              <div className="grid gap-2 lg:grid-cols-2">
                {manualSelection.map((patient) => {
                  const isTarget = patient.id === manualTargetId;
                  return (
                    <div key={patient.id} className={`rounded-lg border p-3 ${isTarget ? "border-accent bg-accent/10" : "border-border bg-background"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{patient.arabicFullName}</p>
                          <p className="truncate text-xs text-muted-foreground">#{patient.id} • {patient.mrn || "No MRN"}</p>
                        </div>
                        <button type="button" className="text-muted-foreground hover:text-red-600" onClick={() => removeManualPatient(patient.id)} aria-label="Remove patient">
                          <XCircle size={16} />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-2 text-xs font-semibold">
                          <input
                            type="radio"
                            name="manual-merge-target"
                            checked={isTarget}
                            onChange={() => setManualTargetId(patient.id)}
                          />
                          Keep this record
                        </label>
                        {isTarget ? <Badge variant="accent">Survivor</Badge> : <Badge variant="warning">Source</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
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
                  <Button type="button" variant="outline" size="sm" onClick={() => addCandidateToManualSet(activeCandidate)}>
                    <UserPlus size={16} />
                    Add both to merge set
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
                      Type {actionLabel} to confirm{" "}
                      {selectedAction.type === "merge"
                        ? `merging patient #${selectedAction.sourceId} into #${selectedAction.targetId}`
                        : selectedAction.type === "mergeGroup"
                          ? `merging ${selectedAction.sourceIds.length} selected patient records into #${selectedAction.targetId}`
                          : `safe deleting patient #${selectedAction.patientId}`}.
                    </p>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="input-premium h-10 flex-1 bg-white" placeholder={actionLabel} />
                      <Button
                        type="button"
                        size="sm"
                        disabled={!actionReady || mergeMutation.isPending || deleteMutation.isPending || mergeGroupMutation.isPending}
                        onClick={() => {
                          if (!selectedAction) return;
                          if (selectedAction.type === "merge") mergeMutation.mutate(selectedAction);
                          if (selectedAction.type === "mergeGroup") mergeGroupMutation.mutate(selectedAction);
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
