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
import { useLanguage } from "@/providers/language-provider";
import type { TranslationKey } from "@/lib/i18n";
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

const MERGE_FIELDS: Array<{ key: MergeField; labelKey: TranslationKey; type?: "number" | "select" }> = [
  { key: "arabicFullName", labelKey: "patientMerge.field.arabicName" },
  { key: "englishFullName", labelKey: "patientMerge.field.englishName" },
  { key: "nationalId", labelKey: "patientMerge.field.nationalId" },
  { key: "identifierType", labelKey: "patientMerge.field.identifierType", type: "select" },
  { key: "identifierValue", labelKey: "patientMerge.field.identifierValue" },
  { key: "category", labelKey: "patientMerge.field.category", type: "select" },
  { key: "ageYears", labelKey: "patientMerge.field.age", type: "number" },
  { key: "estimatedDateOfBirth", labelKey: "patientMerge.field.dob" },
  { key: "sex", labelKey: "patientMerge.field.sex", type: "select" },
  { key: "phone1", labelKey: "patientMerge.field.phone1" },
  { key: "phone2", labelKey: "patientMerge.field.phone2" },
  { key: "address", labelKey: "patientMerge.field.address" },
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

function fieldLabelKey(field: string): TranslationKey {
  const map: Record<string, TranslationKey> = {
    arabic_name: "patientMerge.field.arabicName",
    english_name: "patientMerge.field.englishName",
    identifier: "patientMerge.field.identifier",
    national_id: "patientMerge.field.nationalId",
    date_of_birth: "patientMerge.field.dob",
    age: "patientMerge.field.age",
    sex: "patientMerge.field.sex",
    category: "patientMerge.field.category",
    phone: "patientMerge.field.phone",
  };
  return map[field] || "patientMerge.field.other";
}

function signalLabel(signal: PatientDuplicateCandidate["signals"][number], t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const field = t(fieldLabelKey(signal.field));
  if (typeof signal.score === "number") return t("patientMerge.signal.score", { field, score: signal.score });
  if (signal.status === "mismatch") return t("patientMerge.signal.mismatch", { field });
  if (signal.status === "similar") return t("patientMerge.signal.similar", { field });
  if (signal.status === "match") return t("patientMerge.signal.match", { field });
  return signal.label ? formatReason(signal.label) : field;
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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
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
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{displayPatientName(patient)}</p>
          <p className="truncate text-xs text-muted-foreground">{patient.englishFullName || t("patientMerge.noEnglishName")}</p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">#{patient.id}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="truncate text-muted-foreground">{t("patientMerge.field.mrn")}: <b className="font-mono text-foreground">{patient.mrn || "-"}</b></span>
        <span className="truncate text-muted-foreground">{t("patientMerge.field.id")}: <b className="font-mono text-foreground">{patient.nationalId || patient.identifierValue || "-"}</b></span>
        <span className="truncate text-muted-foreground">{t("patientMerge.field.phone")}: <b className="font-mono text-foreground">{patient.phone1 || "-"}</b></span>
        <span className="truncate text-muted-foreground">{t("patientMerge.field.age")}: <b className="text-foreground">{patient.ageYears || "-"}</b></span>
      </div>
    </div>
  );
}

function BlockerSummary({ blockers }: { blockers: PatientDuplicateBlockers }) {
  const { t } = useLanguage();
  if (blockers.total === 0) {
    return <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck size={13} /> {t("patientMerge.safeDeleteAvailable")}</span>;
  }

  const parts = [
    blockers.legacyAppointments ? t("patientMerge.blocker.legacyAppointments", { count: blockers.legacyAppointments }) : "",
    blockers.v2Bookings ? t("patientMerge.blocker.bookings", { count: blockers.v2Bookings }) : "",
    blockers.documents ? t("patientMerge.blocker.documents", { count: blockers.documents }) : "",
    blockers.scanSessions ? t("patientMerge.blocker.scans", { count: blockers.scanSessions }) : "",
    blockers.patientImportRows ? t("patientMerge.blocker.imports", { count: blockers.patientImportRows }) : "",
    blockers.dicomRemapJobs ? `${blockers.dicomRemapJobs} DICOM` : "",
    blockers.webPushRows ? t("patientMerge.blocker.notifications", { count: blockers.webPushRows }) : "",
  ].filter(Boolean);

  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700">
      <AlertTriangle size={13} />
      {parts.join(", ")}
    </span>
  );
}

function SignalBadges({ candidate }: { candidate: PatientDuplicateCandidate }) {
  const { t } = useLanguage();
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
          {signalLabel(signal, t)}
        </Badge>
      ))}
    </div>
  );
}

function ConflictSummary({ candidate }: { candidate: PatientDuplicateCandidate }) {
  const { t } = useLanguage();
  if (!candidate.conflicts?.length) return null;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      <p className="font-semibold">{t("patientMerge.conflictsNeedAcknowledgement")}</p>
      <div className="mt-2 space-y-1">
        {candidate.conflicts.map((conflict) => (
          <p key={conflict.field} className="font-mono text-xs">
            {t(fieldLabelKey(conflict.field))}: {conflict.patientAValue || "-"} / {conflict.patientBValue || "-"}
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
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-accent bg-accent/10" : "border-border bg-background hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">{t("patientMerge.percentMatch", { score: candidate.score })}</span>
        <span className="text-xs text-muted-foreground">#{candidate.patientA.id} / #{candidate.patientB.id}</span>
      </div>
      <div className="mt-2 space-y-1">
        <p className="truncate text-sm">{displayPatientName(candidate.patientA)}</p>
        <p className="truncate text-sm">{displayPatientName(candidate.patientB)}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <SignalBadges candidate={{ ...candidate, signals: candidate.signals?.slice(0, 4) || [] }} />
        {candidate.conflicts?.length ? <Badge variant="neutral" className="border-red-200 bg-red-50 text-[10px] text-red-700">{t("patientMerge.conflictCount", { count: candidate.conflicts.length })}</Badge> : null}
      </div>
    </button>
  );
}

export default function PatientDuplicateResolverSection({ onReAuthRequired }: PatientDuplicateResolverSectionProps) {
  const { t } = useLanguage();
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
      if (!activePair) throw new Error(t("patientMerge.selectCandidateFirst"));
      return dismissPatientDuplicate(activePair[0], activePair[1], dismissReason);
    },
    onSuccess: async () => {
      setDismissReason("");
      setSelectedPair(null);
      pushToast({ type: "success", title: t("patientMerge.toast.dismissed") });
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
      pushToast({ type: "success", title: t("patientMerge.toast.merged"), message: t("patientMerge.toast.mergedMessage") });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
      else pushToast({ type: "error", title: t("patientMerge.toast.mergeFailed"), message: errorMessage(error, t("patientMerge.toast.mergeFailedMessage")) });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (action: Extract<SelectedAction, { type: "delete" }>) => safeDeleteDuplicatePatient(action.patientId, confirmationText),
    onSuccess: async () => {
      setSelectedAction(null);
      setConfirmationText("");
      setSelectedPair(null);
      pushToast({ type: "success", title: t("patientMerge.toast.deleted"), message: t("patientMerge.toast.deletedMessage") });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
      else pushToast({ type: "error", title: t("patientMerge.toast.deleteFailed"), message: errorMessage(error, t("patientMerge.toast.deleteFailedMessage")) });
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
      pushToast({ type: "success", title: t("patientMerge.toast.groupMerged"), message: t("patientMerge.toast.groupMergedMessage", { count: mergedCount || manualSources.length || 0 }) });
      await invalidateDuplicates();
    },
    onError: (error) => {
      if (isReAuthError(error)) onReAuthRequired(REAUTH_QUERY_KEY);
      else pushToast({ type: "error", title: t("patientMerge.toast.mergeFailed"), message: errorMessage(error, t("patientMerge.toast.mergeFailedMessage")) });
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
        <p className="font-semibold">{t("patientMerge.reauthRequired")}</p>
        <Button type="button" className="mt-3" size="sm" onClick={() => onReAuthRequired(REAUTH_QUERY_KEY)}>
          {t("common.reAuthenticate")}
        </Button>
      </div>
    );
  }

  if (candidatesQuery.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> {t("patientMerge.loadingCandidates")}</div>;
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
        {t("patientMerge.typeToConfirm", { action: actionLabel })}{" "}
        {selectedAction.type === "merge"
          ? t("patientMerge.confirmMerge", { source: selectedAction.sourceId, target: selectedAction.targetId })
          : selectedAction.type === "mergeGroup"
            ? t("patientMerge.confirmMergeGroup", { count: selectedAction.sourceIds.length, target: selectedAction.targetId })
            : t("patientMerge.confirmDelete", { patient: selectedAction.patientId })}.
      </p>
      {selectedMergeHasConflicts ? (
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={conflictsAcknowledged} onChange={(event) => setConflictsAcknowledged(event.target.checked)} className="mt-1" />
          <span>{t("patientMerge.conflictAcknowledgement")}</span>
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
          {t("patientMerge.confirm")}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{t("patientMerge.fuzzyMatchesSummary", { threshold: candidatesQuery.data?.threshold || 75, mode: candidatesQuery.data?.mode || "balanced" })}</p>
          <p className="text-sm font-semibold text-foreground">{t("patientMerge.candidatePairsFound", { count: candidatesQuery.data?.candidateCount ?? candidates.length })}</p>
        </div>
        <div className="relative w-full lg:max-w-sm">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} className="input-premium h-10 w-full pl-9" placeholder={t("patientMerge.filterCandidateQueue")} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.matchThreshold", { threshold: candidateFilters.threshold || 75 })}</span>
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
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.mode")}</span>
            <select value={candidateFilters.mode || "balanced"} onChange={(event) => setCandidateFilters((current) => ({ ...current, mode: event.target.value as PatientDuplicateCandidateFilters["mode"] }))} className="input-premium h-9 w-full text-sm">
              <option value="strict">{t("patientMerge.mode.strict")}</option>
              <option value="balanced">{t("patientMerge.mode.balanced")}</option>
              <option value="broad">{t("patientMerge.mode.broad")}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.sort")}</span>
            <select value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as CandidateSort)} className="input-premium h-9 w-full text-sm">
              <option value="confidence">{t("patientMerge.sort.confidence")}</option>
              <option value="newest">{t("patientMerge.sort.newest")}</option>
              <option value="risk">{t("patientMerge.sort.risk")}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.field.category")}</span>
            <select value={candidateFilters.category || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, category: event.target.value as PatientDuplicateCandidateFilters["category"] }))} className="input-premium h-9 w-full text-sm">
              <option value="">{t("patientMerge.any")}</option>
              <option value="oncology">{t("patientMerge.category.oncology")}</option>
              <option value="non_oncology">{t("patientMerge.category.nonOncology")}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.field.sex")}</span>
            <select value={candidateFilters.sex || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, sex: event.target.value }))} className="input-premium h-9 w-full text-sm">
              <option value="">{t("patientMerge.any")}</option>
              <option value="m">M</option>
              <option value="f">F</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.field.identifier")}</span>
            <select value={candidateFilters.hasIdentifier || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, hasIdentifier: event.target.value as PatientDuplicateCandidateFilters["hasIdentifier"] }))} className="input-premium h-9 w-full text-sm">
              <option value="">{t("patientMerge.any")}</option>
              <option value="true">{t("patientMerge.present")}</option>
              <option value="false">{t("patientMerge.missing")}</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t("patientMerge.field.phone")}</span>
            <select value={candidateFilters.hasPhone || ""} onChange={(event) => setCandidateFilters((current) => ({ ...current, hasPhone: event.target.value as PatientDuplicateCandidateFilters["hasPhone"] }))} className="input-premium h-9 w-full text-sm">
              <option value="">{t("patientMerge.any")}</option>
              <option value="true">{t("patientMerge.present")}</option>
              <option value="false">{t("patientMerge.missing")}</option>
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
            {t("patientMerge.dobOrAgeMatch")}
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={() => { setAppliedCandidateFilters(candidateFilters); setSelectedPair(null); setSelectedAction(null); setConfirmationText(""); setConflictsAcknowledged(false); }} disabled={candidatesQuery.isFetching}>
            {candidatesQuery.isFetching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            {t("patientMerge.refreshCandidates")}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Users size={18} className="text-accent" />
              <p className="text-base font-semibold text-foreground">{t("patientMerge.manualWorkbench")}</p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t("patientMerge.manualWorkbenchDescription")}</p>
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
            {t("patientMerge.mergeSelected")}
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
                placeholder={t("patientMerge.manualSearchPlaceholder")}
              />
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {manualQuery.trim().length < 2 ? (
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-muted-foreground">{t("patientMerge.typeTwoCharacters")}</div>
              ) : manualSearchQuery.isLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> {t("patientMerge.searching")}</div>
              ) : (manualSearchQuery.data || []).length === 0 ? (
                <div className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">{t("patientMerge.noPatientsFound")}</div>
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
                          <p className="truncate text-xs text-muted-foreground">{patient.englishFullName || t("patientMerge.noEnglishName")}</p>
                        </div>
                        {isSelected ? <CheckCircle2 size={16} className="shrink-0 text-emerald-600" /> : <UserPlus size={16} className="shrink-0 text-muted-foreground" />}
                      </div>
                      <p className="mt-2 truncate text-xs text-muted-foreground">#{patient.id} - {patient.mrn || t("patientMerge.noMrn")} - {patient.nationalId || patient.identifierValue || t("patientMerge.noId")} - {patient.phone1 || t("patientMerge.noPhone")}</p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">{t("patientMerge.selectedPatients", { count: manualSelection.length })}</p>
              <Button type="button" variant="ghost" size="sm" disabled={manualSelection.length === 0} onClick={() => { setManualSelection([]); setManualTargetId(null); setMergeDraft(EMPTY_MERGE_DRAFT); setFieldSources({}); }}>
                {t("patientMerge.clear")}
              </Button>
            </div>
            {manualSelection.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">{t("patientMerge.noManualSet")}</div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {manualSelection.map((patient) => {
                  const isTarget = patient.id === manualTargetId;
                  return (
                    <div key={patient.id} className={`rounded-lg border p-3 ${isTarget ? "border-accent bg-accent/10" : "border-border bg-background"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{patient.arabicFullName}</p>
                          <p className="truncate text-xs text-muted-foreground">#{patient.id} - {patient.mrn || t("patientMerge.noMrn")}</p>
                        </div>
                        <button type="button" className="text-muted-foreground hover:text-red-600" onClick={() => removeManualPatient(patient.id)} aria-label={t("patientMerge.removePatient")}>
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
                          {t("patientMerge.keepThisRecord")}
                        </label>
                        {isTarget ? <Badge variant="accent">{t("patientMerge.survivor")}</Badge> : <Badge variant="warning">{t("patientMerge.source")}</Badge>}
                      </div>
                      <div className="mt-3 space-y-1 border-t border-border pt-3">
                        {MERGE_FIELDS.map((field) => {
                          const value = fieldValue(patient, field.key) || "-";
                          const selected = fieldSources[field.key] === patient.id;
                          return (
                            <div key={field.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-2 text-xs">
                              <span className="text-muted-foreground">{t(field.labelKey)}</span>
                              <span className="truncate font-medium text-foreground" title={value}>{value}</span>
                              <button
                                type="button"
                                className={`rounded border px-2 py-1 font-semibold ${selected ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-background text-muted-foreground hover:bg-muted"}`}
                                onClick={() => usePatientField(patient, field.key)}
                              >
                                {selected ? t("patientMerge.using") : t("patientMerge.use")}
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
                    <p className="text-sm font-semibold text-foreground">{t("patientMerge.finalSurvivorDetails")}</p>
                    <p className="text-xs text-muted-foreground">{t("patientMerge.finalSurvivorDescription")}</p>
                  </div>
                  {manualTarget ? <Badge variant="accent">{t("patientMerge.savingTo", { id: manualTarget.id })}</Badge> : null}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {MERGE_FIELDS.map((field) => {
                    const source = fieldSources[field.key];
                    const sourceLabel = source === "manual" ? t("patientMerge.manualEdit") : source ? t("patientMerge.fromPatient", { id: source }) : t("patientMerge.unset");
                    return (
                      <label key={field.key} className="space-y-1">
                        <span className="flex items-center justify-between gap-2 text-xs font-semibold text-muted-foreground">
                          {t(field.labelKey)}
                          <span className="font-normal">{sourceLabel}</span>
                        </span>
                        {field.key === "identifierType" ? (
                          <select value={mergeDraft.identifierType} onChange={(event) => editDraftField(field.key, event.target.value)} className="input-premium h-10 w-full text-sm">
                            <option value="national_id">{t("patientMerge.identifier.nationalId")}</option>
                            <option value="passport">{t("patientMerge.identifier.passport")}</option>
                            <option value="other">{t("patientMerge.identifier.other")}</option>
                          </select>
                        ) : field.key === "category" ? (
                          <select value={mergeDraft.category} onChange={(event) => editDraftField(field.key, event.target.value)} className="input-premium h-10 w-full text-sm">
                            <option value="">{t("patientMerge.unset")}</option>
                            <option value="oncology">{t("patientMerge.category.oncology")}</option>
                            <option value="non_oncology">{t("patientMerge.category.nonOncology")}</option>
                          </select>
                        ) : field.key === "sex" ? (
                          <select value={mergeDraft.sex} onChange={(event) => editDraftField(field.key, event.target.value)} className="input-premium h-10 w-full text-sm">
                            <option value="">{t("patientMerge.unset")}</option>
                            <option value="M">M</option>
                            <option value="F">F</option>
                            <option value="male">{t("patientMerge.sex.male")}</option>
                            <option value="female">{t("patientMerge.sex.female")}</option>
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
        <div className="rounded-lg border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">{t("patientMerge.noCandidates")}</div>
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
              <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> {t("patientMerge.loadingComparison")}</div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold">{t("patientMerge.duplicateConfidence", { score: activeCandidate.score })}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {activeCandidate.reasons.map((reason) => <Badge key={reason} variant="neutral">{formatReason(reason)}</Badge>)}
                    </div>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => dismissMutation.mutate()} disabled={dismissMutation.isPending}>
                    <XCircle size={16} />
                    {t("common.dismiss")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addCandidateToManualSet(activeCandidate)}>
                    <UserPlus size={16} />
                    {t("patientMerge.addBothToMergeSet")}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => addLikelyDuplicatesForPatient(activeCandidate.patientA.id)}>
                    <Users size={16} />
                    {t("patientMerge.addLikelySet")}
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
                        <UserRoundCheck size={15} /> {t("patientMerge.open")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedAction({ type: "merge", targetId: activeCandidate.patientB.id, sourceId: activeCandidate.patientA.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <GitMerge size={15} /> {t("patientMerge.mergeIntoB")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!activeCandidate.canSafeDeleteA} onClick={() => { setSelectedAction({ type: "delete", patientId: activeCandidate.patientA.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <Trash2 size={15} /> {t("patientMerge.safeDelete")}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <PatientMiniCard patient={activeCandidate.patientB} />
                    <BlockerSummary blockers={activeCandidate.blockersB} />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => window.location.assign(`/patients/${activeCandidate.patientB.id}/edit`)}>
                        <UserRoundCheck size={15} /> {t("patientMerge.open")}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => { setSelectedAction({ type: "merge", targetId: activeCandidate.patientA.id, sourceId: activeCandidate.patientB.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <GitMerge size={15} /> {t("patientMerge.mergeIntoA")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!activeCandidate.canSafeDeleteB} onClick={() => { setSelectedAction({ type: "delete", patientId: activeCandidate.patientB.id }); setConfirmationText(""); setConflictsAcknowledged(false); }}>
                        <Trash2 size={15} /> {t("patientMerge.safeDelete")}
                      </Button>
                    </div>
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="text-sm font-medium text-muted-foreground">{t("patientMerge.dismissReason")}</span>
                  <input value={dismissReason} onChange={(event) => setDismissReason(event.target.value)} className="input-premium h-10 w-full" placeholder={t("patientMerge.dismissReasonPlaceholder")} />
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
