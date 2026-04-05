import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchUsers,
  fetchAuditEntries,
  fetchExamTypes,
  fetchModalitiesSettings,
  fetchNameDictionary,
  fetchDicomDevices,
  fetchSettings,
  fetchPacsConnection
} from "@/lib/api-hooks";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { formatDateTimeLy } from "@/lib/date-format";
import { chooseLocalized, type TranslationKey } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

type SettingsSection =
  | "menu"
  | "patient_registration"
  | "scheduling_and_capacity"
  | "queue_and_arrival"
  | "pacs_connection"
  | "dicom_gateway"
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
  "pacs_connection",
  "dicom_gateway",
  "users",
  "audit_log",
  "exam_types",
  "modalities",
  "name_dictionary",
  "backup_restore"
];

function sectionLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, section: SettingsSection): string {
  return t(`settings.section.${section}` as TranslationKey);
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const [section, setSection] = useState<SettingsSection>("menu");
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingReAuthKeys, setPendingReAuthKeys] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const handleReAuthSuccess = () => {
    setShowReAuthModal(false);
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
            {section === "pacs_connection" && <PacsConnectionSection onReAuthRequired={requestReAuth} />}
            {section === "patient_registration" && <SimpleSettingsSection category="patient_registration" onReAuthRequired={requestReAuth} />}
            {section === "scheduling_and_capacity" && <SimpleSettingsSection category="scheduling_and_capacity" onReAuthRequired={requestReAuth} />}
            {section === "queue_and_arrival" && <SimpleSettingsSection category="queue_and_arrival" onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway" && <DicomGatewaySection onReAuthRequired={requestReAuth} />}
            {section === "backup_restore" && <BackupRestoreSection />}

            {showReAuthModal && <SupervisorReAuthModal onClose={() => setShowReAuthModal(false)} onSuccess={handleReAuthSuccess} />}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const { data, isLoading, error } = useQuery({ queryKey: ["users"], queryFn: fetchUsers });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["users"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <ul className="divide-y divide-stone-200 dark:divide-stone-700">
      {(data as any)?.users?.map((u: any) => (
        <li key={u.id} className="py-3 flex items-center justify-between">
          <div className="text-start">
            <p className="font-medium text-stone-900 dark:text-white">{u.full_name}</p>
            <p className="text-sm description-center">@{u.username} - {u.role}</p>
          </div>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
            {u.is_active ? t("settings.active") : t("settings.inactive")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuditSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const limit = 50;
  const { data, isLoading, error } = useQuery({ queryKey: ["audit", limit], queryFn: () => fetchAuditEntries(limit) });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["audit", String(limit)])} />;
    return <QueryError message={msg} />;
  }
  return (
    <div>
      <p className="text-sm description-center mb-4">{t("settings.showingLastEntries", { count: limit })}</p>
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
  const { data, isLoading, error } = useQuery({ queryKey: ["exam-types"], queryFn: fetchExamTypes });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["exam-types"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <ul className="divide-y divide-stone-200 dark:divide-stone-700">
      {(data as any)?.examTypes?.map((et: any) => (
        <li key={et.id} className="py-3">
          <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, et.name_ar, et.name_en)}</p>
          <p className="description-center text-sm">{et.name_en}</p>
        </li>
      ))}
    </ul>
  );
}

function ModalitiesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const { data, isLoading, error } = useQuery({ queryKey: ["modalities"], queryFn: fetchModalitiesSettings });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["modalities"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <ul className="divide-y divide-stone-200 dark:divide-stone-700">
      {(data as any)?.modalities?.map((m: any) => (
        <li key={m.id} className="py-3 flex items-center justify-between">
          <div className="text-start">
            <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, m.name_ar, m.name_en)}</p>
            <p className="text-sm description-center">{t("settings.capacity")}: {m.daily_capacity ?? "-"}</p>
          </div>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
            {m.is_active ? t("settings.active") : t("settings.inactive")}
          </span>
        </li>
      ))}
    </ul>
  );
}

function NameDictionarySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const { data, isLoading, error } = useQuery({ queryKey: ["name-dictionary"], queryFn: fetchNameDictionary });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["name-dictionary"])} />;
    return <QueryError message={msg} />;
  }
  return (
    <div>
      <p className="text-sm description-center mb-4">{t("settings.entriesCount", { count: data?.entries?.length ?? 0 })}</p>
      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
              <tr>
                <th className="text-start p-2">{t("settings.arabic")}</th>
                <th className="text-start p-2">{t("settings.english")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {data?.entries?.slice(0, 20).map((e: any) => (
                <tr key={e.id}>
                  <td className="p-2 text-stone-900 dark:text-white input-rtl">{e.arabicText}</td>
                  <td className="p-2 text-stone-700 dark:text-stone-300 input-ltr">{e.englishText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PacsConnectionSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings", "pacs_connection"], queryFn: fetchPacsConnection });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "pacs_connection"])} />;
    return <QueryError message={msg} />;
  }
  return (
    <div className="space-y-3 text-sm">
      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <>
          <p className="description-center">{t("settings.pacsConfigured")}</p>
          <pre className="bg-stone-50 dark:bg-stone-700 p-4 rounded-lg text-xs overflow-auto">{JSON.stringify(data, null, 2)}</pre>
        </>
      )}
    </div>
  );
}

function SimpleSettingsSection({ category, onReAuthRequired }: { category: string; onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings", category], queryFn: () => fetchSettings(category) });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", category])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <div className="space-y-3">
      {Object.entries(data || {}).map(([key, value]: [string, any]) => (
        <div key={key} className="flex items-center justify-between p-3 bg-stone-50 dark:bg-stone-700 rounded-lg">
          <span className="text-stone-700 dark:text-stone-300 font-medium capitalize">{key.replace(/_/g, " ")}</span>
          <span className="text-stone-900 dark:text-white">{String(value)}</span>
        </div>
      ))}
    </div>
  );
}

function DicomGatewaySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const { data, isLoading, error } = useQuery({ queryKey: ["dicom-devices"], queryFn: fetchDicomDevices });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["dicom-devices"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <ul className="divide-y divide-stone-200 dark:divide-stone-700">
      {data?.devices?.map((d: any) => (
        <li key={d.id} className="py-3">
          <p className="font-medium text-stone-900 dark:text-white">{d.deviceName}</p>
          <p className="text-sm description-center">
            AE: {d.modalityAeTitle} - MWL: {d.mwlEnabled ? t("settings.yes") : t("settings.no")} - MPPS: {d.mppsEnabled ? t("settings.yes") : t("settings.no")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function BackupRestoreSection() {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <p className="description-center">{t("settings.backupInfo")}</p>
      <div className="flex gap-4">
        <a href="/api/admin/backup" className="btn-primary text-sm">
          {t("settings.downloadBackup")}
        </a>
      </div>
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
