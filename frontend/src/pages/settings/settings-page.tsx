import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

const SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: "patient_registration", label: "Patient Registration" },
  { key: "scheduling_and_capacity", label: "Scheduling" },
  { key: "queue_and_arrival", label: "Queue & Arrival" },
  { key: "pacs_connection", label: "PACS Connection" },
  { key: "dicom_gateway", label: "DICOM Gateway" },
  { key: "users", label: "Users" },
  { key: "audit_log", label: "Audit Log" },
  { key: "exam_types", label: "Exam Types" },
  { key: "modalities", label: "Modalities" },
  { key: "name_dictionary", label: "Name Dictionary" },
  { key: "backup_restore", label: "Backup & Restore" }
];

export default function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>("menu");

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold text-stone-900 dark:text-white">Settings</h2>

      {section === "menu" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              className="p-6 bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm hover:border-teal-500 dark:hover:border-teal-500 transition-colors text-right"
            >
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">{s.label}</h3>
              <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">Configure {s.label.toLowerCase()} settings</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setSection("menu")}
            className="px-4 py-2 bg-stone-100 dark:bg-stone-700 hover:bg-stone-200 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-300 font-medium rounded-lg transition-colors text-sm"
          >
            ← Back to Settings Menu
          </button>

          <div className="bg-white dark:bg-stone-800 rounded-xl border border-stone-200 dark:border-stone-700 shadow-sm p-6">
            <h3 className="text-xl font-bold text-stone-900 dark:text-white mb-4">
              {SECTIONS.find((s) => s.key === section)?.label}
            </h3>

            {section === "users" && <UsersSection />}
            {section === "audit_log" && <AuditSection />}
            {section === "exam_types" && <ExamTypesSection />}
            {section === "modalities" && <ModalitiesSection />}
            {section === "name_dictionary" && <NameDictionarySection />}
            {section === "pacs_connection" && <PacsConnectionSection />}
            {section === "patient_registration" && <SimpleSettingsSection category="patient_registration" />}
            {section === "scheduling_and_capacity" && <SimpleSettingsSection category="scheduling_and_capacity" />}
            {section === "queue_and_arrival" && <SimpleSettingsSection category="queue_and_arrival" />}
            {section === "dicom_gateway" && <DicomGatewaySection />}
            {section === "backup_restore" && <BackupRestoreSection />}
          </div>
        </div>
      )}
    </div>
  );
}

function UsersSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-700">
          {(data as any)?.users?.map((u: any) => (
            <li key={u.id} className="py-3 flex items-center justify-between">
              <div className="text-right">
                <p className="font-medium text-stone-900 dark:text-white">{u.full_name}</p>
                <p className="text-sm text-stone-500 dark:text-stone-400">@{u.username} • {u.role}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                {u.is_active ? "Active" : "Inactive"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditSection() {
  const limit = 50;
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit", limit],
    queryFn: () => fetchAuditEntries(limit)
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div>
      <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">Showing last {limit} entries</p>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <ul className="space-y-2">
          {data?.entries?.slice(0, 10).map((entry: any) => (
            <li key={entry.id} className="p-3 bg-stone-50 dark:bg-stone-700 rounded-lg text-sm">
              <p className="text-stone-900 dark:text-white font-medium">{entry.actionType} • {entry.entityType}</p>
              <p className="text-stone-500 dark:text-stone-400 text-xs mt-1">{entry.createdAt}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExamTypesSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["exam-types"],
    queryFn: fetchExamTypes
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-700">
          {(data as any)?.examTypes?.map((et: any) => (
            <li key={et.id} className="py-3">
              <p className="font-medium text-stone-900 dark:text-white">{et.name_en}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">{et.name_ar}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModalitiesSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["modalities"],
    queryFn: fetchModalitiesSettings
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-700">
          {(data as any)?.modalities?.map((m: any) => (
            <li key={m.id} className="py-3 flex items-center justify-between">
              <div className="text-right">
                <p className="font-medium text-stone-900 dark:text-white">{m.name_en}</p>
                <p className="text-sm text-stone-500 dark:text-stone-400">{m.name_ar} • Capacity: {m.daily_capacity ?? "—"}</p>
              </div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                {m.is_active ? "Active" : "Inactive"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NameDictionarySection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["name-dictionary"],
    queryFn: fetchNameDictionary
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div>
      <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
        {data?.entries?.length ?? 0} entries
      </p>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
              <tr>
                <th className="text-right p-2">Arabic</th>
                <th className="text-right p-2">English</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {data?.entries?.slice(0, 20).map((e: any) => (
                <tr key={e.id}>
                  <td className="p-2 text-stone-900 dark:text-white" dir="rtl">{e.arabicText}</td>
                  <td className="p-2 text-stone-700 dark:text-stone-300">{e.englishText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PacsConnectionSection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "pacs_connection"],
    queryFn: fetchPacsConnection
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div className="space-y-3 text-sm">
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <>
          <p className="text-stone-500 dark:text-stone-400">PACS connection settings are configured via the settings API.</p>
          <pre className="bg-stone-50 dark:bg-stone-700 p-4 rounded-lg text-xs overflow-auto">
            {JSON.stringify(data, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}

function SimpleSettingsSection({ category }: { category: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", category],
    queryFn: () => fetchSettings(category)
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) {
      return <QueryError message="Recent supervisor re-authentication is required. Please re-authenticate and try again." />;
    }
    return <QueryError message={msg} />;
  }

  return (
    <div>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <div className="space-y-3">
          {Object.entries(data || {}).map(([key, value]: [string, any]) => (
            <div key={key} className="flex items-center justify-between p-3 bg-stone-50 dark:bg-stone-700 rounded-lg">
              <span className="text-stone-700 dark:text-stone-300 font-medium capitalize">{key.replace(/_/g, " ")}</span>
              <span className="text-stone-900 dark:text-white">{String(value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DicomGatewaySection() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["dicom-devices"],
    queryFn: fetchDicomDevices
  });

  if (error) {
    return <QueryError message={(error as Error).message} />;
  }

  return (
    <div>
      {isLoading ? <p className="text-stone-500">Loading...</p> : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-700">
          {data?.devices?.map((d: any) => (
            <li key={d.id} className="py-3">
              <p className="font-medium text-stone-900 dark:text-white">{d.deviceName}</p>
              <p className="text-sm text-stone-500 dark:text-stone-400">
                AE: {d.modalityAeTitle} • MWL: {d.mwlEnabled ? "Yes" : "No"} • MPPS: {d.mppsEnabled ? "Yes" : "No"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BackupRestoreSection() {
  return (
    <div className="space-y-4">
      <p className="text-stone-500 dark:text-stone-400">Backup and restore functionality is available via the admin API.</p>
      <div className="flex gap-4">
        <a
          href="/api/admin/backup"
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Download Backup
        </a>
      </div>
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">Failed to load settings</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}
