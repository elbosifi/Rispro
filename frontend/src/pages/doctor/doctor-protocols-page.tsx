import { Children, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateProtocolLibraryVersion,
  cancelDoctorProtocolAssignment,
  createDoctorProtocolAssignment,
  createProtocolLibraryAnatomyRegion,
  createProtocolLibraryCtPhasePreset,
  createProtocolLibraryCtPhaseRow,
  createProtocolLibraryDraftFromActive,
  createProtocolLibraryMriSequencePreset,
  createProtocolLibraryMriSequenceRow,
  createProtocolLibraryProtocol,
  createProtocolLibraryScanner,
  deleteProtocolLibraryCtPhaseRow,
  deleteProtocolLibraryMriSequenceRow,
  fetchDoctorProtocolingAppointmentDetail,
  fetchDoctorProtocolingAppointments,
  fetchProtocolLibraryAnatomyRegions,
  fetchProtocolLibraryCtPhasePresets,
  fetchProtocolLibraryMriSequencePresets,
  fetchProtocolLibraryVersionDetail,
  fetchProtocolLibraryProtocols,
  fetchProtocolLibraryScanners,
  reorderProtocolLibraryCtPhaseRows,
  reorderProtocolLibraryMriSequenceRows,
  updateProtocolLibraryCtPhaseRow,
  updateProtocolLibraryAnatomyRegion,
  updateProtocolLibraryCtPhasePreset,
  updateProtocolLibraryMriSequenceRow,
  updateProtocolLibraryMriSequencePreset,
  updateProtocolLibraryProtocol,
  updateProtocolLibraryScanner,
  updateProtocolLibraryVersion,
  updateDoctorProtocolAssignment,
  type CtPhasePresetPayload,
  type ImagingScannerPayload,
  type MriSequencePresetPayload,
  type ProtocolLibraryCtPhaseRowPayload,
  type ProtocolLibraryMriSequenceRowPayload,
  type ProtocolLibraryProtocolPayload,
  type ProtocolAnatomyRegionPayload,
} from "@/lib/api-hooks";
import type { CtPhasePreset, DoctorMe, DoctorProtocolingAppointment, DoctorProtocolingAppointmentDetail, ImagingScanner, MriSequencePreset, ProtocolAnatomyRegion, ProtocolAssignmentPayload, ProtocolLibraryCtPhaseRow, ProtocolLibraryMriSequenceRow, ProtocolLibraryProtocol, ProtocolLibraryVersionDetail } from "@/types/api";
import { pushToast } from "@/lib/toast";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function protocolingPatientName(appointment: DoctorProtocolingAppointment): string {
  return appointment.patientEnglishName || appointment.patientArabicName || appointment.patientMrn || `Patient ${appointment.patientId}`;
}

type LibrarySection = "protocols" | "anatomy" | "scanners" | "ctPhases" | "mriSequences";

function SectionButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-semibold"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        backgroundColor: active ? "color-mix(in srgb, var(--accent) 10%, var(--card))" : "var(--card)",
        color: active ? "var(--accent)" : "var(--foreground)",
      }}
    >
      {label}
    </button>
  );
}

const EMPTY_REGION: ProtocolAnatomyRegionPayload = { name: "", bodySystem: null, modalityScope: "BOTH", defaultCoverageNote: null, isActive: true };
const EMPTY_SCANNER: ImagingScannerPayload = { name: "", modality: "MRI", vendor: null, model: null, fieldStrength: null, location: null, notes: null, isActive: true };
const EMPTY_CT_PHASE: CtPhasePresetPayload = {
  name: "",
  contrastStatus: "NON_CONTRAST",
  timingType: "NONE",
  delaySeconds: null,
  bolusTrackingSite: null,
  triggerHu: null,
  defaultCoverage: null,
  reconstructionNotes: null,
  instructions: null,
  isActive: true,
};
const EMPTY_MRI_SEQUENCE: MriSequencePresetPayload = {
  scannerId: null,
  vendor: null,
  name: "",
  vendorSequenceName: null,
  genericFamily: null,
  weighting: null,
  defaultPlane: null,
  contrastRelation: null,
  defaultCoverage: null,
  defaultBValues: null,
  defaultDynamicTiming: null,
  estimatedScanTimeMinutes: null,
  notes: null,
  isActive: true,
};
const EMPTY_PROTOCOL: ProtocolLibraryProtocolPayload = {
  name: "",
  modality: "CT",
  anatomyRegionId: null,
  category: null,
  indication: null,
  contrastPolicy: null,
  changeSummary: "Initial protocol version",
};
const EMPTY_PROTOCOL_CT_PHASE: ProtocolLibraryCtPhaseRowPayload = {
  ctPhasePresetId: null,
  customPhaseName: null,
  timingOverride: null,
  coverageOverride: null,
  reconstructionOverride: null,
  instructionsOverride: null,
  isRequired: true,
};
const EMPTY_PROTOCOL_MRI_SEQUENCE: ProtocolLibraryMriSequenceRowPayload = {
  scannerId: null,
  mriSequencePresetId: null,
  planeOverride: null,
  coverageOverride: null,
  bValuesOverride: null,
  timingOverride: null,
  notesOverride: null,
  isRequired: true,
};

function textValue(value: string | null): string {
  return value ?? "";
}

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberText(value: number | null): string {
  return value == null ? "" : String(value);
}

function nullableNumber(value: string, positive = false): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return positive ? (parsed > 0 ? parsed : null) : (parsed >= 0 ? parsed : null);
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{ borderColor: "var(--border)", color: active ? "#047857" : "var(--text-muted)" }}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ProtocolStatusBadge({ assigned }: { assigned: boolean }) {
  return (
    <span
      className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{
        borderColor: assigned ? "#a7f3d0" : "var(--border)",
        backgroundColor: assigned ? "#ecfdf5" : "var(--card)",
        color: assigned ? "#047857" : "var(--text-muted)",
      }}
    >
      {assigned ? "Protocol assigned" : "Not protocolled"}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function inputClass() {
  return "mt-1 w-full rounded-lg border px-3 py-2 text-sm";
}

function ProtocolLibraryPanel() {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<LibrarySection>("protocols");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [regionDraft, setRegionDraft] = useState<ProtocolAnatomyRegionPayload | null>(null);
  const [editingRegionId, setEditingRegionId] = useState<number | null>(null);
  const [scannerDraft, setScannerDraft] = useState<ImagingScannerPayload | null>(null);
  const [editingScannerId, setEditingScannerId] = useState<number | null>(null);
  const [ctPhaseDraft, setCtPhaseDraft] = useState<CtPhasePresetPayload | null>(null);
  const [editingCtPhaseId, setEditingCtPhaseId] = useState<number | null>(null);
  const [mriSequenceDraft, setMriSequenceDraft] = useState<MriSequencePresetPayload | null>(null);
  const [editingMriSequenceId, setEditingMriSequenceId] = useState<number | null>(null);
  const [protocolDraft, setProtocolDraft] = useState<ProtocolLibraryProtocolPayload | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<number | null>(null);
  const [protocolFilter, setProtocolFilter] = useState<"all" | "CT" | "MRI" | "active" | "draft">("all");
  const [protocolSearch, setProtocolSearch] = useState("");
  const [ctRowDraft, setCtRowDraft] = useState<ProtocolLibraryCtPhaseRowPayload | null>(null);
  const [editingCtRowId, setEditingCtRowId] = useState<number | null>(null);
  const [mriRowDraft, setMriRowDraft] = useState<ProtocolLibraryMriSequenceRowPayload | null>(null);
  const [editingMriRowId, setEditingMriRowId] = useState<number | null>(null);

  const protocolsQuery = useQuery({ queryKey: ["doctor", "protocol-library", "protocols"], queryFn: fetchProtocolLibraryProtocols, enabled: section === "protocols" });
  const anatomyQuery = useQuery({ queryKey: ["doctor", "protocol-library", "anatomy-regions"], queryFn: fetchProtocolLibraryAnatomyRegions, enabled: section === "anatomy" || section === "protocols" });
  const scannersQuery = useQuery({ queryKey: ["doctor", "protocol-library", "scanners"], queryFn: fetchProtocolLibraryScanners, enabled: section === "scanners" || section === "mriSequences" || selectedVersionId !== null });
  const ctPhasesQuery = useQuery({ queryKey: ["doctor", "protocol-library", "ct-phase-presets"], queryFn: fetchProtocolLibraryCtPhasePresets, enabled: section === "ctPhases" || selectedVersionId !== null });
  const mriSequencesQuery = useQuery({ queryKey: ["doctor", "protocol-library", "mri-sequence-presets"], queryFn: fetchProtocolLibraryMriSequencePresets, enabled: section === "mriSequences" || selectedVersionId !== null });
  const versionQuery = useQuery({ queryKey: ["doctor", "protocol-library", "protocol-version", selectedVersionId], queryFn: () => fetchProtocolLibraryVersionDetail(selectedVersionId!), enabled: section === "protocols" && selectedVersionId !== null });

  const protocols = protocolsQuery.data ?? [];
  const anatomy = anatomyQuery.data ?? [];
  const scanners = scannersQuery.data ?? [];
  const ctPhases = ctPhasesQuery.data ?? [];
  const mriSequences = mriSequencesQuery.data ?? [];
  const selectedVersion = versionQuery.data ?? null;
  const filteredProtocols = protocols.filter((protocol) => {
    const matchesFilter =
      protocolFilter === "all" ||
      protocol.modality === protocolFilter ||
      (protocolFilter === "active" && protocol.activeVersionId !== null) ||
      (protocolFilter === "draft" && protocol.latestDraftVersionId !== null);
    const term = protocolSearch.trim().toLowerCase();
    return matchesFilter && (!term || protocol.name.toLowerCase().includes(term));
  });

  const invalidate = async (key: string) => queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", key] });
  const onMutationError = (error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to save protocol setting." });
  const onMutationSuccess = async (key: string, text: string) => {
    setMessage({ tone: "success", text });
    await invalidate(key);
  };

  const createRegionMutation = useMutation({ mutationFn: createProtocolLibraryAnatomyRegion, onError: onMutationError, onSuccess: async () => { setRegionDraft(null); setEditingRegionId(null); await onMutationSuccess("anatomy-regions", "Region saved."); } });
  const updateRegionMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<ProtocolAnatomyRegionPayload> }) => updateProtocolLibraryAnatomyRegion(id, payload), onError: onMutationError, onSuccess: async () => { setRegionDraft(null); setEditingRegionId(null); await onMutationSuccess("anatomy-regions", "Region saved."); } });
  const createScannerMutation = useMutation({ mutationFn: createProtocolLibraryScanner, onError: onMutationError, onSuccess: async () => { setScannerDraft(null); setEditingScannerId(null); await onMutationSuccess("scanners", "Scanner saved."); } });
  const updateScannerMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<ImagingScannerPayload> }) => updateProtocolLibraryScanner(id, payload), onError: onMutationError, onSuccess: async () => { setScannerDraft(null); setEditingScannerId(null); await onMutationSuccess("scanners", "Scanner saved."); } });
  const createCtPhaseMutation = useMutation({ mutationFn: createProtocolLibraryCtPhasePreset, onError: onMutationError, onSuccess: async () => { setCtPhaseDraft(null); setEditingCtPhaseId(null); await onMutationSuccess("ct-phase-presets", "CT phase saved."); } });
  const updateCtPhaseMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<CtPhasePresetPayload> }) => updateProtocolLibraryCtPhasePreset(id, payload), onError: onMutationError, onSuccess: async () => { setCtPhaseDraft(null); setEditingCtPhaseId(null); await onMutationSuccess("ct-phase-presets", "CT phase saved."); } });
  const createMriSequenceMutation = useMutation({ mutationFn: createProtocolLibraryMriSequencePreset, onError: onMutationError, onSuccess: async () => { setMriSequenceDraft(null); setEditingMriSequenceId(null); await onMutationSuccess("mri-sequence-presets", "MRI sequence saved."); } });
  const updateMriSequenceMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Partial<MriSequencePresetPayload> }) => updateProtocolLibraryMriSequencePreset(id, payload), onError: onMutationError, onSuccess: async () => { setMriSequenceDraft(null); setEditingMriSequenceId(null); await onMutationSuccess("mri-sequence-presets", "MRI sequence saved."); } });
  const refreshBuilder = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocols"] });
    if (selectedVersionId) await queryClient.invalidateQueries({ queryKey: ["doctor", "protocol-library", "protocol-version", selectedVersionId] });
  };
  const createProtocolMutation = useMutation({
    mutationFn: createProtocolLibraryProtocol,
    onError: onMutationError,
    onSuccess: async (created) => {
      setProtocolDraft(null);
      setSelectedVersionId(created.version.id);
      setMessage({ tone: "success", text: "Protocol draft created." });
      await refreshBuilder();
    },
  });
  const updateProtocolMutation = useMutation({ mutationFn: ({ id, payload }: { id: number; payload: Parameters<typeof updateProtocolLibraryProtocol>[1] }) => updateProtocolLibraryProtocol(id, payload), onError: onMutationError, onSuccess: refreshBuilder });
  const updateVersionMutation = useMutation({ mutationFn: ({ versionId, changeSummary }: { versionId: number; changeSummary: string | null }) => updateProtocolLibraryVersion(versionId, { changeSummary }), onError: onMutationError, onSuccess: async () => { setMessage({ tone: "success", text: "Draft saved." }); await refreshBuilder(); } });
  const activateVersionMutation = useMutation({ mutationFn: activateProtocolLibraryVersion, onError: onMutationError, onSuccess: async () => { setMessage({ tone: "success", text: "Protocol version activated." }); await refreshBuilder(); } });
  const draftFromActiveMutation = useMutation({ mutationFn: createProtocolLibraryDraftFromActive, onError: onMutationError, onSuccess: async (detail) => { setSelectedVersionId(detail.version.id); setMessage({ tone: "success", text: "Draft version created." }); await refreshBuilder(); } });
  const createCtRowMutation = useMutation({ mutationFn: ({ versionId, payload }: { versionId: number; payload: ProtocolLibraryCtPhaseRowPayload }) => createProtocolLibraryCtPhaseRow(versionId, payload), onError: onMutationError, onSuccess: async () => { setCtRowDraft(null); setEditingCtRowId(null); await refreshBuilder(); } });
  const updateCtRowMutation = useMutation({ mutationFn: ({ versionId, rowId, payload }: { versionId: number; rowId: number; payload: Partial<ProtocolLibraryCtPhaseRowPayload> }) => updateProtocolLibraryCtPhaseRow(versionId, rowId, payload), onError: onMutationError, onSuccess: async () => { setCtRowDraft(null); setEditingCtRowId(null); await refreshBuilder(); } });
  const deleteCtRowMutation = useMutation({ mutationFn: ({ versionId, rowId }: { versionId: number; rowId: number }) => deleteProtocolLibraryCtPhaseRow(versionId, rowId), onError: onMutationError, onSuccess: refreshBuilder });
  const reorderCtRowsMutation = useMutation({ mutationFn: ({ versionId, rowIds }: { versionId: number; rowIds: number[] }) => reorderProtocolLibraryCtPhaseRows(versionId, rowIds), onError: onMutationError, onSuccess: refreshBuilder });
  const createMriRowMutation = useMutation({ mutationFn: ({ versionId, payload }: { versionId: number; payload: ProtocolLibraryMriSequenceRowPayload }) => createProtocolLibraryMriSequenceRow(versionId, payload), onError: onMutationError, onSuccess: async () => { setMriRowDraft(null); setEditingMriRowId(null); await refreshBuilder(); } });
  const updateMriRowMutation = useMutation({ mutationFn: ({ versionId, rowId, payload }: { versionId: number; rowId: number; payload: Partial<ProtocolLibraryMriSequenceRowPayload> }) => updateProtocolLibraryMriSequenceRow(versionId, rowId, payload), onError: onMutationError, onSuccess: async () => { setMriRowDraft(null); setEditingMriRowId(null); await refreshBuilder(); } });
  const deleteMriRowMutation = useMutation({ mutationFn: ({ versionId, rowId }: { versionId: number; rowId: number }) => deleteProtocolLibraryMriSequenceRow(versionId, rowId), onError: onMutationError, onSuccess: refreshBuilder });
  const reorderMriRowsMutation = useMutation({ mutationFn: ({ versionId, rowIds }: { versionId: number; rowIds: number[] }) => reorderProtocolLibraryMriSequenceRows(versionId, rowIds), onError: onMutationError, onSuccess: refreshBuilder });

  const startRegionEdit = (item: ProtocolAnatomyRegion) => { setEditingRegionId(item.id); setRegionDraft({ name: item.name, bodySystem: item.bodySystem, modalityScope: item.modalityScope, defaultCoverageNote: item.defaultCoverageNote, isActive: item.isActive }); };
  const startScannerEdit = (item: ImagingScanner) => { setEditingScannerId(item.id); setScannerDraft({ name: item.name, modality: item.modality, vendor: item.vendor, model: item.model, fieldStrength: item.fieldStrength, location: item.location, notes: item.notes, isActive: item.isActive }); };
  const startCtPhaseEdit = (item: CtPhasePreset) => { setEditingCtPhaseId(item.id); setCtPhaseDraft({ name: item.name, contrastStatus: item.contrastStatus, timingType: item.timingType, delaySeconds: item.delaySeconds, bolusTrackingSite: item.bolusTrackingSite, triggerHu: item.triggerHu, defaultCoverage: item.defaultCoverage, reconstructionNotes: item.reconstructionNotes, instructions: item.instructions, isActive: item.isActive }); };
  const startMriSequenceEdit = (item: MriSequencePreset) => { setEditingMriSequenceId(item.id); setMriSequenceDraft({ scannerId: item.scannerId, vendor: item.vendor, name: item.name, vendorSequenceName: item.vendorSequenceName, genericFamily: item.genericFamily, weighting: item.weighting, defaultPlane: item.defaultPlane, contrastRelation: item.contrastRelation, defaultCoverage: item.defaultCoverage, defaultBValues: item.defaultBValues, defaultDynamicTiming: item.defaultDynamicTiming, estimatedScanTimeMinutes: item.estimatedScanTimeMinutes, notes: item.notes, isActive: item.isActive }); };
  const startCtRowEdit = (item: ProtocolLibraryCtPhaseRow) => { setEditingCtRowId(item.id); setCtRowDraft({ ctPhasePresetId: item.ctPhasePresetId, customPhaseName: item.customPhaseName, timingOverride: item.timingOverride, coverageOverride: item.coverageOverride, reconstructionOverride: item.reconstructionOverride, instructionsOverride: item.instructionsOverride, isRequired: item.isRequired }); };
  const startMriRowEdit = (item: ProtocolLibraryMriSequenceRow) => { setEditingMriRowId(item.id); setMriRowDraft({ scannerId: item.scannerId, mriSequencePresetId: item.mriSequencePresetId, planeOverride: item.planeOverride, coverageOverride: item.coverageOverride, bValuesOverride: item.bValuesOverride, timingOverride: item.timingOverride, notesOverride: item.notesOverride, isRequired: item.isRequired }); };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Protocols</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Protocol Library</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>
            Reusable CT/MRI protocol settings for anatomy regions, scanners, CT phases, and MRI sequences.
          </p>
        </div>
        {section === "protocols" && !selectedVersion && <AddButton label="Add protocol" onClick={() => setProtocolDraft(EMPTY_PROTOCOL)} />}
        {section === "anatomy" && <AddButton label="Add region" onClick={() => { setEditingRegionId(null); setRegionDraft(EMPTY_REGION); }} />}
        {section === "scanners" && <AddButton label="Add scanner" onClick={() => { setEditingScannerId(null); setScannerDraft(EMPTY_SCANNER); }} />}
        {section === "ctPhases" && <AddButton label="Add CT phase" onClick={() => { setEditingCtPhaseId(null); setCtPhaseDraft(EMPTY_CT_PHASE); }} />}
        {section === "mriSequences" && <AddButton label="Add MRI sequence" onClick={() => { setEditingMriSequenceId(null); setMriSequenceDraft(EMPTY_MRI_SEQUENCE); }} />}
      </div>

      {message && (
        <p className={`rounded-lg border px-3 py-2 text-sm ${message.tone === "error" ? "text-red-700" : "text-emerald-700"}`} style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
          {message.text}
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto">
        <SectionButton label="Protocol List" active={section === "protocols"} onClick={() => setSection("protocols")} />
        <SectionButton label="Anatomy / Regions" active={section === "anatomy"} onClick={() => setSection("anatomy")} />
        <SectionButton label="Scanners" active={section === "scanners"} onClick={() => setSection("scanners")} />
        <SectionButton label="CT Phase Presets" active={section === "ctPhases"} onClick={() => setSection("ctPhases")} />
        <SectionButton label="MRI Sequence Presets" active={section === "mriSequences"} onClick={() => setSection("mriSequences")} />
      </div>

      {section === "protocols" && selectedVersion && (
        <ProtocolBuilder
          key={selectedVersion.version.id}
          detail={selectedVersion}
          anatomy={anatomy}
          scanners={scanners}
          ctPhasePresets={ctPhases}
          mriSequencePresets={mriSequences}
          ctRowDraft={ctRowDraft}
          mriRowDraft={mriRowDraft}
          editingCtRowId={editingCtRowId}
          editingMriRowId={editingMriRowId}
          saving={updateVersionMutation.isPending || activateVersionMutation.isPending}
          setCtRowDraft={setCtRowDraft}
          setMriRowDraft={setMriRowDraft}
          onBack={() => { setSelectedVersionId(null); setCtRowDraft(null); setMriRowDraft(null); setEditingCtRowId(null); setEditingMriRowId(null); }}
          onSaveDraft={(changeSummary) => updateVersionMutation.mutate({ versionId: selectedVersion.version.id, changeSummary })}
          onActivate={() => activateVersionMutation.mutate(selectedVersion.version.id)}
          onDraftFromActive={() => draftFromActiveMutation.mutate(selectedVersion.protocol.id)}
          onAddCtRow={() => setCtRowDraft(EMPTY_PROTOCOL_CT_PHASE)}
          onEditCtRow={startCtRowEdit}
          onCancelCtRow={() => { setCtRowDraft(null); setEditingCtRowId(null); }}
          onSaveCtRow={(payload) => editingCtRowId ? updateCtRowMutation.mutate({ versionId: selectedVersion.version.id, rowId: editingCtRowId, payload }) : createCtRowMutation.mutate({ versionId: selectedVersion.version.id, payload })}
          onRemoveCtRow={(rowId) => deleteCtRowMutation.mutate({ versionId: selectedVersion.version.id, rowId })}
          onReorderCtRows={(rowIds) => reorderCtRowsMutation.mutate({ versionId: selectedVersion.version.id, rowIds })}
          onAddMriRow={() => setMriRowDraft(EMPTY_PROTOCOL_MRI_SEQUENCE)}
          onEditMriRow={startMriRowEdit}
          onCancelMriRow={() => { setMriRowDraft(null); setEditingMriRowId(null); }}
          onSaveMriRow={(payload) => editingMriRowId ? updateMriRowMutation.mutate({ versionId: selectedVersion.version.id, rowId: editingMriRowId, payload }) : createMriRowMutation.mutate({ versionId: selectedVersion.version.id, payload })}
          onRemoveMriRow={(rowId) => deleteMriRowMutation.mutate({ versionId: selectedVersion.version.id, rowId })}
          onReorderMriRows={(rowIds) => reorderMriRowsMutation.mutate({ versionId: selectedVersion.version.id, rowIds })}
        />
      )}
      {section === "protocols" && !selectedVersion && (
        <ProtocolList
          rows={filteredProtocols}
          filter={protocolFilter}
          search={protocolSearch}
          draft={protocolDraft}
          anatomy={anatomy}
          saving={createProtocolMutation.isPending}
          setFilter={setProtocolFilter}
          setSearch={setProtocolSearch}
          setDraft={setProtocolDraft}
          onCreate={() => protocolDraft && createProtocolMutation.mutate(protocolDraft)}
          onOpen={(protocol) => {
            const versionId = protocol.latestDraftVersionId ?? protocol.activeVersionId;
            if (versionId) setSelectedVersionId(versionId);
          }}
          onToggle={(protocol) => updateProtocolMutation.mutate({ id: protocol.id, payload: { isActive: !protocol.isActive } })}
        />
      )}
      {section === "anatomy" && (
        <SettingsTable emptyText="No anatomy regions yet" headers={["Name", "Scope", "Body system", "Coverage", "Status", "Actions"]}>
          {regionDraft && <RegionForm draft={regionDraft} setDraft={setRegionDraft} saving={createRegionMutation.isPending || updateRegionMutation.isPending} onCancel={() => { setRegionDraft(null); setEditingRegionId(null); }} onSave={() => editingRegionId ? updateRegionMutation.mutate({ id: editingRegionId, payload: regionDraft }) : createRegionMutation.mutate(regionDraft)} />}
          {anatomy.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.modalityScope}</Cell><Cell>{item.bodySystem ?? "-"}</Cell><Cell>{item.defaultCoverageNote ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startRegionEdit(item)} onToggle={() => updateRegionMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "scanners" && (
        <SettingsTable emptyText="No scanners yet" headers={["Name", "Modality", "Vendor", "Details", "Status", "Actions"]}>
          {scannerDraft && <ScannerForm draft={scannerDraft} setDraft={setScannerDraft} saving={createScannerMutation.isPending || updateScannerMutation.isPending} onCancel={() => { setScannerDraft(null); setEditingScannerId(null); }} onSave={() => editingScannerId ? updateScannerMutation.mutate({ id: editingScannerId, payload: scannerDraft }) : createScannerMutation.mutate(scannerDraft)} />}
          {scanners.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.modality}</Cell><Cell>{item.vendor ?? "-"}</Cell><Cell>{item.modality === "MRI" && item.fieldStrength ? item.fieldStrength : item.model ?? item.location ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startScannerEdit(item)} onToggle={() => updateScannerMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "ctPhases" && (
        <SettingsTable emptyText="No CT phase presets yet" headers={["Name", "Contrast", "Timing", "Delay", "Coverage", "Status", "Actions"]}>
          {ctPhaseDraft && <CtPhaseForm draft={ctPhaseDraft} setDraft={setCtPhaseDraft} saving={createCtPhaseMutation.isPending || updateCtPhaseMutation.isPending} onCancel={() => { setCtPhaseDraft(null); setEditingCtPhaseId(null); }} onSave={() => editingCtPhaseId ? updateCtPhaseMutation.mutate({ id: editingCtPhaseId, payload: ctPhaseDraft }) : createCtPhaseMutation.mutate(ctPhaseDraft)} />}
          {ctPhases.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.contrastStatus}</Cell><Cell>{item.timingType}</Cell><Cell>{item.delaySeconds ?? "-"}</Cell><Cell>{item.defaultCoverage ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startCtPhaseEdit(item)} onToggle={() => updateCtPhaseMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
      {section === "mriSequences" && (
        <SettingsTable emptyText="No MRI sequence presets yet" headers={["Name", "Scanner", "Vendor", "Family", "Time", "Status", "Actions"]}>
          {mriSequenceDraft && <MriSequenceForm draft={mriSequenceDraft} scanners={scanners} setDraft={setMriSequenceDraft} saving={createMriSequenceMutation.isPending || updateMriSequenceMutation.isPending} onCancel={() => { setMriSequenceDraft(null); setEditingMriSequenceId(null); }} onSave={() => editingMriSequenceId ? updateMriSequenceMutation.mutate({ id: editingMriSequenceId, payload: mriSequenceDraft }) : createMriSequenceMutation.mutate(mriSequenceDraft)} />}
          {mriSequences.map((item) => <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}><Cell>{item.name}</Cell><Cell>{item.scannerName ?? "Generic / not scanner-specific"}</Cell><Cell>{item.vendor ?? "-"}</Cell><Cell>{item.weighting ?? item.genericFamily ?? "-"}</Cell><Cell>{item.estimatedScanTimeMinutes ?? "-"}</Cell><Cell><StatusBadge active={item.isActive} /></Cell><Cell><RowActions onEdit={() => startMriSequenceEdit(item)} onToggle={() => updateMriSequenceMutation.mutate({ id: item.id, payload: { isActive: !item.isActive } })} active={item.isActive} /></Cell></tr>)}
        </SettingsTable>
      )}
    </section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="inline-flex h-9 items-center rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white">{label}</button>;
}

function Cell({ children }: { children: ReactNode }) {
  return <td className="px-3 py-2 align-top text-foreground">{children}</td>;
}

function RowActions({ active, onEdit, onToggle }: { active: boolean; onEdit: () => void; onToggle: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={onEdit} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>Edit</button>
      <button type="button" onClick={onToggle} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{active ? "Deactivate" : "Reactivate"}</button>
    </div>
  );
}

function SettingsTable({ headers, emptyText, children }: { headers: string[]; emptyText: string; children: ReactNode }) {
  const childArray = Children.toArray(children);
  const hasRows = childArray.length > 0;
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <table className="min-w-full text-sm">
        <thead><tr className="border-b" style={{ borderColor: "var(--border)" }}>{headers.map((header) => <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr></thead>
        <tbody>{hasRows ? childArray : <tr><td className="p-6 text-sm" colSpan={headers.length} style={{ color: "var(--text-muted)" }}>{emptyText}</td></tr>}</tbody>
      </table>
    </div>
  );
}

function ProtocolList({
  rows,
  filter,
  search,
  draft,
  anatomy,
  saving,
  setFilter,
  setSearch,
  setDraft,
  onCreate,
  onOpen,
  onToggle,
}: {
  rows: ProtocolLibraryProtocol[];
  filter: "all" | "CT" | "MRI" | "active" | "draft";
  search: string;
  draft: ProtocolLibraryProtocolPayload | null;
  anatomy: ProtocolAnatomyRegion[];
  saving: boolean;
  setFilter: (filter: "all" | "CT" | "MRI" | "active" | "draft") => void;
  setSearch: (search: string) => void;
  setDraft: (draft: ProtocolLibraryProtocolPayload | null) => void;
  onCreate: () => void;
  onOpen: (protocol: ProtocolLibraryProtocol) => void;
  onToggle: (protocol: ProtocolLibraryProtocol) => void;
}) {
  const filterLabels: Array<{ value: typeof filter; label: string }> = [
    { value: "all", label: "All" },
    { value: "CT", label: "CT" },
    { value: "MRI", label: "MRI" },
    { value: "active", label: "Active" },
    { value: "draft", label: "Draft" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filterLabels.map((item) => <SectionButton key={item.value} label={item.label} active={filter === item.value} onClick={() => setFilter(item.value)} />)}
        <input aria-label="Search protocols" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name" className="h-9 min-w-52 rounded-lg border px-3 text-sm" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }} />
      </div>
      <SettingsTable emptyText="No protocols yet" headers={["Name", "Modality", "Region", "Category", "Indication", "Contrast policy", "Active version", "Status", "Actions"]}>
        {draft && <ProtocolCreateForm draft={draft} anatomy={anatomy} saving={saving} setDraft={setDraft} onCancel={() => setDraft(null)} onSave={onCreate} />}
        {rows.length === 0 && !draft ? <tr><td className="p-6 text-sm" colSpan={9} style={{ color: "var(--text-muted)" }}><p>No protocols yet</p><p>Create CT or MRI protocols from your saved phase and sequence presets.</p></td></tr> : null}
        {rows.map((item) => (
          <tr key={item.id} className={!item.isActive ? "opacity-60" : undefined}>
            <Cell>{item.name}</Cell>
            <Cell>{item.modality}</Cell>
            <Cell>{item.anatomyRegionName ?? "-"}</Cell>
            <Cell>{item.category ?? "-"}</Cell>
            <Cell>{item.indication ?? "-"}</Cell>
            <Cell>{item.contrastPolicy ?? "-"}</Cell>
            <Cell>{item.activeVersionNumber ?? "-"}</Cell>
            <Cell>{item.activeVersionId ? "Active" : item.latestDraftVersionId ? "Draft only" : "No active version"}</Cell>
            <Cell><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onOpen(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>View/Edit</button><button type="button" onClick={() => onToggle(item)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{item.isActive ? "Deactivate" : "Reactivate"}</button></div></Cell>
          </tr>
        ))}
      </SettingsTable>
    </div>
  );
}

function ProtocolCreateForm({ draft, anatomy, saving, setDraft, onSave, onCancel }: { draft: ProtocolLibraryProtocolPayload; anatomy: ProtocolAnatomyRegion[]; saving: boolean; setDraft: (draft: ProtocolLibraryProtocolPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  const matchingAnatomy = anatomy.filter((item) => item.isActive && (item.modalityScope === "BOTH" || item.modalityScope === draft.modality));
  return (
    <tr><td colSpan={9} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Protocol name"><input aria-label="Protocol name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Protocol modality"><select aria-label="Protocol modality" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ProtocolLibraryProtocolPayload["modality"], anatomyRegionId: null })}><option value="CT">CT</option><option value="MRI">MRI</option></select></Field>
      <Field label="Anatomy / region"><select aria-label="Anatomy / region" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.anatomyRegionId ?? ""} onChange={(event) => setDraft({ ...draft, anatomyRegionId: event.target.value ? Number(event.target.value) : null })}><option value="">Not specified</option>{matchingAnatomy.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      {(["category", "indication", "contrastPolicy", "changeSummary"] as const).map((key) => <Field key={key} label={key === "contrastPolicy" ? "Contrast policy" : key === "changeSummary" ? "Change summary" : key[0].toUpperCase() + key.slice(1)}><input aria-label={key === "contrastPolicy" ? "Contrast policy" : key === "changeSummary" ? "Change summary" : key[0].toUpperCase() + key.slice(1)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft[key] ?? null)} onChange={(event) => setDraft({ ...draft, [key]: nullableText(event.target.value) })} /></Field>)}
      <FormActions saving={saving} saveLabel="Create protocol" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function VersionBadge({ status }: { status: string }) {
  return <span className="inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold" style={{ borderColor: "var(--border)", color: status === "ACTIVE" ? "#047857" : "var(--text-muted)" }}>{status}</span>;
}

function ProtocolBuilder({
  detail,
  scanners,
  ctPhasePresets,
  mriSequencePresets,
  ctRowDraft,
  mriRowDraft,
  editingCtRowId,
  editingMriRowId,
  saving,
  setCtRowDraft,
  setMriRowDraft,
  onBack,
  onSaveDraft,
  onActivate,
  onDraftFromActive,
  onAddCtRow,
  onEditCtRow,
  onCancelCtRow,
  onSaveCtRow,
  onRemoveCtRow,
  onReorderCtRows,
  onAddMriRow,
  onEditMriRow,
  onCancelMriRow,
  onSaveMriRow,
  onRemoveMriRow,
  onReorderMriRows,
}: {
  detail: ProtocolLibraryVersionDetail;
  anatomy: ProtocolAnatomyRegion[];
  scanners: ImagingScanner[];
  ctPhasePresets: CtPhasePreset[];
  mriSequencePresets: MriSequencePreset[];
  ctRowDraft: ProtocolLibraryCtPhaseRowPayload | null;
  mriRowDraft: ProtocolLibraryMriSequenceRowPayload | null;
  editingCtRowId: number | null;
  editingMriRowId: number | null;
  saving: boolean;
  setCtRowDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void;
  setMriRowDraft: (draft: ProtocolLibraryMriSequenceRowPayload | null) => void;
  onBack: () => void;
  onSaveDraft: (changeSummary: string | null) => void;
  onActivate: () => void;
  onDraftFromActive: () => void;
  onAddCtRow: () => void;
  onEditCtRow: (row: ProtocolLibraryCtPhaseRow) => void;
  onCancelCtRow: () => void;
  onSaveCtRow: (payload: ProtocolLibraryCtPhaseRowPayload) => void;
  onRemoveCtRow: (rowId: number) => void;
  onReorderCtRows: (rowIds: number[]) => void;
  onAddMriRow: () => void;
  onEditMriRow: (row: ProtocolLibraryMriSequenceRow) => void;
  onCancelMriRow: () => void;
  onSaveMriRow: (payload: ProtocolLibraryMriSequenceRowPayload) => void;
  onRemoveMriRow: (rowId: number) => void;
  onReorderMriRows: (rowIds: number[]) => void;
}) {
  const [changeSummary, setChangeSummary] = useState(detail.version.changeSummary ?? "");
  const editable = detail.version.status === "DRAFT";
  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-semibold">{detail.protocol.name}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{detail.protocol.modality} · {detail.protocol.anatomyRegionName ?? "No region"} · Version {detail.version.versionNumber} <VersionBadge status={detail.version.status} /></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onBack} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Back to list</button>
            {editable ? <button type="button" onClick={() => onSaveDraft(nullableText(changeSummary))} disabled={saving} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Save draft</button> : null}
            {editable ? <button type="button" onClick={onActivate} disabled={saving} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Activate version</button> : <button type="button" onClick={onDraftFromActive} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white">Create new draft version</button>}
          </div>
        </div>
        <Field label="Change summary"><input aria-label="Change summary" disabled={!editable} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={changeSummary} onChange={(event) => setChangeSummary(event.target.value)} /></Field>
      </section>
      {detail.protocol.modality === "CT" ? (
        <CtProtocolRows detail={detail} presets={ctPhasePresets} draft={ctRowDraft} editingRowId={editingCtRowId} editable={editable} setDraft={setCtRowDraft} onAdd={onAddCtRow} onEdit={onEditCtRow} onCancel={onCancelCtRow} onSave={onSaveCtRow} onRemove={onRemoveCtRow} onReorder={onReorderCtRows} />
      ) : (
        <MriProtocolRows detail={detail} scanners={scanners} presets={mriSequencePresets} draft={mriRowDraft} editingRowId={editingMriRowId} editable={editable} setDraft={setMriRowDraft} onAdd={onAddMriRow} onEdit={onEditMriRow} onCancel={onCancelMriRow} onSave={onSaveMriRow} onRemove={onRemoveMriRow} onReorder={onReorderMriRows} />
      )}
    </div>
  );
}

function CtProtocolRows({ detail, presets, draft, editingRowId, editable, setDraft, onAdd, onEdit, onCancel, onSave, onRemove, onReorder }: { detail: ProtocolLibraryVersionDetail; presets: CtPhasePreset[]; draft: ProtocolLibraryCtPhaseRowPayload | null; editingRowId: number | null; editable: boolean; setDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void; onAdd: () => void; onEdit: (row: ProtocolLibraryCtPhaseRow) => void; onCancel: () => void; onSave: (payload: ProtocolLibraryCtPhaseRowPayload) => void; onRemove: (rowId: number) => void; onReorder: (rowIds: number[]) => void }) {
  const activePresets = presets.filter((preset) => preset.isActive);
  const move = (index: number, direction: -1 | 1) => {
    const rows = [...detail.ctPhases];
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    onReorder(rows.map((row) => row.id));
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">CT phases</h3>
        {editable && <AddButton label="Add phase" onClick={onAdd} />}
      </div>
      <SettingsTable emptyText="No CT phases added yet" headers={["Order", "CT phase preset", "Custom phase name", "Timing override", "Coverage override", "Reconstruction override", "Instructions override", "Required", "Actions"]}>
        {draft && editable && <CtProtocolRowForm draft={draft} presets={activePresets} setDraft={setDraft} onCancel={onCancel} onSave={() => onSave(draft)} />}
        {detail.ctPhases.map((row, index) => (
          <tr key={row.id}>
            <Cell>{row.orderIndex}</Cell>
            <Cell>{row.ctPhasePresetName ?? "-"}</Cell>
            <Cell>{row.customPhaseName ?? "-"}</Cell>
            <Cell>{row.timingOverride ?? "-"}</Cell>
            <Cell>{row.coverageOverride ?? "-"}</Cell>
            <Cell>{row.reconstructionOverride ?? "-"}</Cell>
            <Cell>{row.instructionsOverride ?? "-"}</Cell>
            <Cell>{row.isRequired ? "Yes" : "No"}</Cell>
            <Cell>{editable ? <RowBuilderActions onEdit={() => onEdit(row)} onRemove={() => onRemove(row.id)} onMoveUp={() => move(index, -1)} onMoveDown={() => move(index, 1)} first={index === 0} last={index === detail.ctPhases.length - 1} editing={editingRowId === row.id} /> : "Read-only"}</Cell>
          </tr>
        ))}
      </SettingsTable>
    </section>
  );
}

function CtProtocolRowForm({ draft, presets, setDraft, onSave, onCancel }: { draft: ProtocolLibraryCtPhaseRowPayload; presets: CtPhasePreset[]; setDraft: (draft: ProtocolLibraryCtPhaseRowPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  const selectedPreset = presets.find((preset) => preset.id === draft.ctPhasePresetId) ?? null;
  return (
    <tr><td colSpan={9} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="CT phase preset"><select aria-label="CT phase preset" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.ctPhasePresetId ?? ""} onChange={(event) => setDraft({ ...draft, ctPhasePresetId: event.target.value ? Number(event.target.value) : null })}><option value="">No preset</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></Field>
      <Field label="Custom phase name"><input aria-label="Custom phase name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.customPhaseName)} onChange={(event) => setDraft({ ...draft, customPhaseName: nullableText(event.target.value) })} /></Field>
      <Field label="Timing override"><input aria-label="Timing override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.timingOverride)} onChange={(event) => setDraft({ ...draft, timingOverride: nullableText(event.target.value) })} /></Field>
      <Field label="Coverage override"><input aria-label="Coverage override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.coverageOverride)} onChange={(event) => setDraft({ ...draft, coverageOverride: nullableText(event.target.value) })} /></Field>
      <Field label="Reconstruction override"><input aria-label="Reconstruction override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.reconstructionOverride)} onChange={(event) => setDraft({ ...draft, reconstructionOverride: nullableText(event.target.value) })} /></Field>
      <Field label="Instructions override"><input aria-label="Instructions override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.instructionsOverride)} onChange={(event) => setDraft({ ...draft, instructionsOverride: nullableText(event.target.value) })} /></Field>
      <label className="flex items-end gap-2 text-sm font-medium"><input type="checkbox" checked={draft.isRequired} onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })} /> Required</label>
      <FormActions saving={false} saveLabel="Save phase" canSave={Boolean(draft.ctPhasePresetId || draft.customPhaseName?.trim())} onSave={onSave} onCancel={onCancel} />
      {selectedPreset && <p className="text-xs md:col-span-4" style={{ color: "var(--text-muted)" }}>Preset reference: {selectedPreset.contrastStatus} · {selectedPreset.timingType} · {selectedPreset.defaultCoverage ?? "No default coverage"}</p>}
    </div></td></tr>
  );
}

function MriProtocolRows({ detail, scanners, presets, draft, editingRowId, editable, setDraft, onAdd, onEdit, onCancel, onSave, onRemove, onReorder }: { detail: ProtocolLibraryVersionDetail; scanners: ImagingScanner[]; presets: MriSequencePreset[]; draft: ProtocolLibraryMriSequenceRowPayload | null; editingRowId: number | null; editable: boolean; setDraft: (draft: ProtocolLibraryMriSequenceRowPayload | null) => void; onAdd: () => void; onEdit: (row: ProtocolLibraryMriSequenceRow) => void; onCancel: () => void; onSave: (payload: ProtocolLibraryMriSequenceRowPayload) => void; onRemove: (rowId: number) => void; onReorder: (rowIds: number[]) => void }) {
  const activePresets = presets.filter((preset) => preset.isActive);
  const move = (index: number, direction: -1 | 1) => {
    const rows = [...detail.mriSequences];
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    [rows[index], rows[target]] = [rows[target], rows[index]];
    onReorder(rows.map((row) => row.id));
  };
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">MRI sequences</h3>
        {editable && <AddButton label="Add sequence" onClick={onAdd} />}
      </div>
      <SettingsTable emptyText="No MRI sequences added yet" headers={["Order", "Scanner", "MRI sequence preset", "Plane override", "Coverage override", "b-values override", "Timing override", "Required", "Actions"]}>
        {draft && editable && <MriProtocolRowForm draft={draft} scanners={scanners.filter((scanner) => scanner.isActive && scanner.modality === "MRI")} presets={activePresets} setDraft={setDraft} onCancel={onCancel} onSave={() => onSave(draft)} />}
        {detail.mriSequences.map((row, index) => (
          <tr key={row.id}>
            <Cell>{row.orderIndex}</Cell>
            <Cell>{row.scannerName ?? "Generic"}</Cell>
            <Cell>{row.mriSequencePresetName ?? "-"}</Cell>
            <Cell>{row.planeOverride ?? "-"}</Cell>
            <Cell>{row.coverageOverride ?? "-"}</Cell>
            <Cell>{row.bValuesOverride ?? "-"}</Cell>
            <Cell>{row.timingOverride ?? "-"}</Cell>
            <Cell>{row.isRequired ? "Yes" : "No"}</Cell>
            <Cell>{editable ? <RowBuilderActions onEdit={() => onEdit(row)} onRemove={() => onRemove(row.id)} onMoveUp={() => move(index, -1)} onMoveDown={() => move(index, 1)} first={index === 0} last={index === detail.mriSequences.length - 1} editing={editingRowId === row.id} /> : "Read-only"}</Cell>
          </tr>
        ))}
      </SettingsTable>
    </section>
  );
}

function MriProtocolRowForm({ draft, scanners, presets, setDraft, onSave, onCancel }: { draft: ProtocolLibraryMriSequenceRowPayload; scanners: ImagingScanner[]; presets: MriSequencePreset[]; setDraft: (draft: ProtocolLibraryMriSequenceRowPayload | null) => void; onSave: () => void; onCancel: () => void }) {
  const filteredPresets = presets.filter((preset) => !draft.scannerId || preset.scannerId === null || preset.scannerId === draft.scannerId);
  const selectedPreset = presets.find((preset) => preset.id === draft.mriSequencePresetId) ?? null;
  return (
    <tr><td colSpan={9} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Scanner"><select aria-label="Scanner" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.scannerId ?? ""} onChange={(event) => setDraft({ ...draft, scannerId: event.target.value ? Number(event.target.value) : null, mriSequencePresetId: null })}><option value="">Generic / not scanner-specific</option>{scanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select></Field>
      <Field label="MRI sequence preset"><select aria-label="MRI sequence preset" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.mriSequencePresetId ?? ""} onChange={(event) => setDraft({ ...draft, mriSequencePresetId: event.target.value ? Number(event.target.value) : null })}><option value="">No preset</option>{filteredPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></Field>
      <Field label="Plane override"><input aria-label="Plane override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.planeOverride)} onChange={(event) => setDraft({ ...draft, planeOverride: nullableText(event.target.value) })} /></Field>
      <Field label="Coverage override"><input aria-label="Coverage override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.coverageOverride)} onChange={(event) => setDraft({ ...draft, coverageOverride: nullableText(event.target.value) })} /></Field>
      <Field label="b-values override"><input aria-label="b-values override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bValuesOverride)} onChange={(event) => setDraft({ ...draft, bValuesOverride: nullableText(event.target.value) })} /></Field>
      <Field label="Timing override"><input aria-label="Timing override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.timingOverride)} onChange={(event) => setDraft({ ...draft, timingOverride: nullableText(event.target.value) })} /></Field>
      <Field label="Notes override"><input aria-label="Notes override" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.notesOverride)} onChange={(event) => setDraft({ ...draft, notesOverride: nullableText(event.target.value) })} /></Field>
      <label className="flex items-end gap-2 text-sm font-medium"><input type="checkbox" checked={draft.isRequired} onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })} /> Required</label>
      <FormActions saving={false} saveLabel="Save sequence" canSave={Boolean(draft.mriSequencePresetId || draft.planeOverride?.trim() || draft.coverageOverride?.trim())} onSave={onSave} onCancel={onCancel} />
      {selectedPreset && <p className="text-xs md:col-span-4" style={{ color: "var(--text-muted)" }}>Preset reference: {selectedPreset.defaultPlane ?? "No default plane"} · {selectedPreset.defaultCoverage ?? "No default coverage"} · {selectedPreset.defaultBValues ?? "No b-values"}</p>}
    </div></td></tr>
  );
}

function RowBuilderActions({ first, last, editing, onEdit, onRemove, onMoveUp, onMoveDown }: { first: boolean; last: boolean; editing: boolean; onEdit: () => void; onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={first} onClick={onMoveUp} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>Up</button>
      <button type="button" disabled={last} onClick={onMoveDown} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:opacity-40" style={{ borderColor: "var(--border)" }}>Down</button>
      <button type="button" onClick={onEdit} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{editing ? "Editing" : "Edit"}</button>
      <button type="button" onClick={onRemove} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>Remove</button>
    </div>
  );
}

function RegionForm({ draft, setDraft, saving, onSave, onCancel }: { draft: ProtocolAnatomyRegionPayload; setDraft: (draft: ProtocolAnatomyRegionPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Name"><input aria-label="Name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Body system"><input aria-label="Body system" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bodySystem)} onChange={(event) => setDraft({ ...draft, bodySystem: nullableText(event.target.value) })} /></Field>
      <Field label="Modality scope"><select aria-label="Modality scope" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.modalityScope} onChange={(event) => setDraft({ ...draft, modalityScope: event.target.value as ProtocolAnatomyRegionPayload["modalityScope"] })}><option value="CT">CT</option><option value="MRI">MRI</option><option value="BOTH">BOTH</option></select></Field>
      <Field label="Default coverage note"><input aria-label="Default coverage note" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultCoverageNote)} onChange={(event) => setDraft({ ...draft, defaultCoverageNote: nullableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save region" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function ScannerForm({ draft, setDraft, saving, onSave, onCancel }: { draft: ImagingScannerPayload; setDraft: (draft: ImagingScannerPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={6} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Name"><input aria-label="Name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Modality"><select aria-label="Modality" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as ImagingScannerPayload["modality"] })}><option value="CT">CT</option><option value="MRI">MRI</option></select></Field>
      {(["vendor", "model", "fieldStrength", "location"] as const).map((key) => <Field key={key} label={key === "fieldStrength" ? "Field strength" : key[0].toUpperCase() + key.slice(1)}><input aria-label={key === "fieldStrength" ? "Field strength" : key[0].toUpperCase() + key.slice(1)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: nullableText(event.target.value) })} /></Field>)}
      <Field label="Notes"><input aria-label="Notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.notes)} onChange={(event) => setDraft({ ...draft, notes: nullableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save scanner" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function CtPhaseForm({ draft, setDraft, saving, onSave, onCancel }: { draft: CtPhasePresetPayload; setDraft: (draft: CtPhasePresetPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={7} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Name"><input aria-label="Name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      <Field label="Contrast status"><select aria-label="Contrast status" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.contrastStatus} onChange={(event) => setDraft({ ...draft, contrastStatus: event.target.value as CtPhasePresetPayload["contrastStatus"] })}><option value="NON_CONTRAST">NON_CONTRAST</option><option value="POST_CONTRAST">POST_CONTRAST</option><option value="DELAYED">DELAYED</option><option value="OTHER">OTHER</option></select></Field>
      <Field label="Timing type"><select aria-label="Timing type" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.timingType} onChange={(event) => setDraft({ ...draft, timingType: event.target.value as CtPhasePresetPayload["timingType"] })}><option value="NONE">NONE</option><option value="FIXED_DELAY">FIXED_DELAY</option><option value="BOLUS_TRACKING">BOLUS_TRACKING</option><option value="MANUAL">MANUAL</option></select></Field>
      <NumberField label="Delay seconds" value={draft.delaySeconds} onChange={(value) => setDraft({ ...draft, delaySeconds: nullableNumber(value) })} />
      <Field label="Bolus tracking site"><input aria-label="Bolus tracking site" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.bolusTrackingSite)} onChange={(event) => setDraft({ ...draft, bolusTrackingSite: nullableText(event.target.value) })} /></Field>
      <NumberField label="Trigger HU" value={draft.triggerHu} onChange={(value) => setDraft({ ...draft, triggerHu: nullableNumber(value) })} />
      <Field label="Default coverage"><input aria-label="Default coverage" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.defaultCoverage)} onChange={(event) => setDraft({ ...draft, defaultCoverage: nullableText(event.target.value) })} /></Field>
      <Field label="Reconstruction notes"><input aria-label="Reconstruction notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.reconstructionNotes)} onChange={(event) => setDraft({ ...draft, reconstructionNotes: nullableText(event.target.value) })} /></Field>
      <Field label="Instructions"><input aria-label="Instructions" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.instructions)} onChange={(event) => setDraft({ ...draft, instructions: nullableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save CT phase" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function MriSequenceForm({ draft, scanners, setDraft, saving, onSave, onCancel }: { draft: MriSequencePresetPayload; scanners: ImagingScanner[]; setDraft: (draft: MriSequencePresetPayload | null) => void; saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <tr><td colSpan={7} className="border-b p-3" style={{ borderColor: "var(--border)" }}><div className="grid gap-3 md:grid-cols-4">
      <Field label="Scanner"><select aria-label="Scanner" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.scannerId ?? ""} onChange={(event) => setDraft({ ...draft, scannerId: event.target.value ? Number(event.target.value) : null })}><option value="">Generic / not scanner-specific</option>{scanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select></Field>
      <Field label="Name"><input aria-label="Name" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
      {(["vendor", "vendorSequenceName", "genericFamily", "weighting", "defaultPlane", "contrastRelation", "defaultCoverage", "defaultBValues", "defaultDynamicTiming"] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}><input aria-label={key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: nullableText(event.target.value) })} /></Field>)}
      <NumberField label="Estimated scan time minutes" value={draft.estimatedScanTimeMinutes} positive onChange={(value) => setDraft({ ...draft, estimatedScanTimeMinutes: nullableNumber(value, true) })} />
      <Field label="Notes"><input aria-label="Notes" className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={textValue(draft.notes)} onChange={(event) => setDraft({ ...draft, notes: nullableText(event.target.value) })} /></Field>
      <FormActions saving={saving} saveLabel="Save MRI sequence" canSave={Boolean(draft.name.trim())} onSave={onSave} onCancel={onCancel} />
    </div></td></tr>
  );
}

function NumberField({ label, value, positive = false, onChange }: { label: string; value: number | null; positive?: boolean; onChange: (value: string) => void }) {
  return <Field label={label}><input aria-label={label} type="number" min={positive ? 1 : 0} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} value={numberText(value)} onChange={(event) => onChange(event.target.value)} /></Field>;
}

function FormActions({ saving, saveLabel, canSave, onSave, onCancel }: { saving: boolean; saveLabel: string; canSave: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-end gap-2">
      <button type="button" disabled={!canSave || saving} onClick={onSave} className="h-10 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : saveLabel}</button>
      <button type="button" onClick={onCancel} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
    </div>
  );
}

function ProtocolingWorklist() {
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(addDays(todayIso(), 7));
  const [modality, setModality] = useState<"" | "CT" | "MRI">("");
  const [protocolStatus, setProtocolStatus] = useState<"NOT_PROTOCOLLED" | "ASSIGNED" | "ALL">("NOT_PROTOCOLLED");
  const [search, setSearch] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<number | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  const filters = useMemo(() => ({
    dateFrom,
    dateTo,
    modality: modality || null,
    protocolStatus,
    search: nullableText(search),
  }), [dateFrom, dateTo, modality, protocolStatus, search]);

  const appointmentsQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointments", filters],
    queryFn: () => fetchDoctorProtocolingAppointments(filters),
  });
  const appointmentDetailQuery = useQuery({
    queryKey: ["doctor", "protocoling", "appointments", selectedAppointmentId],
    queryFn: () => fetchDoctorProtocolingAppointmentDetail(selectedAppointmentId!),
    enabled: selectedAppointmentId !== null,
  });
  const protocolsQuery = useQuery({ queryKey: ["doctor", "protocol-library", "protocols"], queryFn: fetchProtocolLibraryProtocols });
  const scannersQuery = useQuery({ queryKey: ["doctor", "protocol-library", "scanners"], queryFn: fetchProtocolLibraryScanners });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "protocoling"] });
  };
  const createAssignmentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: number; payload: ProtocolAssignmentPayload }) => createDoctorProtocolAssignment(appointmentId, payload),
    onSuccess: invalidate,
  });
  const updateAssignmentMutation = useMutation({
    mutationFn: ({ appointmentId, payload }: { appointmentId: number; payload: ProtocolAssignmentPayload }) => updateDoctorProtocolAssignment(appointmentId, payload),
    onSuccess: invalidate,
  });
  const clearAssignmentMutation = useMutation({
    mutationFn: (appointmentId: number) => cancelDoctorProtocolAssignment(appointmentId),
    onSuccess: invalidate,
  });

  const appointments = appointmentsQuery.data ?? [];
  const selectedAppointment = appointmentDetailQuery.data?.appointment ?? appointments.find((appointment) => appointment.appointmentId === selectedAppointmentId) ?? null;
  const selectedDetail = appointmentDetailQuery.data ?? null;
  const assignmentBusy = createAssignmentMutation.isPending || updateAssignmentMutation.isPending || clearAssignmentMutation.isPending;
  const closeAssignmentDrawer = () => {
    if (assignmentBusy) return;
    setSelectedAppointmentId(null);
    setAssignmentError(null);
  };
  const openAssignmentDrawer = (appointmentId: number) => {
    setAssignmentError(null);
    setSelectedAppointmentId(appointmentId);
  };
  const handleAssignmentSuccess = async (message: string) => {
    await invalidate();
    setSelectedAppointmentId(null);
    setAssignmentError(null);
    pushToast({ type: "success", title: message });
  };
  const handleAssignmentError = (error: unknown) => {
    setAssignmentError(error instanceof Error ? error.message : "Unable to save protocol assignment.");
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Protocoling</p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Protocoling Worklist</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: "var(--text-muted)" }}>Assign active CT/MRI protocol library versions to scheduled appointments.</p>
      </div>

      <section className="grid gap-3 rounded-lg border p-4 md:grid-cols-3 lg:grid-cols-6" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="flex items-end gap-2 md:col-span-3">
          <button type="button" onClick={() => { setDateFrom(todayIso()); setDateTo(todayIso()); }} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Today</button>
          <button type="button" onClick={() => { const tomorrow = addDays(todayIso(), 1); setDateFrom(tomorrow); setDateTo(tomorrow); }} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Tomorrow</button>
          <button type="button" onClick={() => { setDateFrom(todayIso()); setDateTo(addDays(todayIso(), 7)); }} className="h-10 rounded-lg border px-3 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Next 7 days</button>
        </div>
        <label className="text-sm font-medium">From<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">To<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></label>
        <label className="text-sm font-medium">Modality<select value={modality} onChange={(event) => setModality(event.target.value as "" | "CT" | "MRI")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">All</option><option value="CT">CT</option><option value="MRI">MRI</option></select></label>
        <label className="text-sm font-medium">Protocol status<select value={protocolStatus} onChange={(event) => setProtocolStatus(event.target.value as "NOT_PROTOCOLLED" | "ASSIGNED" | "ALL")} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="NOT_PROTOCOLLED">Not protocolled</option><option value="ASSIGNED">Protocol assigned</option><option value="ALL">All</option></select></label>
        <label className="text-sm font-medium md:col-span-2">Search<input aria-label="Search protocoling appointments" value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} placeholder="Patient, MRN, accession" /></label>
      </section>

      {appointments.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
          No appointments need protocol assignment.
        </div>
      ) : (
        <SettingsTable emptyText="No appointments need protocol assignment." headers={["Date/time", "Patient", "Age/sex", "Modality", "Exam", "Category", "Notes", "Protocol status", "Assigned protocol", "Actions"]}>
          {appointments.map((appointment) => (
            <tr key={appointment.appointmentId}>
              <Cell>{appointment.appointmentDate} {appointment.appointmentTime ?? ""}</Cell>
              <Cell>{protocolingPatientName(appointment)}</Cell>
              <Cell>{appointment.ageYears ?? "-"} / {appointment.sex ?? "-"}</Cell>
              <Cell>{appointment.modalityName ?? appointment.modalityCode}</Cell>
              <Cell>{appointment.examTypeName ?? "-"}</Cell>
              <Cell>{appointment.caseCategory ?? "-"}</Cell>
              <Cell><span className="block max-w-[16rem] truncate" title={appointment.clinicalNotes ?? undefined}>{appointment.clinicalNotes ?? "-"}</span></Cell>
              <Cell><ProtocolStatusBadge assigned={appointment.assignment !== null} /></Cell>
              <Cell>{appointment.assignment ? `${appointment.assignment.protocolName} v${appointment.assignment.versionNumber}${appointment.assignment.scannerName ? ` · ${appointment.assignment.scannerName}` : ""}` : "-"}</Cell>
              <Cell><button type="button" onClick={() => openAssignmentDrawer(appointment.appointmentId)} className="rounded-lg border px-2 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)" }}>{appointment.assignment ? "Change" : "Assign"}</button></Cell>
            </tr>
          ))}
        </SettingsTable>
      )}

      {selectedAppointment && (
        <ProtocolAssignmentDrawer
          key={selectedAppointment.appointmentId}
          appointment={selectedAppointment}
          detail={selectedDetail}
          loading={appointmentDetailQuery.isLoading || !selectedDetail}
          error={assignmentError}
          protocols={protocolsQuery.data ?? []}
          scanners={scannersQuery.data ?? []}
          saving={assignmentBusy}
          onClose={closeAssignmentDrawer}
          onSave={(payload) => {
            const mutationPayload = { appointmentId: selectedAppointment.appointmentId, payload };
            setAssignmentError(null);
            const mutation = selectedAppointment.assignment ? updateAssignmentMutation : createAssignmentMutation;
            mutation.mutate(mutationPayload, {
              onSuccess: () => void handleAssignmentSuccess(selectedAppointment.assignment ? "Protocol assignment updated." : "Protocol assigned."),
              onError: handleAssignmentError,
            });
          }}
          onClear={() => {
            if (!selectedAppointment.assignment) return;
            if (!window.confirm("Clear this protocol assignment?")) return;
            setAssignmentError(null);
            clearAssignmentMutation.mutate(selectedAppointment.appointmentId, {
              onSuccess: () => void handleAssignmentSuccess("Protocol assignment cleared."),
              onError: handleAssignmentError,
            });
          }}
        />
      )}
    </section>
  );
}

function LegacyProtocolAssignmentPanel({ detail, protocols, scanners, saving, onSave, onCancel }: { detail: DoctorProtocolingAppointmentDetail; protocols: ProtocolLibraryProtocol[]; scanners: ImagingScanner[]; saving: boolean; onSave: (payload: ProtocolAssignmentPayload) => void; onCancel: () => void }) {
  const appointment = detail.appointment;
  const existing = appointment.assignment;
  const activeProtocols = protocols.filter((protocol) => protocol.isActive && protocol.modality === appointment.modalityCode && protocol.activeVersionId && protocol.activeVersionStatus === "ACTIVE");
  const matchingScanners = scanners.filter((scanner) => scanner.isActive && scanner.modality === appointment.modalityCode);
  const [protocolId, setProtocolId] = useState(existing?.protocolId ? String(existing.protocolId) : "");
  const [scannerId, setScannerId] = useState(existing?.scannerId ? String(existing.scannerId) : "");
  const [protocolNotes, setProtocolNotes] = useState(existing?.protocolNotes ?? "");
  const [contrastNotes, setContrastNotes] = useState(existing?.contrastNotes ?? "");

  const payload = (): ProtocolAssignmentPayload => ({
    protocolId: Number(protocolId),
    scannerId: scannerId ? Number(scannerId) : null,
    protocolNotes: nullableText(protocolNotes),
    contrastNotes: nullableText(contrastNotes),
    status: "ASSIGNED",
  });

  return (
    <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">Assign protocol</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{protocolingPatientName(appointment)} · {appointment.appointmentDate} {appointment.appointmentTime ?? ""} · {appointment.modalityCode} · {appointment.examTypeName ?? "-"}</p>
          {appointment.clinicalNotes && <p className="mt-1 text-sm">{appointment.clinicalNotes}</p>}
        </div>
        <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Close</button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Protocol"><select aria-label="Protocol" value={protocolId} onChange={(event) => setProtocolId(event.target.value)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">Select protocol</option>{activeProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.name} v{protocol.activeVersionNumber}</option>)}</select></Field>
        <Field label="Scanner"><select aria-label="Scanner" value={scannerId} onChange={(event) => setScannerId(event.target.value)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">Not selected</option>{matchingScanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select></Field>
        <Field label="Protocol notes"><textarea aria-label="Protocol notes" value={protocolNotes} onChange={(event) => setProtocolNotes(event.target.value)} className={`${inputClass()} min-h-20`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></Field>
        <Field label="Contrast notes"><textarea aria-label="Contrast notes" value={contrastNotes} onChange={(event) => setContrastNotes(event.target.value)} className={`${inputClass()} min-h-20`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /></Field>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" disabled={!protocolId || saving} onClick={() => onSave(payload())} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save assignment"}</button>
        <button type="button" onClick={onCancel} className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Cancel</button>
      </div>
      {detail.assignmentDetail && <ProtocolAssignmentSummary detail={detail} />}
    </section>
  );
}

function ProtocolAssignmentDrawer({
  appointment,
  detail,
  loading,
  error,
  protocols,
  scanners,
  saving,
  onSave,
  onClear,
  onClose,
}: {
  appointment: DoctorProtocolingAppointment;
  detail: DoctorProtocolingAppointmentDetail | null;
  loading: boolean;
  error: string | null;
  protocols: ProtocolLibraryProtocol[];
  scanners: ImagingScanner[];
  saving: boolean;
  onSave: (payload: ProtocolAssignmentPayload) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const existing = appointment.assignment;
  const activeProtocols = protocols.filter((protocol) => protocol.isActive && protocol.modality === appointment.modalityCode && protocol.activeVersionId && protocol.activeVersionStatus === "ACTIVE");
  const matchingScanners = scanners.filter((scanner) => scanner.isActive && scanner.modality === appointment.modalityCode);
  const [protocolId, setProtocolId] = useState(existing?.protocolId ? String(existing.protocolId) : "");
  const [scannerId, setScannerId] = useState(existing?.scannerId ? String(existing.scannerId) : "");
  const [protocolNotes, setProtocolNotes] = useState(existing?.protocolNotes ?? "");
  const [contrastNotes, setContrastNotes] = useState(existing?.contrastNotes ?? "");
  const title = existing ? "Change assigned protocol" : "Assign protocol";
  const noActiveProtocolsMessage = `No active ${appointment.modalityCode} protocols available. Create and activate one in Protocol Library.`;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const payload = (): ProtocolAssignmentPayload => ({
    protocolId: Number(protocolId),
    scannerId: scannerId ? Number(scannerId) : null,
    protocolNotes: nullableText(protocolNotes),
    contrastNotes: nullableText(contrastNotes),
    status: "ASSIGNED",
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose} role="presentation" data-testid="protocol-assignment-drawer-backdrop">
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto bg-background p-4 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          <div>
            <h3 className="text-xl font-semibold">{title}</h3>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {appointment.accessionNumber} - {protocolingPatientName(appointment)} - {appointment.appointmentDate} {appointment.appointmentTime ?? ""} - {appointment.modalityCode} - {appointment.examTypeName ?? "-"}
            </p>
            {appointment.clinicalNotes && <p className="mt-2 text-sm">{appointment.clinicalNotes}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Close</button>
        </div>

        {loading ? (
          <div className="mt-4 rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
            Loading appointment protocol details...
          </div>
        ) : (
          <>
            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            {existing && (
              <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}>
                <p className="text-xs font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-muted)" }}>Current assignment</p>
                <p className="mt-1 text-sm font-semibold">{existing.protocolName} v{existing.versionNumber}{existing.scannerName ? ` - ${existing.scannerName}` : ""}</p>
                {existing.protocolNotes && <p className="mt-2 text-sm">Protocol instructions: {existing.protocolNotes}</p>}
                {existing.contrastNotes && <p className="mt-1 text-sm">Contrast instructions: {existing.contrastNotes}</p>}
              </div>
            )}
            {activeProtocols.length === 0 ? (
              <div className="mt-4 rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}>
                {noActiveProtocolsMessage}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label="Protocol"><select aria-label="Protocol" value={protocolId} onChange={(event) => setProtocolId(event.target.value)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">Select protocol</option>{activeProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.name} v{protocol.activeVersionNumber}</option>)}</select></Field>
              <Field label="Scanner"><select aria-label="Scanner" value={scannerId} onChange={(event) => setScannerId(event.target.value)} className={inputClass()} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }}><option value="">Not selected</option>{matchingScanners.map((scanner) => <option key={scanner.id} value={scanner.id}>{scanner.name}</option>)}</select><span className="mt-1 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>Select scanner if the protocol is scanner-specific. Leave blank if scanner will be decided later.</span></Field>
              <Field label="Protocol instructions"><textarea aria-label="Protocol instructions" placeholder="Example: Ensure rectal tumor-centered oblique axial T2 and DWI. No routine contrast." value={protocolNotes} onChange={(event) => setProtocolNotes(event.target.value)} className={`${inputClass()} min-h-24`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /><span className="mt-1 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>Patient-specific scan instructions, coverage, planes, or special clinical question.</span></Field>
              <Field label="Contrast instructions"><textarea aria-label="Contrast instructions" placeholder="Example: IV contrast if renal function acceptable. Portal venous only." value={contrastNotes} onChange={(event) => setContrastNotes(event.target.value)} className={`${inputClass()} min-h-24`} style={{ borderColor: "var(--border)", backgroundColor: "var(--background)" }} /><span className="mt-1 block text-xs font-normal" style={{ color: "var(--text-muted)" }}>IV contrast decision, dynamic timing, renal/allergy concerns, or reason contrast should not be given.</span></Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={!protocolId || activeProtocols.length === 0 || saving} onClick={() => onSave(payload())} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save assignment"}</button>
              {existing ? <button type="button" disabled={saving} onClick={onClear} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">Clear assignment</button> : null}
              <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Cancel</button>
            </div>
            {detail?.assignmentDetail && <ProtocolAssignmentSummary detail={detail} />}
          </>
        )}
      </aside>
    </div>
  );
}

function ProtocolAssignmentSummary({ detail }: { detail: DoctorProtocolingAppointmentDetail }) {
  const assignmentDetail = detail.assignmentDetail;
  if (!assignmentDetail) return null;
  const assignment = assignmentDetail.assignment;
  return (
    <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--border)" }}>
      <h4 className="font-semibold">Assigned protocol summary</h4>
      <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{assignment.protocolName} v{assignment.versionNumber}{assignment.scannerName ? ` · ${assignment.scannerName}` : ""}</p>
      {assignment.protocolNotes && <p className="mt-2 text-sm">Protocol instructions: {assignment.protocolNotes}</p>}
      {assignment.contrastNotes && <p className="mt-1 text-sm">Contrast instructions: {assignment.contrastNotes}</p>}
      {detail.appointment.modalityCode === "CT" ? (
        <SettingsTable emptyText="No CT phases found for this protocol." headers={["Order", "Phase", "Timing", "Coverage", "Required"]}>
          {assignmentDetail.ctPhases.map((phase) => <tr key={phase.id}><Cell>{phase.orderIndex}</Cell><Cell>{phase.customPhaseName ?? phase.ctPhasePresetName ?? "-"}</Cell><Cell>{phase.timingOverride ?? "-"}</Cell><Cell>{phase.coverageOverride ?? "-"}</Cell><Cell>{phase.isRequired ? "Yes" : "No"}</Cell></tr>)}
        </SettingsTable>
      ) : (
        <SettingsTable emptyText="No MRI sequences found for this protocol." headers={["Order", "Scanner", "Sequence", "Plane", "Coverage", "b-values/timing", "Required"]}>
          {assignmentDetail.mriSequences.map((sequence) => <tr key={sequence.id}><Cell>{sequence.orderIndex}</Cell><Cell>{sequence.scannerName ?? "-"}</Cell><Cell>{sequence.mriSequencePresetName ?? "-"}</Cell><Cell>{sequence.planeOverride ?? "-"}</Cell><Cell>{sequence.coverageOverride ?? "-"}</Cell><Cell>{sequence.bValuesOverride ?? sequence.timingOverride ?? "-"}</Cell><Cell>{sequence.isRequired ? "Yes" : "No"}</Cell></tr>)}
        </SettingsTable>
      )}
    </div>
  );
}

export function DoctorProtocolsPage(_props: { me: DoctorMe }) {
  const [activeArea, setActiveArea] = useState<"protocoling" | "library">("protocoling");

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto">
        <SectionButton label="Protocoling" active={activeArea === "protocoling"} onClick={() => setActiveArea("protocoling")} />
        <SectionButton label="Protocol Library" active={activeArea === "library"} onClick={() => setActiveArea("library")} />
      </div>
      {activeArea === "library" ? <ProtocolLibraryPanel /> : <ProtocolingWorklist />}
    </div>
  );
}
