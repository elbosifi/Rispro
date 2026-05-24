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
  type PatientDuplicateCandidateFilters,
} from "@/lib/api-hooks";
import { ApiError } from "@/lib/api-client";
import { pushToast } from "@/lib/toast";
import { Button, Badge } from "@/components/shared";
import type { Patient, PatientDirectorySummary, PatientDuplicateBlockers, PatientDuplicateCandidate, PatientDuplicateSummary } from "@/types/api";

interface PatientDuplicateResolverSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

type SelectedAction =
  | { type: "merge"; targetId: number; sourceId: number }
  | { type: "mergeGroup"; targetId: number; sourceIds: number[] }
  | { type: "delete"; patientId: number }
  | null;

const REAUTH_QUERY_KEY = ["settings", "patient-duplicates"];

type MergeField =
  | "arabicFullName"
  | "englishFullName"
  | "nationalId"
  | "identifierType"
  | "identifierValue"
  | "category"
  | "ageYears"
  | "estimatedDateOfBirth"
  | "sex"
  | "phone1"
  | "phone2"
  | "address";

type MergeDraft = Record<MergeField, string>;
type CandidateSort = "confidence" | "newest" | "risk";

const DEFAULT_CANDIDATE_FILTERS: PatientDuplicateCandidateFilters = {
  threshold: 75,
  mode: "balanced",
  category: "",
  sex: "",
  dobProximity: "",
  hasIdentifier: "",
  hasPhone: "",
};

const MERGE_FIELDS: Array<{ key: MergeField; label: string; type?: "number" | "select" }> = [
  { key: "arabicFullName", label: "Arabic name" },
  { key: "englishFullName", label: "English name" },
  { key: "nationalId", label: "National ID" },
  { key: "identifierType", label: "Identifier type", type: "select" },
  { key: "identifierValue", label: "Identifier value" },
  { key: "category", label: "Category", type: "select" },
  { key: "ageYears", label: "Age", type: "number" },
  { key: "estimatedDateOfBirth", label: "Date of birth" },
  { key: "sex", label: "Sex", type: "select" },
  { key: "phone1", label: "Phone 1" },
  { key: "phone2", label: "Phone 2" },
  { key: "address", label: "Address" },
];

const EMPTY_MERGE_DRAFT: MergeDraft = {
  arabicFullName: "",
  englishFullName: "",
  nationalId: "",
  identifierType: "national_id",
  identifierValue: "",
  category: "",
  ageYears: "",
  estimatedDateOfBirth: "",
  sex: "",
  phone1: "",
  phone2: "",
  address: "",
};

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

function summaryToPatient(summary: PatientDirectorySummary): Patient {
  return {
    id: summary.demographics.id,
    mrn: summary.demographics.mrn,
    nationalId: summary.identifiers.nationalId,
    identifierType: summary.identifiers.identifierType,
    identifierValue: summary.identifiers.identifierValue,
    category: summary.category,
    arabicFullName: summary.demographics.arabicFullName,
    englishFullName: summary.demographics.englishFullName,
    ageYears: summary.demographics.ageYears,
    demographicsEstimated: summary.demographics.demographicsEstimated,
    estimatedDateOfBirth: summary.demographics.dateOfBirth,
    sex: summary.demographics.sex || "",
    phone1: summary.contact.phone1 || "",
    phone2: summary.contact.phone2,
    address: summary.contact.address,
  };
}

function buildDraftFromPatient(patient: Patient): MergeDraft {
  return {
    arabicFullName: patient.arabicFullName || "",
    englishFullName: patient.englishFullName || "",
    nationalId: patient.nationalId || "",
    identifierType: patient.identifierType || "national_id",
    identifierValue: patient.identifierValue || patient.nationalId || "",
    category: patient.category || "",
    ageYears: patient.ageYears ? String(patient.ageYears) : "",
    estimatedDateOfBirth: dateInputValue(patient.estimatedDateOfBirth),
    sex: patient.sex || "",
    phone1: patient.phone1 || "",
    phone2: patient.phone2 || "",
    address: patient.address || "",
  };
}

function fieldValue(patient: Patient, key: MergeField): string {
  return buildDraftFromPatient(patient)[key] || "";
}

function dateInputValue(value: string | null | undefined): string {
  return String(value || "").slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The merge request failed.";
}

function draftToPatientPayload(draft: MergeDraft): Partial<Patient> & { nationalIdConfirmation?: string } {
  return {
    arabicFullName: draft.arabicFullName.trim(),
    englishFullName: draft.englishFullName.trim(),
    nationalId: draft.nationalId.trim(),
    nationalIdConfirmation: draft.nationalId.trim(),
    identifierType: draft.identifierType || "national_id",
    identifierValue: draft.identifierValue.trim(),
    category: draft.category === "oncology" || draft.category === "non_oncology" ? draft.category : null,
    ageYears: Number(draft.ageYears || 0),
    estimatedDateOfBirth: dateInputValue(draft.estimatedDateOfBirth.trim()),
    sex: draft.sex.trim(),
    phone1: draft.phone1.trim(),
    phone2: draft.phone2.trim(),
    address: draft.address.trim(),
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

function SignalBadges({ candidate }: { candidate: PatientDuplicateCandidate }) {
  const signals = candidate.signals?.length ? candidate.signals : candidate.reasons.map((reason) => ({ field: reason, label: formatReason(reason), status: "info" as const }));
  return (
    <div className="flex flex-wrap gap-1">
      {signals.map((signal, index) => (
        <Badge
          key={`${signal.field}-${signal.label}-${index}`}
          variant="neutral"
          className={`text-[10px] ${
            signal.status === "mismatch"
              ? "border-red-200 bg-red-50 text-red-700"
              : signal.status === "match"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : signal.status === "similar"
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : ""
          }`}
        >
          {signal.label}
        </Badge>
      ))}
    </div>
  );
}

function ConflictSummary({ candidate }: { candidate: PatientDuplicateCandidate }) {
  if (!candidate.conflicts?.length) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="font-semibold">Hard conflicts need acknowledgement</p>
      <div className="mt-2 space-y-1">
        {candidate.conflicts.map((conflict) => (
          <p key={conflict.field} className="font-mono text-xs">
            {formatReason(conflict.field)}: {conflict.patientAValue || "-"} / {conflict.patientBValue || "-"}
          </p>
        ))}
      </div>
    </div>
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
        <SignalBadges candidate={{ ...candidate, signals: candidate.signals?.slice(0, 4) || [] }} />
        {candidate.conflicts?.length ? <Badge variant="neutral" className="border-red-200 bg-red-50 text-[10px] text-red-700">{candidate.conflicts.length} conflict{candidate.conflicts.length === 1 ? "" : "s"}</Badge> : null}
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
  const [mergeDraft, setMergeDraft] = useState<MergeDraft>(EMPTY_MERGE_DRAFT);
  const [fieldSources, setFieldSources] = useState<Partial<Record<MergeField, number | "manual">>>({});
  const [dismissReason, setDismissReason] = useState("");
  const [selectedAction, setSelectedAction] = useState<SelectedAction>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [candidateFilters, setCandidateFilters] = useState<PatientDuplicateCandidateFilters>(DEFAULT_CANDIDATE_FILTERS);
  const [appliedCandidateFilters, setAppliedCandidateFilters] = useState<PatientDuplicateCandidateFilters>(DEFAULT_CANDIDATE_FILTERS);
  const [candidateSort, setCandidateSort] = useState<CandidateSort>("confidence");
  const [conflictsAcknowledged, setConflictsAcknowledged] = useState(false);

  const candidatesQuery = useQuery({
    queryKey: [...REAUTH_QUERY_KEY, appliedCandidateFilters],
    queryFn: () => fetchPatientDuplicateCandidates(appliedCandidateFilters),
    retry: false,
  });

  const candidates = candidatesQuery.data?.candidates || [];
  const filteredCandidates = useMemo(() => {
    const needle = candidateQuery.trim().toLowerCase();
    const visible = !needle ? candidates : candidates.filter((candidate) => {
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
    return [...visible].sort((a, b) => {
      if (candidateSort === "newest") return Math.max(b.patientA.id, b.patientB.id) - Math.max(a.patientA.id, a.patientB.id);
      if (candidateSort === "risk") return (b.conflicts?.length || 0) - (a.conflicts?.length || 0) || b.score - a.score;
      return b.score - a.score || b.patientA.id - a.patientA.id;
    });
  }, [candidates, candidateQuery, candidateSort]);

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
      pushToast({ type: "success", title: "Patients merged", message: "The duplicate source record was merged into the selected survivor." });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
      else pushToast({ type: "error", title: "Merge failed", message: errorMessage(error) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (action: Extract<SelectedAction, { type: "delete" }>) => safeDeleteDuplicatePatient(action.patientId, confirmationText),
    onSuccess: async () => {
      setSelectedAction(null);
      setConfirmationText("");
      setSelectedPair(null);
      pushToast({ type: "success", title: "Patient safely deleted", message: "The duplicate record had no linked history and was removed." });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
      else pushToast({ type: "error", title: "Delete failed", message: errorMessage(error) });
    },
  });

  const mergeGroupMutation = useMutation({
    mutationFn: (action: Extract<SelectedAction, { type: "mergeGroup" }>) => mergePatientDuplicateGroup(action.targetId, action.sourceIds, confirmationText, draftToPatientPayload(mergeDraft)),
    onSuccess: async () => {
      const mergedCount = selectedAction?.type === "mergeGroup" ? selectedAction.sourceIds.length : 0;
      setSelectedAction(null);
      setConfirmationText("");
      setSelectedPair(null);
      setManualSelection([]);
      setManualTargetId(null);
      setMergeDraft(EMPTY_MERGE_DRAFT);
      setFieldSources({});
      pushToast({ type: "success", title: "Selected patients merged", message: `${mergedCount || "Selected"} duplicate record${mergedCount === 1 ? "" : "s"} merged into the survivor.` });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
      else pushToast({ type: "error", title: "Merge failed", message: errorMessage(error) });
    },
  });

  const addManualPatient = (patient: Patient) => {
    setManualSelection((current) => {
      if (current.some((selected) => selected.id === patient.id)) return current;
      const next = [...current, patient];
      if (current.length === 0) {
        setManualTargetId(patient.id);
        setMergeDraft(buildDraftFromPatient(patient));
        setFieldSources(Object.fromEntries(MERGE_FIELDS.map((field) => [field.key, patient.id])) as Partial<Record<MergeField, number | "manual">>);
      }
      return next;
    });
  };

  const addCandidateToManualSet = (candidate: PatientDuplicateCandidate) => {
    if (detail?.summaryA && detail?.summaryB) {
      addManualPatient(summaryToPatient(detail.summaryA));
      addManualPatient(summaryToPatient(detail.summaryB));
      return;
    }
    addManualPatient(duplicateSummaryToPatient(candidate.patientA));
    addManualPatient(duplicateSummaryToPatient(candidate.patientB));
  };

  const addLikelyDuplicatesForPatient = (patientId: number) => {
    const related = candidates.filter((candidate) => candidate.patientA.id === patientId || candidate.patientB.id === patientId);
    related.forEach((candidate) => {
      addManualPatient(duplicateSummaryToPatient(candidate.patientA));
      addManualPatient(duplicateSummaryToPatient(candidate.patientB));
    });
  };

  const removeManualPatient = (patientId: number) => {
    setManualSelection((current) => current.filter((patient) => patient.id !== patientId));
    if (manualTargetId === patientId) {
      const nextTarget = manualSelection.find((patient) => patient.id !== patientId)?.id ?? null;
      setManualTargetId(nextTarget);
      const nextPatient = manualSelection.find((patient) => patient.id !== patientId);
      if (nextPatient) {
        setMergeDraft(buildDraftFromPatient(nextPatient));
        setFieldSources(Object.fromEntries(MERGE_FIELDS.map((field) => [field.key, nextPatient.id])) as Partial<Record<MergeField, number | "manual">>);
      } else {
        setMergeDraft(EMPTY_MERGE_DRAFT);
        setFieldSources({});
      }
    }
  };

  const usePatientField = (patient: Patient, key: MergeField) => {
    setMergeDraft((current) => ({ ...current, [key]: fieldValue(patient, key) }));
    setFieldSources((current) => ({ ...current, [key]: patient.id }));
  };

  const editDraftField = (key: MergeField, value: string) => {
    setMergeDraft((current) => ({ ...current, [key]: value }));
    setFieldSources((current) => ({ ...current, [key]: "manual" }));
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
  const selectedMergeHasConflicts = selectedAction?.type === "merge" && Boolean(activeCandidate?.conflicts?.length);
  const actionReady = selectedAction && confirmationText.trim().toUpperCase() === actionLabel && (!selectedMergeHasConflicts || conflictsAcknowledged);
  const manualTarget = manualSelection.find((patient) => patient.id === manualTargetId) || null;
  const manualSources = manualSelection.filter((patient) => patient.id !== manualTargetId);
  const confirmationPanel = selectedAction ? (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
      <p className="text-sm font-semibold">
        Type {actionLabel} to confirm{" "}
        {selectedAction.type === "merge"
          ? `merging patient #${selectedAction.sourceId} into #${selectedAction.targetId}`
          : selectedAction.type === "mergeGroup"
            ? `merging ${selectedAction.sourceIds.length} selected patient records into #${selectedAction.targetId}`
            : `safe deleting patient #${selectedAction.patientId}`}.
      </p>
      {selectedMergeHasConflicts ? (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={conflictsAcknowledged} onChange={(event) => setConflictsAcknowledged(event.target.checked)} className="mt-1" />
          <span>I reviewed the hard conflicts and still want to merge these records.</span>
        </label>
      ) : null}
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
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Fuzzy matches at {candidatesQuery.data?.threshold || 75}% or higher in {candidatesQuery.data?.mode || "balanced"} mode.</p>
          <p className="text-sm font-semibold text-foreground">{candidatesQuery.data?.candidateCount ?? candidates.length} candidate pair{(candidatesQuery.data?.candidateCount ?? candidates.length) === 1 ? "" : "s"} found</p>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} className="input-premium h-10 w-full pl-9" placeholder="Filter candidate queue" />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Match threshold: {candidateFilters.threshold}</span>
            <input
              type="range"
              min={40}
              max={100}
              value={candidateFilters.threshold || 75}
              onChange={(event) => setCandidateFilters((current) => ({ ...current, threshold: Number(event.target.value) }))}
              className="w-full"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Mode</span>
            <select value={candidateFilters.mode || "balanced"} onChange={(event) => setCandidateFilters((current) => ({ ...current, mode: event.target.value as PatientDuplicateCandidateFilters["mode"] }))} className="input-premium h-9 w-full text-sm">
              <option value="strict">Strict</option>
              <option value="balanced">Balanced</option>
              <option value="broad">Broad</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sort</span>
            <select value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as CandidateSort)} className="input-premium h-9 w-full text-sm">
              <option value="confidence">Confidence</option>
              <option value="newest">Newest</option>
              <option value="risk">Risk</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Category</span>
            <select value={candidateFilters.category || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, category: event.target.value as PatientDuplicateCandidateFilters["category"] }))} className="input-premium h-9 w-full text-sm">
              <option value="">Any</option>
              <option value="oncology">Oncology</option>
              <option value="non_oncology">Non-oncology</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Sex</span>
            <select value={candidateFilters.sex || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, sex: event.target.value }))} className="input-premium h-9 w-full text-sm">
              <option value="">Any</option>
              <option value="m">M</option>
              <option value="f">F</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Identifier</span>
            <select value={candidateFilters.hasIdentifier || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, hasIdentifier: event.target.value as PatientDuplicateCandidateFilters["hasIdentifier"] }))} className="input-premium h-9 w-full text-sm">
              <option value="">Any</option>
              <option value="true">Present</option>
              <option value="false">Missing</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Phone</span>
            <select value={candidateFilters.hasPhone || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, hasPhone: event.target.value as PatientDuplicateCandidateFilters["hasPhone"] }))} className="input-premium h-9 w-full text-sm">
              <option value="">Any</option>
              <option value="true">Present</option>
              <option value="false">Missing</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={candidateFilters.dobProximity === "true"}
              onChange={(event) => setCandidateFilters((current) => ({ ...current, dobProximity: event.target.checked ? "true" : "" }))}
            />
            DOB or age match
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={() => { setAppliedCandidateFilters(candidateFilters); setSelectedPair(null); setSelectedAction(null); setConfirmationText(""); setConflictsAcknowledged(false); }} disabled={candidatesQuery.isFetching}>
            {candidatesQuery.isFetching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Refresh candidates
          </Button>
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
              setConflictsAcknowledged(false);
            }}
          >
            <GitMerge size={15} />
            Merge selected
          </Button>
        </div>
        {selectedAction?.type === "mergeGroup" ? <div className="mt-3">{confirmationPanel}</div> : null}

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
              <Button type="button" variant="ghost" size="sm" disabled={manualSelection.length === 0} onClick={() => { setManualSelection([]); setManualTargetId(null); setMergeDraft(EMPTY_MERGE_DRAFT); setFieldSources({}); }}>
                Clear
              </Button>
            </div>
            {manualSelection.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">No manual merge set yet. Add patients from search or from an automatic candidate.</div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
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
                            onChange={() => {
                              setManualTargetId(patient.id);
                              if (Object.keys(fieldSources).length === 0) {
                                setMergeDraft(buildDraftFromPatient(patient));
                                setFieldSources(Object.fromEntries(MERGE_FIELDS.map((field) => [field.key, patient.id])) as Partial<Record<MergeField, number | "manual">>);
                              }
                            }}
                          />
                          Keep this record
                        </label>
                        {isTarget ? <Badge variant="accent">Survivor</Badge> : <Badge variant="warning">Source</Badge>}
                      </div>
                      <div className="mt-3 space-y-1 border-t border-border pt-3">
                        {MERGE_FIELDS.map((field) => {
                          const value = fieldValue(patient, field.key) || "-";
                          const selected = fieldSources[field.key] === patient.id;
                          return (
                            <div key={field.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
                              <span className="text-muted-foreground">{field.label}</span>
                              <span className="truncate font-medium text-foreground" title={value}>{value}</span>
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 font-semibold ${selected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                                onClick={() => usePatientField(patient, field.key)}
                              >
                                {selected ? "Using" : "Use"}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {manualSelection.length > 0 ? (
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Final survivor details</p>
                    <p className="text-xs text-muted-foreground">Pick fields from any selected patient or edit values manually before merge.</p>
                  </div>
                  {manualTarget ? <Badge variant="accent">Saving to #{manualTarget.id}</Badge> : null}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {MERGE_FIELDS.map((field) => {
                    const source = fieldSources[field.key];
                    const sourceLabel = source === "manual" ? "Manual edit" : source ? `From #${source}` : "Unset";
                    return (
                      <label key={field.key} className="space-y-1">
                        <span className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                          {field.label}
                          <span className="font-normal">{sourceLabel}</span>
                        </span>
                        {field.key === "identifierType" ? (
                          <select value={mergeDraft.identifierType} onChange={(event) => editDraftField(field.key, event.target.value)} className="input-premium h-10 w-full text-sm">
                            <option value="national_id">National ID</option>
                            <option value="passport">Passport</option>
                            <option value="other">Other</option>
                          </select>
                        ) : field.key === "category" ? (
                          <select value={mergeDraft.category} onChange={(event) => editDraftField(field.key, event.target.value)} className="input-premium h-10 w-full text-sm">
                            <option value="">Unset</option>
                            <option value="oncology">Oncology</option>
                            <option value="non_oncology">Non-oncology</option>
                          </select>
                        ) : field.key === "sex" ? (
                          <select value={mergeDraft.sex} onChange={(event) => editDraftField(field.key, event.target.value)} className="input-premium h-10 w-full text-sm">
                            <option value="">Unset</option>
                            <option value="M">M</option>
                            <option value="F">F</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                          </select>
                        ) : (
                          <input
                            type={field.type === "number" ? "number" : field.key === "estimatedDateOfBirth" ? "date" : "text"}
                            value={mergeDraft[field.key]}
                            onChange={(event) => editDraftField(field.key, event.target.value)}
                            className="input-premium h-10 w-full text-sm"
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
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
                  setConflictsAcknowledged(false);
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
                  <Button type="button" variant="outline" size="sm" onClick={() => addLikelyDuplicatesForPatient(activeCandidate.patientA.id)}>
                    <Users size={16} />
                    Add likely set
                  </Button>
                </div>

                <ConflictSummary candidate={activeCandidate} />
                <SignalBadges candidate={activeCandidate} />

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="space-y-3">
                    <PatientMiniCard patient={activeCandidate.patientA} />
                    <BlockerSummary blockers={activeCandidate.blockersA} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign(`/patients/${activeCandidate.patientA.id}/edit`)}>
                        <UserRoundCheck size={15} /> Open
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedAction({ type: "merge", targetId: activeCandidate.patientB.id, sourceId: activeCandidate.patientA.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <GitMerge size={15} /> Merge into B
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!activeCandidate.canSafeDeleteA} onClick={() => { setSelectedAction({ type: "delete", patientId: activeCandidate.patientA.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
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
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedAction({ type: "merge", targetId: activeCandidate.patientA.id, sourceId: activeCandidate.patientB.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <GitMerge size={15} /> Merge into A
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!activeCandidate.canSafeDeleteB} onClick={() => { setSelectedAction({ type: "delete", patientId: activeCandidate.patientB.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <Trash2 size={15} /> Safe delete
                      </Button>
                    </div>
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">Dismiss reason</span>
                  <input value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} className="input-premium h-10 w-full" placeholder="Optional note for audit log" />
                </label>

                {selectedAction?.type !== "mergeGroup" ? confirmationPanel : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
