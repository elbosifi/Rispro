import { useEffect, useState, useRef, useImperativeHandle, forwardRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchUsers,
  fetchAuditEntries,
  fetchExamTypes,
  fetchModalitiesSettings,
  fetchNameDictionary,
  fetchSettings,
  deleteUser,
  createUser,
  exportAuditCSV,
  deleteNameDictionaryEntry,
  importNameDictionary,
  upsertNameDictionaryEntry,
  createModality,
  updateModality,
  deleteModality,
  createExamType,
  updateExamType,
  deleteExamType,
  saveSettings,
  fetchSchedulingEngineConfig,
  saveSchedulingEngineConfig
} from "@/lib/api-hooks";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { formatDateTimeLy } from "@/lib/date-format";
import { chooseLocalized, type TranslationKey } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import DicomGatewaySettingsSection from "./dicom-gateway-section";
import DicomDevicesSection from "./dicom-devices-section";
import DicomMonitoringSection from "./dicom-monitoring-section";
import PacsSettingsSection from "./pacs-settings-section";
import type { User, SchedulingEngineConfig } from "@/types/api";

// ---------------------------------------------------------------------------
// Friendly label maps for scheduling config enums
// ---------------------------------------------------------------------------

const RULE_TYPE_LABELS: Record<string, string> = {
  specific_date: "Specific date",
  date_range: "Date range",
  yearly_recurrence: "Yearly recurrence",
  weekly_recurrence: "Weekly recurrence"
};

const EFFECT_MODE_LABELS: Record<string, string> = {
  restriction_overridable: "Restricted unless supervisor approves",
  hard_restriction: "Hard restriction"
};

const CASE_CATEGORY_LABELS: Record<string, string> = {
  oncology: "Oncology",
  non_oncology: "Non-oncology"
};

const WEEKDAY_LABELS: Record<string, string> = {
  "0": "Sunday",
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday"
};

const SECTION_HELPERS: Record<string, string> = {
  categoryLimits: "Set the daily limit for oncology and non-oncology cases.",
  blockedRules: "Block full dates or date ranges for a modality.",
  examRules: "Control when specific exam types can be booked.",
  specialQuotas: "Add a few extra slots for selected exam types.",
  specialReasons: "Reasons staff can choose when using a special quota.",
  identifierTypes: "Extra patient ID types available during registration."
};

const SECTION_TITLES: Record<string, string> = {
  categoryLimits: "Category Daily Limits",
  blockedRules: "Blocked Dates",
  examRules: "Exam Date Rules",
  specialQuotas: "Special Quotas",
  specialReasons: "Special Reason Codes",
  identifierTypes: "Patient Identifier Types"
};

const ACTION_LABELS = {
  add: {
    categoryLimits: "Add Limit",
    blockedRules: "Add Rule",
    examRules: "Add Rule",
    specialQuotas: "Add Quota",
    specialReasons: "Add Reason",
    identifierTypes: "Add Type"
  },
  remove: "Remove",
  active: "Active",
  overridable: "Supervisor can override",
  alternateWeeks: "Alternate weeks only",
  save: "Save Scheduling Config",
  reset: "Reset to Server Values",
  saving: "Saving…"
} as const;

function _friendlyRuleType(value: string): string {
  return RULE_TYPE_LABELS[value] || value;
}

function _friendlyEffectMode(value: string): string {
  return EFFECT_MODE_LABELS[value] || value;
}

function _friendlyWeekday(value: string): string {
  return WEEKDAY_LABELS[value] || value;
}

function _friendlyCaseCategory(value: string): string {
  return CASE_CATEGORY_LABELS[value] || value;
}

// Export for testing
export { _friendlyRuleType as friendlyRuleType, _friendlyEffectMode as friendlyEffectMode, _friendlyWeekday as friendlyWeekday, _friendlyCaseCategory as friendlyCaseCategory };

type SettingsSection =
  | "menu"
  | "patient_registration"
  | "scheduling_and_capacity"
  | "queue_and_arrival"
  | "scheduling_engine_config"
  | "pacs_connection"
  | "dicom_gateway_config"
  | "dicom_gateway_devices"
  | "dicom_gateway_monitoring"
  | "users"
  | "audit_log"
  | "exam_types"
  | "modalities"
  | "name_dictionary"
  | "backup_restore";

const SECTION_KEYS: SettingsSection[] = [
  "patient_registration",
  "scheduling_and_capacity",
  "queue_and_arrival",
  "scheduling_engine_config",
  "pacs_connection",
  "dicom_gateway_config",
  "dicom_gateway_devices",
  "dicom_gateway_monitoring",
  "users",
  "audit_log",
  "exam_types",
  "modalities",
  "name_dictionary",
  "backup_restore"
];

function sectionLabel(_t: (key: TranslationKey, params?: Record<string, string | number>) => string, section: SettingsSection): string {
  return _t(`settings.section.${section}` as TranslationKey);
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const [section, setSection] = useState<SettingsSection>("menu");
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingReAuthKeys, setPendingReAuthKeys] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const backupRestoreRef = useRef<{ onReAuthSuccess: () => void }>(null);

  const handleReAuthSuccess = () => {
    setShowReAuthModal(false);
    // Notify backup/restore section to retry after re-auth
    backupRestoreRef.current?.onReAuthSuccess();
    for (const key of pendingReAuthKeys) {
      queryClient.invalidateQueries({ queryKey: key.split(",") });
    }
    setPendingReAuthKeys([]);
    queryClient.invalidateQueries({ queryKey: ["auth-session"] });
  };

  const requestReAuth = (queryKey: string[]) => {
    const keyStr = queryKey.join(",");
    setPendingReAuthKeys((prev) => (prev.includes(keyStr) ? prev : [...prev, keyStr]));
    setShowReAuthModal(true);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">{t("settings.title")}</h2>

      {section === "menu" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECTION_KEYS.map((key) => {
            const label = sectionLabel(t, key);
            return (
              <button
                key={key}
                onClick={() => setSection(key)}
                className="card-shell p-6 hover:border-teal-500 dark:hover:border-teal-500 transition-colors text-start"
              >
                <h3 className="text-lg font-semibold text-stone-900 dark:text-white">{label}</h3>
                <p className="text-sm description-center mt-1">{t("settings.configureSection", { section: label })}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setSection("menu")}
            className="pill-soft text-sm font-medium"
          >
            {t("common.back")} - {t("settings.backToMenu")}
          </button>

          <div className="card-shell p-6">
            <h3 className="text-xl font-bold text-stone-900 dark:text-white mb-4">{sectionLabel(t, section)}</h3>

            {section === "users" && <UsersSection onReAuthRequired={requestReAuth} />}
            {section === "audit_log" && <AuditSection onReAuthRequired={requestReAuth} />}
            {section === "exam_types" && <ExamTypesSection onReAuthRequired={requestReAuth} />}
            {section === "modalities" && <ModalitiesSection onReAuthRequired={requestReAuth} />}
            {section === "name_dictionary" && <NameDictionarySection onReAuthRequired={requestReAuth} />}
            {section === "pacs_connection" && <PacsSettingsSection onReAuthRequired={requestReAuth} />}
            {section === "patient_registration" && <SimpleSettingsSection category="patient_registration" onReAuthRequired={requestReAuth} />}
            {section === "scheduling_and_capacity" && <SimpleSettingsSection category="scheduling_and_capacity" onReAuthRequired={requestReAuth} />}
            {section === "queue_and_arrival" && <SimpleSettingsSection category="queue_and_arrival" onReAuthRequired={requestReAuth} />}
            {section === "scheduling_engine_config" && <SchedulingEngineConfigSection onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway_config" && <DicomGatewaySettingsSection onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway_devices" && <DicomDevicesSection onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway_monitoring" && <DicomMonitoringSection onReAuthRequired={requestReAuth} />}
            {section === "backup_restore" && <BackupRestoreSection ref={backupRestoreRef} onReAuthRequired={requestReAuth} />}

            {showReAuthModal && <SupervisorReAuthModal onClose={() => setShowReAuthModal(false)} onSuccess={handleReAuthSuccess} />}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<{ users: User[] }>({ queryKey: ["users"], queryFn: fetchUsers });

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", fullName: "", password: "", role: "receptionist" });
  const [mutationError, setMutationError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => deleteUser(userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setMutationError(null); },
    onError: (err: Error) => { setMutationError(err?.message || "Delete failed"); }
  });
  const createMutation = useMutation({
    mutationFn: (data: { username: string; fullName: string; password: string; role: string }) => createUser(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setShowCreate(false); setCreateForm({ username: "", fullName: "", password: "", role: "receptionist" }); setMutationError(null); },
    onError: (err: Error) => { setMutationError(err?.message || "Create failed"); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["users"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-sm description-center">{data?.users?.length ?? 0} users</span>
        <button onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">{showCreate ? "Cancel" : "Add User"}</button>
      </div>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} placeholder="Username" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.fullName} onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })} placeholder="Full Name" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="Password" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm">
              <option value="receptionist">Receptionist</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </div>
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.username || !createForm.fullName || !createForm.password} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">Create</button>
        </div>
      )}

      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {data?.users?.map((u) => (
          <li key={u.id} className="py-3 flex items-center justify-between">
            <div className="text-start">
              <p className="font-medium text-stone-900 dark:text-white">{u.fullName}</p>
              <p className="text-sm description-center">@{u.username} - {u.role}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.isActive ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                {u.isActive ? t("settings.active") : t("settings.inactive")}
              </span>
              <button
                onClick={() => { if (window.confirm("Delete this user?")) deleteMutation.mutate(u.id); }}
                className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const limit = 50;
  const { data, isLoading, error } = useQuery({ queryKey: ["audit", limit], queryFn: () => fetchAuditEntries(limit) });

  const handleExport = async () => {
    try {
      await exportAuditCSV();
    } catch {
      // Browser handles errors naturally
    }
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["audit", String(limit)])} />;
    return <QueryError message={msg} />;
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm description-center">{t("settings.showingLastEntries", { count: limit })}</p>
        <button onClick={handleExport} className="btn-secondary text-xs">
          Export CSV
        </button>
      </div>
      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <ul className="space-y-2">
          {data?.entries?.slice(0, 10).map((entry: any) => (
            <li key={entry.id} className="p-3 bg-stone-50 dark:bg-stone-700 rounded-lg text-sm">
              <p className="text-stone-900 dark:text-white font-medium">{entry.actionType} - {entry.entityType}</p>
              <p className="description-center text-xs mt-1">{formatDateTimeLy(entry.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamTypesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["exam-types"], queryFn: fetchExamTypes });
  const { data: modalityData } = useQuery({ queryKey: ["modalities", "all"], queryFn: () => fetchModalitiesSettings(true) });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ modalityId: "", name_ar: "", name_en: "" });
  const [mutationError, setMutationError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteExamType(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["exam-types"] }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Delete failed"); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateExamType(id, {
      modalityId: data.modalityId,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      is_active: data.is_active
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["exam-types"] }); setEditingId(null); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); }
  });
  const createMutation = useMutation({
    mutationFn: (data: any) => createExamType({
      modalityId: data.modalityId ? parseInt(data.modalityId, 10) : undefined,
      nameAr: data.name_ar,
      nameEn: data.name_en
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["exam-types"] }); setShowCreate(false); setCreateForm({ modalityId: "", name_ar: "", name_en: "" }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Create failed"); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["exam-types"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  const modalityOptions = ((modalityData as any)?.modalities ?? []).map((m: any) => ({
    value: m.id,
    label: chooseLocalized(language, m.name_ar, m.name_en) || m.code || `Modality ${m.id}`
  }));

  const startEdit = (et: any) => {
    setEditingId(et.id);
    setEditForm({ modalityId: et.modality_id, name_ar: et.name_ar, name_en: et.name_en, is_active: et.is_active });
  };

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-sm description-center">{(data as any)?.examTypes?.length ?? 0} exam types</span>
        <button onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">{showCreate ? "Cancel" : "Add Exam Type"}</button>
      </div>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} placeholder="Name (EN)" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} placeholder="Name (AR)" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            {modalityOptions.length > 0 ? (
              <select value={createForm.modalityId} onChange={(e) => setCreateForm({ ...createForm, modalityId: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm">
                <option value="">{t("settings.selectModality")}</option>
                {modalityOptions.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input value={createForm.modalityId} onChange={(e) => setCreateForm({ ...createForm, modalityId: e.target.value })} placeholder={t("settings.selectModality")} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            )}
          </div>
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.name_en} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">Create</button>
        </div>
      )}

      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {(data as any)?.examTypes?.map((et: any) => (
          <li key={et.id} className="py-3">
            {editingId === et.id ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editForm.name_en} onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: et.id, data: editForm })} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded">Save</button>
                  <button onClick={() => { setEditingId(null); setMutationError(null); }} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-start">
                  <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, et.name_ar, et.name_en)}</p>
                  <p className="description-center text-sm">
                    Modality: {modalityOptions.find((o: any) => String(o.value) === String(et.modality_id))?.label ?? "Not assigned"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(et)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  <button onClick={() => { if (window.confirm("Delete this exam type?")) deleteMutation.mutate(et.id); }} className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Delete</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModalitiesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["modalities", "all"], queryFn: () => fetchModalitiesSettings(true) });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ code: "", name_ar: "", name_en: "", daily_capacity: 0, is_active: true, general_instruction_ar: "", general_instruction_en: "", safety_warning_ar: "", safety_warning_en: "", safety_warning_enabled: true });
  const [mutationError, setMutationError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteModality(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Delete failed"); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateModality(id, {
      code: data.code,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      dailyCapacity: data.daily_capacity,
      isActive: data.is_active ? "enabled" : "disabled",
      generalInstructionAr: data.general_instruction_ar,
      generalInstructionEn: data.general_instruction_en,
      safetyWarningAr: data.safety_warning_ar,
      safetyWarningEn: data.safety_warning_en,
      safetyWarningEnabled: data.safety_warning_enabled
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setEditingId(null);
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); }
  });
  const createMutation = useMutation({
    mutationFn: (data: any) => createModality({
      code: data.code,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      dailyCapacity: data.daily_capacity,
      isActive: data.is_active ? "enabled" : "disabled",
      generalInstructionAr: data.general_instruction_ar,
      generalInstructionEn: data.general_instruction_en,
      safetyWarningAr: data.safety_warning_ar,
      safetyWarningEn: data.safety_warning_en,
      safetyWarningEnabled: data.safety_warning_enabled
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      setShowCreate(false);
      setCreateForm({ code: "", name_ar: "", name_en: "", daily_capacity: 0, is_active: true, general_instruction_ar: "", general_instruction_en: "", safety_warning_ar: "", safety_warning_en: "", safety_warning_enabled: true });
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Create failed"); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["modalities"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  const startEdit = (m: any) => {
    setEditingId(m.id);
    setEditForm({
      code: m.code,
      name_ar: m.name_ar,
      name_en: m.name_en,
      daily_capacity: m.daily_capacity ?? 0,
      is_active: m.is_active,
      general_instruction_ar: m.general_instruction_ar || "",
      general_instruction_en: m.general_instruction_en || "",
      safety_warning_ar: m.safety_warning_ar || "",
      safety_warning_en: m.safety_warning_en || "",
      safety_warning_enabled: m.safety_warning_enabled !== false
    });
  };

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      <p className="text-sm description-center">
        Showing all configured modalities, including inactive ones.
      </p>
      <div className="flex justify-between items-center">
        <span className="text-sm description-center">{(data as any)?.modalities?.length ?? 0} modalities</span>
        <button onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">{showCreate ? "Cancel" : "Add Modality"}</button>
      </div>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} placeholder="Code" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} placeholder="Name (EN)" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} placeholder="Name (AR)" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input type="number" value={createForm.daily_capacity} onChange={(e) => setCreateForm({ ...createForm, daily_capacity: parseInt(e.target.value) || 0 })} placeholder="Daily Capacity" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea value={createForm.general_instruction_ar} onChange={(e) => setCreateForm({ ...createForm, general_instruction_ar: e.target.value })} placeholder="Modality Notes (Arabic)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
            <textarea value={createForm.general_instruction_en} onChange={(e) => setCreateForm({ ...createForm, general_instruction_en: e.target.value })} placeholder="Modality Notes (English)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={createForm.safety_warning_enabled} onChange={(e) => setCreateForm({ ...createForm, safety_warning_enabled: e.target.checked })} className="rounded" /> Safety Warning Enabled</label>
          </div>
          {createForm.safety_warning_enabled && (
            <div className="grid grid-cols-2 gap-2">
              <textarea value={createForm.safety_warning_ar} onChange={(e) => setCreateForm({ ...createForm, safety_warning_ar: e.target.value })} placeholder="Safety Warning (Arabic)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
              <textarea value={createForm.safety_warning_en} onChange={(e) => setCreateForm({ ...createForm, safety_warning_en: e.target.value })} placeholder="Safety Warning (English)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
            </div>
          )}
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.code || !createForm.name_en} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">Create</button>
        </div>
      )}

      {((data as any)?.modalities?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-4 text-sm text-stone-500 dark:text-stone-400">
          No modalities are configured yet.
        </div>
      ) : (
      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {(data as any)?.modalities?.map((m: any) => (
          <li key={m.id} className="py-3">
            {editingId === m.id ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.name_en} onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input type="number" value={editForm.daily_capacity} onChange={(e) => setEditForm({ ...editForm, daily_capacity: parseInt(e.target.value) || 0 })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <textarea value={editForm.general_instruction_ar} onChange={(e) => setEditForm({ ...editForm, general_instruction_ar: e.target.value })} placeholder="Modality Notes (Arabic)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
                  <textarea value={editForm.general_instruction_en} onChange={(e) => setEditForm({ ...editForm, general_instruction_en: e.target.value })} placeholder="Modality Notes (English)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={editForm.safety_warning_enabled} onChange={(e) => setEditForm({ ...editForm, safety_warning_enabled: e.target.checked })} className="rounded" /> Safety Warning Enabled</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" /> Active</label>
                </div>
                {editForm.safety_warning_enabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <textarea value={editForm.safety_warning_ar} onChange={(e) => setEditForm({ ...editForm, safety_warning_ar: e.target.value })} placeholder="Safety Warning (Arabic)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
                    <textarea value={editForm.safety_warning_en} onChange={(e) => setEditForm({ ...editForm, safety_warning_en: e.target.value })} placeholder="Safety Warning (English)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: m.id, data: editForm })} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded">Save</button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-start">
                  <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, m.name_ar, m.name_en) || m.code || `Modality ${m.id}`}</p>
                  <p className="text-sm description-center">{t("settings.capacity")}: {m.daily_capacity ?? "-"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {m.is_active ? t("settings.active") : t("settings.inactive")}
                  </span>
                  <button onClick={() => startEdit(m)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  <button onClick={() => { if (window.confirm("Delete this modality?")) deleteMutation.mutate(m.id); }} className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Delete</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

function NameDictionarySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["name-dictionary"], queryFn: fetchNameDictionary });

  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arabicText: "", englishText: "" });
  const [mutationError, setMutationError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteNameDictionaryEntry(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Delete failed"); }
  });
  const deleteAllMutation = useMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await deleteNameDictionaryEntry(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Delete all failed"); }
  });
  const updateMutation = useMutation({
    mutationFn: (_data: { arabicText: string; englishText: string }) => upsertNameDictionaryEntry(_data.arabicText, _data.englishText),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setEditingId(null); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); }
  });
  const importMutation = useMutation({
    mutationFn: (entries: { arabicText: string; englishText: string }[]) => importNameDictionary(entries),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Import failed"); }
  });

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).filter(Boolean);
        // Skip header row if present; expect: arabic,english per line
        const entries = lines
          .map((line) => {
            const parts = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
            if (parts.length >= 2 && parts[0] && parts[1]) {
              return { arabicText: parts[0], englishText: parts[1] };
            }
            return null;
          })
          .filter(Boolean) as { arabicText: string; englishText: string }[];
        if (entries.length === 0) {
          setMutationError("No valid entries found in CSV. Expected format: arabic,english per line.");
          return;
        }
        if (window.confirm(`Import ${entries.length} entries from CSV? This will upsert (update existing or create new).`)) {
          importMutation.mutate(entries);
        }
      } catch {
        setMutationError("Failed to parse CSV file.");
      }
    };
    reader.readAsText(file);
    // Reset file input
    e.target.value = "";
  };

  const handleDeleteAll = () => {
    const entries = data?.entries ?? [];
    if (entries.length === 0) return;
    if (window.confirm(`Delete all ${entries.length} dictionary entries? This cannot be undone.`)) {
      deleteAllMutation.mutate(entries.map((e: any) => e.id));
    }
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["name-dictionary"])} />;
    return <QueryError message={msg} />;
  }

  const allEntries = data?.entries ?? [];
  const filteredEntries = searchQuery
    ? allEntries.filter((e: any) =>
        e.arabicText?.includes(searchQuery) ||
        e.englishText?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allEntries;

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Arabic or English…"
            className="w-full px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none"
          />
        </div>
        <span className="text-sm description-center">{filteredEntries.length} / {allEntries.length} entries</span>
        <label className="btn-secondary text-xs cursor-pointer">
          Import CSV
          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleCsvImport}
            className="hidden"
            disabled={importMutation.isPending}
          />
        </label>
        {allEntries.length > 0 && (
          <button onClick={handleDeleteAll} disabled={deleteAllMutation.isPending} className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50">
            {deleteAllMutation.isPending ? "Deleting…" : "Delete All"}
          </button>
        )}
      </div>

      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400 sticky top-0">
              <tr>
                <th className="text-start p-2">Arabic</th>
                <th className="text-start p-2">English</th>
                <th className="p-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {filteredEntries.length === 0 ? (
                <tr><td colSpan={3} className="p-8 text-center text-stone-500 dark:text-stone-400">
                  {searchQuery ? "No entries match your search" : "No dictionary entries"}
                </td></tr>
              ) : (
                filteredEntries.map((e: any) => (
                  <tr key={e.id} className="hover:bg-stone-50 dark:hover:bg-stone-700/30 transition-colors">
                    {editingId === e.id ? (
                      <>
                        <td className="p-2">
                          <input value={editForm.arabicText} onChange={(ev) => setEditForm({ ...editForm, arabicText: ev.target.value })} className="w-full px-2 py-1 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white input-rtl" />
                        </td>
                        <td className="p-2">
                          <input value={editForm.englishText} onChange={(ev) => setEditForm({ ...editForm, englishText: ev.target.value })} className="w-full px-2 py-1 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white input-ltr" />
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending} className="px-2 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 rounded hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors">Save</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-xs bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 rounded">Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-2 text-stone-900 dark:text-white input-rtl">{e.arabicText}</td>
                        <td className="p-2 text-stone-700 dark:text-stone-300 input-ltr">{e.englishText}</td>
                        <td className="p-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => { setEditingId(e.id); setEditForm({ arabicText: e.arabicText, englishText: e.englishText }); }} className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                            <button onClick={() => { if (window.confirm(`Delete "${e.arabicText}"?`)) deleteMutation.mutate(e.id); }} className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Delete</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -- Settings Catalog: known keys → display labels, control types, and dropdown options --
interface SettingControl {
  label: string;
  type: "dropdown" | "number" | "time" | "text";
  options?: { value: string; label: string }[];
  min?: string;
  max?: string;
  step?: string;
}

const SETTINGS_CATALOG: Record<string, SettingControl> = {
  // Patient Registration
  phone1_required: { label: "Phone 1 Required", type: "dropdown", options: [
    { value: "required", label: "Required" },
    { value: "optional", label: "Optional" }
  ]},
  dob_or_age_rule: { label: "DOB / Age Rule", type: "dropdown", options: [
    { value: "age_or_dob_required", label: "Age or DOB Required" },
    { value: "age_required", label: "Age Required" },
    { value: "dob_required", label: "DOB Required" }
  ]},
  national_id_required: { label: "National ID Required", type: "dropdown", options: [
    { value: "required", label: "Required" },
    { value: "optional", label: "Optional" }
  ]},
  custom_fields_scope: { label: "Custom Fields Scope", type: "dropdown", options: [
    { value: "all_patients", label: "All Patients" },
    { value: "disabled", label: "Disabled" }
  ]},

  // Scheduling & Capacity
  capacity_mode: { label: "Capacity Mode", type: "dropdown", options: [
    { value: "per_modality_per_day", label: "Per Modality Per Day" },
    { value: "global", label: "Global" }
  ]},
  calendar_window_days: { label: "Calendar Window (Days)", type: "number", min: "1", max: "90" },
  double_booking_prevention: { label: "Double Booking Prevention", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]},
  overbooking_reason_required: { label: "Overbooking Reason Required", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]},
  allow_friday_appointments: { label: "Allow Friday Appointments", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]},
  allow_saturday_appointments: { label: "Allow Saturday Appointments", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]},

  // Queue & Arrival
  barcode_check_in: { label: "Barcode Check-In", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]},
  walk_in_queue: { label: "Walk-In Queue", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]},
  no_show_review_time: { label: "No-Show Review Time", type: "time" },
  no_show_confirmation_required: { label: "No-Show Confirmation Required", type: "dropdown", options: [
    { value: "enabled", label: "Enabled" },
    { value: "disabled", label: "Disabled" }
  ]}
};

function inferSettingControl(key: string, value: any): SettingControl {
  const known = SETTINGS_CATALOG[key];
  if (known) return known;

  // Fallback inference for unknown keys
  const strVal = String(value).toLowerCase();
  if (strVal === "enabled" || strVal === "disabled") {
    return { label: key.replace(/_/g, " "), type: "dropdown", options: [
      { value: "enabled", label: "Enabled" },
      { value: "disabled", label: "Disabled" }
    ]};
  }
  if (strVal === "required" || strVal === "optional") {
    return { label: key.replace(/_/g, " "), type: "dropdown", options: [
      { value: "required", label: "Required" },
      { value: "optional", label: "Optional" }
    ]};
  }
  if (/^\d+$/.test(strVal)) {
    return { label: key.replace(/_/g, " "), type: "number" };
  }
  if (/^\d{2}:\d{2}$/.test(strVal)) {
    return { label: key.replace(/_/g, " "), type: "time" };
  }
  return { label: key.replace(/_/g, " "), type: "text" };
}

function SimpleSettingsSection({ category, onReAuthRequired }: { category: string; onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings", category], queryFn: () => fetchSettings(category) });

  const [mutationError, setMutationError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (payload: { entries: { key: string; value: any }[] }) => saveSettings(category, payload),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["settings", category] }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Save failed"); }
  });

  const handleSave = (key: string, value: any) => {
    saveMutation.mutate({ entries: [{ key, value }] });
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", category])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <div className="space-y-3">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}
      {Object.entries(data || {}).map(([key, value]: [string, any]) => {
        const control = inferSettingControl(key, value);
        const isPending = saveMutation.variables?.entries?.some((e) => e.key === key) && saveMutation.isPending;
        return (
          <div key={key} className="flex items-center justify-between p-3 bg-stone-50 dark:bg-stone-700 rounded-lg">
            <span className="text-stone-700 dark:text-stone-300 font-medium text-sm">{control.label}</span>
            <div className="flex items-center gap-2">
              {control.type === "dropdown" && control.options && (
                <select
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50"
                >
                  {control.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {control.type === "number" && (
                <input
                  type="number"
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  className="w-20 px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50 text-right"
                />
              )}
              {control.type === "time" && (
                <input
                  type="time"
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50"
                />
              )}
              {control.type === "text" && (
                <span className="text-stone-900 dark:text-white text-sm">{String(value)}</span>
              )}
              {isPending && (
                <span className="w-4 h-4 border-2 border-stone-300 border-t-teal-600 rounded-full animate-spin" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const BackupRestoreSection = forwardRef<{ onReAuthSuccess: () => void }, { onReAuthRequired: (key: string[]) => void }>(
  function BackupRestoreSection({ onReAuthRequired }, ref) {
  const { t } = useLanguage();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<unknown>(null);

  useImperativeHandle(ref, () => ({
    onReAuthSuccess: handleReAuthSuccess
  }));

  const doRestore = async (payload: unknown) => {
    const response = await fetch("/api/admin/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const responseData = await response.json().catch(() => null);

    if (!response.ok) {
      // Backend returns { error: { code: number, message: string } }
      const errorMsg =
        (responseData?.error && typeof responseData.error === "object" && responseData.error.message) ||
        responseData?.message ||
        (responseData?.error && typeof responseData.error === "string" ? responseData.error : null) ||
        `HTTP ${response.status}`;

      // 403 = re-auth required — trigger modal instead of showing error
      if (response.status === 403) {
        setPendingPayload(payload);
        onReAuthRequired(["admin", "restore"]);
        throw new Error("REAUTH_REQUIRED");
      }

      console.error("[Restore] Server error:", response.status, responseData);
      throw new Error(errorMsg);
    }

    console.log("[Restore] Success:", responseData);
    setRestoreMessage({ type: "success", text: "Backup restored successfully! The page will reload..." });
    setRestoreFile(null);
    setPendingPayload(null);
    setTimeout(() => window.location.reload(), 2000);
  };

  const handleRestore = async () => {
    if (!restoreFile) return;

    if (!confirm(
      "⚠️ WARNING: This will DELETE ALL existing data and replace it with the backup.\n\nAre you sure you want to continue?"
    )) {
      return;
    }

    setRestoreBusy(true);
    setRestoreMessage(null);

    try {
      const content = await restoreFile.text();
      const payload = JSON.parse(content);
      await doRestore(payload);
    } catch (err) {
      if (err instanceof Error && err.message === "REAUTH_REQUIRED") {
        setRestoreMessage({ type: "error", text: "Re-authentication required. After re-authenticating, click Restore again." });
      } else {
        const message = err instanceof Error ? err.message : "Restore failed.";
        console.error("[Restore] Failed:", err);
        setRestoreMessage({ type: "error", text: message });
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  // Auto-retry restore after successful re-auth
  const handleReAuthSuccess = async () => {
    if (pendingPayload) {
      setRestoreBusy(true);
      setRestoreMessage({ type: "success", text: "Re-authenticated. Retrying restore..." });
      try {
        await doRestore(pendingPayload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Restore failed.";
        setRestoreMessage({ type: "error", text: message });
      } finally {
        setRestoreBusy(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <p className="description-center">{t("settings.backupInfo")}</p>

      {restoreMessage && (
        <div className={`p-3 rounded-lg border text-sm ${
          restoreMessage.type === "success"
            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
        }`}>
          {restoreMessage.text}
        </div>
      )}

      <div className="space-y-3">
        {/* Download backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Export</h4>
          <a href="/api/admin/backup" className="btn-primary text-sm inline-block">
            {t("settings.downloadBackup")}
          </a>
        </div>

        <hr className="border-stone-200 dark:border-stone-700" />

        {/* Restore from backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Restore</h4>
          <div className="flex gap-3 items-start">
            <input
              type="file"
              accept=".json"
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-stone-100 dark:file:bg-stone-700 file:text-stone-700 dark:file:text-stone-300 file:hover:bg-stone-200 dark:file:hover:bg-stone-600 file:cursor-pointer file:transition-colors"
              disabled={restoreBusy}
            />
            <button
              onClick={handleRestore}
              disabled={restoreBusy || !restoreFile}
              className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {restoreBusy ? "Restoring..." : "Restore"}
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            ⚠️ Restoring will delete all current data (patients, appointments, settings, etc.) and replace it with the backup.
          </p>
        </div>
      </div>
    </div>
  );
  });


function SchedulingEngineConfigSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // Lookup data for dropdowns
  const { data: modalityLookup } = useQuery({
    queryKey: ["modalities-settings"],
    queryFn: () => fetchModalitiesSettings(true),
    staleTime: 1000 * 60 * 10
  });
  const { data: examTypeLookup } = useQuery({
    queryKey: ["exam-types-settings"],
    queryFn: fetchExamTypes,
    staleTime: 1000 * 60 * 10
  });

  type CategoryLimitRow = {
    id?: number;
    modalityId: string;
    caseCategory: "oncology" | "non_oncology";
    dailyLimit: string;
    isActive: boolean;
  };
  type BlockedRuleRow = {
    id?: number;
    modalityId: string;
    ruleType: "specific_date" | "date_range" | "yearly_recurrence";
    specificDate: string;
    startDate: string;
    endDate: string;
    recurStartMonth: string;
    recurStartDay: string;
    recurEndMonth: string;
    recurEndDay: string;
    isOverridable: boolean;
    isActive: boolean;
    title: string;
    notes: string;
  };
  type ExamRuleRow = {
    id?: number;
    modalityId: string;
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    effectMode: "hard_restriction" | "restriction_overridable";
    specificDate: string;
    startDate: string;
    endDate: string;
    weekday: string;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string;
    examTypeIds: number[];
    isActive: boolean;
    title: string;
    notes: string;
  };
  type SpecialQuotaRow = {
    id?: number;
    examTypeId: string;
    dailyExtraSlots: string;
    isActive: boolean;
  };
  type SpecialReasonRow = {
    code: string;
    labelEn: string;
    labelAr: string;
    isActive: boolean;
  };
  type IdentifierTypeRow = {
    id?: number;
    code: string;
    labelEn: string;
    labelAr: string;
    isActive: boolean;
  };
  type SchedulingDraft = {
    categoryLimits: CategoryLimitRow[];
    blockedRules: BlockedRuleRow[];
    examRules: ExamRuleRow[];
    specialQuotas: SpecialQuotaRow[];
    specialReasons: SpecialReasonRow[];
    identifierTypes: IdentifierTypeRow[];
  };

  const emptyDraft = (): SchedulingDraft => ({
    categoryLimits: [],
    blockedRules: [],
    examRules: [],
    specialQuotas: [],
    specialReasons: [],
    identifierTypes: []
  });
  const [draft, setDraft] = useState<SchedulingDraft>(emptyDraft());
  const { data, isLoading, error } = useQuery({
    queryKey: ["scheduling-engine-config"],
    queryFn: fetchSchedulingEngineConfig
  });

  const asArray = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const asText = (value: unknown): string => String(value ?? "").trim();
  const asDate = (value: unknown): string => String(value ?? "").slice(0, 10);
  const asBool = (value: unknown, fallback = true): boolean => {
    if (typeof value === "boolean") return value;
    const raw = String(value ?? "").toLowerCase();
    if (["1", "true", "yes", "enabled", "on"].includes(raw)) return true;
    if (["0", "false", "no", "disabled", "off"].includes(raw)) return false;
    return fallback;
  };
  const asNum = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  };

  // Build modality options for dropdowns
  const modalityOptions = useMemo(() => {
    const rows = Array.isArray(modalityLookup?.modalities) ? modalityLookup.modalities : [];
    return rows
      .filter((m: any) => m.isActive !== false)
      .map((m: any) => ({ value: String(m.id), label: m.nameEn || m.name_en || `Modality ${m.id}` }));
  }, [modalityLookup]);

  // Build exam type options for dropdowns
  const examTypeOptions = useMemo(() => {
    const rows = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((et: any) => et.isActive !== false)
      .map((et: any) => ({ value: String(et.id), label: et.nameEn || et.name_en || `Exam ${et.id}` }));
  }, [examTypeLookup]);

  const normalizeConfig = (raw: SchedulingEngineConfig): SchedulingDraft => {
    const categoryLimits = asArray(raw.categoryLimits).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      caseCategory: (asText(row.caseCategory ?? row.case_category) === "oncology" ? "oncology" : "non_oncology") as
        | "oncology"
        | "non_oncology",
      dailyLimit: asText(row.dailyLimit ?? row.daily_limit ?? 0),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const blockedRules = asArray(raw.blockedRules).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      ruleType: (asText(row.ruleType ?? row.rule_type) as BlockedRuleRow["ruleType"]) || "specific_date",
      specificDate: asDate(row.specificDate ?? row.specific_date),
      startDate: asDate(row.startDate ?? row.start_date),
      endDate: asDate(row.endDate ?? row.end_date),
      recurStartMonth: asText(row.recurStartMonth ?? row.recur_start_month),
      recurStartDay: asText(row.recurStartDay ?? row.recur_start_day),
      recurEndMonth: asText(row.recurEndMonth ?? row.recur_end_month),
      recurEndDay: asText(row.recurEndDay ?? row.recur_end_day),
      isOverridable: asBool(row.isOverridable ?? row.is_overridable, false),
      isActive: asBool(row.isActive ?? row.is_active, true),
      title: asText(row.title),
      notes: asText(row.notes)
    }));
    const examRules = asArray(raw.examRules).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      ruleType: (asText(row.ruleType ?? row.rule_type) as ExamRuleRow["ruleType"]) || "specific_date",
      effectMode:
        (asText(row.effectMode ?? row.effect_mode) as ExamRuleRow["effectMode"]) || "restriction_overridable",
      specificDate: asDate(row.specificDate ?? row.specific_date),
      startDate: asDate(row.startDate ?? row.start_date),
      endDate: asDate(row.endDate ?? row.end_date),
      weekday: asText(row.weekday),
      alternateWeeks: asBool(row.alternateWeeks ?? row.alternate_weeks, false),
      recurrenceAnchorDate: asDate(row.recurrenceAnchorDate ?? row.recurrence_anchor_date),
      examTypeIds: (
        Array.isArray(row.examTypeIds)
          ? (row.examTypeIds as unknown[])
          : Array.isArray(row.exam_type_ids)
            ? (row.exam_type_ids as unknown[])
            : []
      ).map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
      isActive: asBool(row.isActive ?? row.is_active, true),
      title: asText(row.title),
      notes: asText(row.notes)
    }));
    const specialQuotas = asArray(raw.specialQuotas).map((row) => ({
      id: asNum(row.id) ?? undefined,
      examTypeId: asText(row.examTypeId ?? row.exam_type_id),
      dailyExtraSlots: asText(row.dailyExtraSlots ?? row.daily_extra_slots ?? 0),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const specialReasons = asArray(raw.specialReasons).map((row) => ({
      code: asText(row.code),
      labelEn: asText(row.labelEn ?? row.label_en),
      labelAr: asText(row.labelAr ?? row.label_ar),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const identifierTypes = asArray(raw.identifierTypes).map((row) => ({
      id: asNum(row.id) ?? undefined,
      code: asText(row.code),
      labelEn: asText(row.labelEn ?? row.label_en),
      labelAr: asText(row.labelAr ?? row.label_ar),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    return {
      categoryLimits,
      blockedRules,
      examRules,
      specialQuotas,
      specialReasons,
      identifierTypes
    };
  };

  const serializeDraft = (value: SchedulingDraft): SchedulingEngineConfig => ({
    categoryLimits: value.categoryLimits
      .filter((row) => row.modalityId.trim() && row.dailyLimit.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        caseCategory: row.caseCategory,
        dailyLimit: Number(row.dailyLimit),
        isActive: row.isActive
      })),
    blockedRules: value.blockedRules
      .filter((row) => row.modalityId.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        ruleType: row.ruleType,
        specificDate: row.specificDate || null,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        recurStartMonth: row.recurStartMonth ? Number(row.recurStartMonth) : null,
        recurStartDay: row.recurStartDay ? Number(row.recurStartDay) : null,
        recurEndMonth: row.recurEndMonth ? Number(row.recurEndMonth) : null,
        recurEndDay: row.recurEndDay ? Number(row.recurEndDay) : null,
        isOverridable: row.isOverridable,
        isActive: row.isActive,
        title: row.title,
        notes: row.notes
      })),
    examRules: value.examRules
      .filter((row) => row.modalityId.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        ruleType: row.ruleType,
        effectMode: row.effectMode,
        specificDate: row.specificDate || null,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        weekday: row.weekday ? Number(row.weekday) : null,
        alternateWeeks: row.alternateWeeks,
        recurrenceAnchorDate: row.recurrenceAnchorDate || null,
        examTypeIds: row.examTypeIds,
        isActive: row.isActive,
        title: row.title,
        notes: row.notes
      })),
    specialQuotas: value.specialQuotas
      .filter((row) => row.examTypeId.trim() && row.dailyExtraSlots.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        examTypeId: Number(row.examTypeId),
        dailyExtraSlots: Number(row.dailyExtraSlots),
        isActive: row.isActive
      })),
    specialReasons: value.specialReasons
      .filter((row) => row.code.trim())
      .map((row) => ({
        code: row.code.trim(),
        labelEn: row.labelEn.trim(),
        labelAr: row.labelAr.trim(),
        isActive: row.isActive
      })),
    identifierTypes: value.identifierTypes
      .filter((row) => row.code.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        code: row.code.trim(),
        labelEn: row.labelEn.trim(),
        labelAr: row.labelAr.trim(),
        isActive: row.isActive
      }))
  });

  useEffect(() => {
    if (data) {
      setDraft(normalizeConfig(data));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: SchedulingEngineConfig) => saveSchedulingEngineConfig(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduling-engine-config"] });
    }
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const validateDraft = (value: SchedulingDraft): string[] => {
    const errors: string[] = [];

    value.categoryLimits.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Daily category limits row ${index + 1}: modality is required.`);
      if (!row.dailyLimit.trim()) errors.push(`Daily category limits row ${index + 1}: daily limit is required.`);
    });

    value.blockedRules.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Blocked dates row ${index + 1}: modality is required.`);
      if (row.ruleType === "specific_date" && !row.specificDate) {
        errors.push(`Blocked dates row ${index + 1}: specific date is required.`);
      }
      if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
        errors.push(`Blocked dates row ${index + 1}: start and end dates are required.`);
      }
      if (row.ruleType === "yearly_recurrence") {
        if (!row.recurStartMonth || !row.recurStartDay) {
          errors.push(`Blocked dates row ${index + 1}: recurrence start month/day is required.`);
        }
      }
    });

    value.examRules.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Exam date rules row ${index + 1}: modality is required.`);
      if (!row.effectMode) errors.push(`Exam date rules row ${index + 1}: effect mode is required.`);
      if ((row.examTypeIds || []).length === 0) errors.push(`Exam date rules row ${index + 1}: select at least one exam type.`);
      if (row.ruleType === "specific_date" && !row.specificDate) {
        errors.push(`Exam date rules row ${index + 1}: specific date is required.`);
      }
      if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
        errors.push(`Exam date rules row ${index + 1}: start and end dates are required.`);
      }
      if (row.ruleType === "weekly_recurrence" && !row.weekday) {
        errors.push(`Exam date rules row ${index + 1}: weekday is required.`);
      }
    });

    value.specialQuotas.forEach((row, index) => {
      if (!row.examTypeId.trim()) errors.push(`Special quotas row ${index + 1}: exam type is required.`);
      if (!row.dailyExtraSlots.trim()) errors.push(`Special quotas row ${index + 1}: extra slots is required.`);
    });

    value.specialReasons.forEach((row, index) => {
      if (!row.code.trim()) errors.push(`Special reason codes row ${index + 1}: code is required.`);
      if (!row.labelEn.trim()) errors.push(`Special reason codes row ${index + 1}: English label is required.`);
      if (!row.labelAr.trim()) errors.push(`Special reason codes row ${index + 1}: Arabic label is required.`);
    });

    value.identifierTypes.forEach((row, index) => {
      if (!row.code.trim()) errors.push(`Patient identifier types row ${index + 1}: code is required.`);
      if (!row.labelEn.trim()) errors.push(`Patient identifier types row ${index + 1}: English label is required.`);
      if (!row.labelAr.trim()) errors.push(`Patient identifier types row ${index + 1}: Arabic label is required.`);
    });

    return errors;
  };

  if (error) {
    const msg = (error as Error).message;
    if ((error as { status?: number })?.status === 403 || msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["scheduling-engine-config"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) {
    return <p className="description-center">{t("settings.loading")}</p>;
  }

  // ---- Small reusable field components ----
  const ModalitySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="input-field text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("settings.selectModality")}</option>
      {modalityOptions.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );

  const ExamTypeMultiSelect = ({ values, onChange }: { values: number[]; onChange: (ids: number[]) => void }) => {
    const toggle = (id: number) => {
      onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
    };
    return (
      <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
        {examTypeOptions.map((opt: { value: string; label: string }) => {
          const id = Number(opt.value);
          const checked = values.includes(id);
          return (
            <label key={opt.value} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${checked ? "bg-teal-50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300" : "bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400"}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="sr-only" />
              {opt.label}
            </label>
          );
        })}
      </div>
    );
  };

  const WeekdaySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="input-field text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select weekday…</option>
      {Object.entries(WEEKDAY_LABELS).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  );

  // ---- Section renderer ----
  const renderSection = (
    key: keyof SchedulingDraft,
    title: string,
    helper: string,
    addRow: () => void,
    renderRow: (row: Record<string, unknown>, index: number) => React.ReactNode
  ) => (
    <section className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium text-sm">{title}</h4>
        <button type="button" className="btn-secondary text-xs" onClick={addRow}>
          {ACTION_LABELS.add[key]}
        </button>
      </div>
      <details className="space-y-2" open>
        <summary className="cursor-pointer list-none text-[11px] text-stone-500 dark:text-stone-400">
          {helper}
        </summary>
        {draft[key].map((row, index) => renderRow(row as Record<string, unknown>, index))}
        {draft[key].length === 0 && (
          <p className="text-[11px] text-stone-400 dark:text-stone-500 italic">No rows configured yet.</p>
        )}
      </details>
    </section>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm description-center">
        Set the booking rules staff use every day. Each section controls one part of appointment access.
      </p>

      {/* A. Category Daily Limits */}
      {renderSection("categoryLimits", SECTION_TITLES.categoryLimits, SECTION_HELPERS.categoryLimits,
        () => setDraft((prev) => ({
          ...prev,
          categoryLimits: [...prev.categoryLimits, { modalityId: "", caseCategory: "non_oncology", dailyLimit: "0", isActive: true }]
        })),
        (row, idx) => (
          <div key={`cl-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.caseCategory as string} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, caseCategory: e.target.value as "oncology" | "non_oncology" } : r) }))}>
              <option value="non_oncology">Non-oncology</option>
              <option value="oncology">Oncology</option>
            </select>
            <input className="input-field text-xs" type="number" min="0" placeholder="Daily limit" value={row.dailyLimit as string} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, dailyLimit: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* B. Modality Blocked Rules */}
      {renderSection("blockedRules", SECTION_TITLES.blockedRules, SECTION_HELPERS.blockedRules,
        () => setDraft((prev) => ({
          ...prev,
          blockedRules: [...prev.blockedRules, { modalityId: "", ruleType: "specific_date", specificDate: "", startDate: "", endDate: "", recurStartMonth: "", recurStartDay: "", recurEndMonth: "", recurEndDay: "", isOverridable: false, isActive: true, title: "", notes: "" }]
        })),
        (row, idx) => (
          <div key={`br-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.ruleType as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, ruleType: e.target.value as BlockedRuleRow["ruleType"] } : r) }))}>
              {Object.entries(RULE_TYPE_LABELS).filter(([k]) => k !== "weekly_recurrence").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {row.ruleType === "specific_date" && (
              <input className="input-field text-xs" type="date" placeholder="Specific date" value={row.specificDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, specificDate: e.target.value } : r) }))} />
            )}
            {row.ruleType === "date_range" && (
              <>
                <input className="input-field text-xs" type="date" placeholder="Start date" value={row.startDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, startDate: e.target.value } : r) }))} />
                <input className="input-field text-xs" type="date" placeholder="End date" value={row.endDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, endDate: e.target.value } : r) }))} />
              </>
            )}
            {row.ruleType === "yearly_recurrence" && (
              <>
                <div className="flex gap-2">
                  <input className="input-field text-xs w-12" type="number" min="1" max="12" placeholder="MM" value={row.recurStartMonth as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurStartMonth: e.target.value } : r) }))} />
                  <input className="input-field text-xs w-12" type="number" min="1" max="31" placeholder="DD" value={row.recurStartDay as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurStartDay: e.target.value } : r) }))} />
                  <span className="text-[10px] text-stone-400 self-center">Recur start</span>
                </div>
                <div className="flex gap-2">
                  <input className="input-field text-xs w-12" type="number" min="1" max="12" placeholder="MM" value={row.recurEndMonth as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurEndMonth: e.target.value } : r) }))} />
                  <input className="input-field text-xs w-12" type="number" min="1" max="31" placeholder="DD" value={row.recurEndDay as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurEndDay: e.target.value } : r) }))} />
                  <span className="text-[10px] text-stone-400 self-center">Recur end</span>
                </div>
              </>
            )}
            <input className="input-field text-xs" placeholder="Title (optional)" value={row.title as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, title: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Notes (optional)" value={row.notes as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isOverridable as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, isOverridable: e.target.checked } : r) }))} /> {ACTION_LABELS.overridable}</label>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* C. Exam Schedule Restriction Rules */}
      {renderSection("examRules", SECTION_TITLES.examRules, SECTION_HELPERS.examRules,
        () => setDraft((prev) => ({
          ...prev,
          examRules: [...prev.examRules, { modalityId: "", ruleType: "specific_date", effectMode: "restriction_overridable", specificDate: "", startDate: "", endDate: "", weekday: "", alternateWeeks: false, recurrenceAnchorDate: "", examTypeIds: [], isActive: true, title: "", notes: "" }]
        })),
        (row, idx) => (
          <div key={`er-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.ruleType as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, ruleType: e.target.value as ExamRuleRow["ruleType"] } : r) }))}>
              <option value="specific_date">{RULE_TYPE_LABELS.specific_date}</option>
              <option value="date_range">{RULE_TYPE_LABELS.date_range}</option>
              <option value="weekly_recurrence">{RULE_TYPE_LABELS.weekly_recurrence}</option>
            </select>
            <select className="input-field text-xs" value={row.effectMode as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, effectMode: e.target.value as ExamRuleRow["effectMode"] } : r) }))}>
              <option value="restriction_overridable">{EFFECT_MODE_LABELS.restriction_overridable}</option>
              <option value="hard_restriction">{EFFECT_MODE_LABELS.hard_restriction}</option>
            </select>
            <div className="md:col-span-1">
              <p className="text-[10px] text-stone-500 mb-1">Choose the exam types this rule applies to.</p>
              <ExamTypeMultiSelect
                values={(row.examTypeIds as number[]) || []}
                onChange={(ids) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, examTypeIds: ids } : r) }))}
              />
            </div>
            {row.ruleType === "specific_date" && (
              <input className="input-field text-xs" type="date" placeholder="Specific date" value={row.specificDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, specificDate: e.target.value } : r) }))} />
            )}
            {row.ruleType === "date_range" && (
              <>
                <input className="input-field text-xs" type="date" placeholder="Start date" value={row.startDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, startDate: e.target.value } : r) }))} />
                <input className="input-field text-xs" type="date" placeholder="End date" value={row.endDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, endDate: e.target.value } : r) }))} />
              </>
            )}
            {row.ruleType === "weekly_recurrence" && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] text-stone-500">Weekday</p>
                  <WeekdaySelect value={row.weekday as string} onChange={(v) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, weekday: v } : r) }))} />
                </div>
                <input className="input-field text-xs" type="date" placeholder="Recurrence anchor date" value={row.recurrenceAnchorDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, recurrenceAnchorDate: e.target.value } : r) }))} />
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.alternateWeeks as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, alternateWeeks: e.target.checked } : r) }))} /> {ACTION_LABELS.alternateWeeks}</label>
              </>
            )}
            <input className="input-field text-xs" placeholder="Title (optional)" value={row.title as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, title: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Notes (optional)" value={row.notes as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, examRules: prev.examRules.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* D. Special Quotas */}
      {renderSection("specialQuotas", SECTION_TITLES.specialQuotas, SECTION_HELPERS.specialQuotas,
        () => setDraft((prev) => ({ ...prev, specialQuotas: [...prev.specialQuotas, { examTypeId: "", dailyExtraSlots: "0", isActive: true }] })),
        (row, idx) => (
          <div key={`sq-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
            <select className="input-field text-xs" value={row.examTypeId as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, examTypeId: e.target.value } : r) }))}>
              <option value="">Select exam type…</option>
              {examTypeOptions.map((opt: { value: string; label: string }) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <input className="input-field text-xs" type="number" min="0" placeholder="Extra slots per day" value={row.dailyExtraSlots as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, dailyExtraSlots: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* E. Special Reason Codes */}
      {renderSection("specialReasons", SECTION_TITLES.specialReasons, SECTION_HELPERS.specialReasons,
        () => setDraft((prev) => ({ ...prev, specialReasons: [...prev.specialReasons, { code: "", labelEn: "", labelAr: "", isActive: true }] })),
        (row, idx) => (
          <div key={`sr-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <input className="input-field text-xs" placeholder="Code" value={row.code as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, code: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="English label" value={row.labelEn as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, labelEn: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Arabic label" value={row.labelAr as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, labelAr: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* F. Patient Identifier Types */}
      {renderSection("identifierTypes", SECTION_TITLES.identifierTypes, SECTION_HELPERS.identifierTypes,
        () => setDraft((prev) => ({ ...prev, identifierTypes: [...prev.identifierTypes, { code: "", labelEn: "", labelAr: "", isActive: true }] })),
        (row, idx) => (
          <div key={`it-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <input className="input-field text-xs" placeholder="Code" value={row.code as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, code: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="English label" value={row.labelEn as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, labelEn: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Arabic label" value={row.labelAr as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, labelAr: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* Save / Reset */}
      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => {
            if (data) setDraft(normalizeConfig(data));
          }}
        >
          {ACTION_LABELS.reset}
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors text-sm"
          onClick={() => {
            const errors = validateDraft(draft);
            setValidationErrors(errors);
            if (errors.length > 0) return;
            saveMutation.mutate(serializeDraft(draft));
          }}
        >
          {saveMutation.isPending ? ACTION_LABELS.saving : ACTION_LABELS.save}
        </button>
      </div>

      {validationErrors.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
          {validationErrors.slice(0, 8).map((error, index) => (
            <p key={`validation-${index}`}>{error}</p>
          ))}
          {validationErrors.length > 8 && <p>...and {validationErrors.length - 8} more.</p>}
        </div>
      )}

      {saveMutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {(saveMutation.error as Error)?.message || "Save failed"}
        </div>
      )}
      {saveMutation.isSuccess && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm">
          Configuration saved successfully.
        </div>
      )}
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{t("settings.failedLoad")}</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("settings.reauthRequired")}</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">{t("settings.reauthHelp")}</p>
      <button onClick={onReAuthRequired} className="btn-primary text-sm">
        {t("common.reAuthenticate")}
      </button>
    </div>
  );
}
