import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLanguage } from "@/providers/language-provider";
import { fetchDicomDevices, createDicomDevice, updateDicomDevice, deleteDicomDevice } from "@/lib/api-hooks";

interface DicomDevicesSectionProps {
  onReAuthRequired: (key: string[]) => void;
}

export default function DicomDevicesSection({ onReAuthRequired }: DicomDevicesSectionProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["dicom-devices"], queryFn: fetchDicomDevices });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ modality_id: "", device_name: "", modality_ae_title: "", scheduled_station_ae_title: "", station_name: "", station_location: "", source_ip: "", mwl_enabled: true, mpps_enabled: true, is_active: true });
  const [mutationError, setMutationError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDicomDevice(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["dicom-devices"] }); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Delete failed"); }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateDicomDevice(id, {
      deviceName: data.device_name,
      modalityAeTitle: data.modality_ae_title,
      scheduledStationAeTitle: data.scheduled_station_ae_title || data.modality_ae_title,
      stationName: data.station_name,
      stationLocation: data.station_location,
      sourceIp: data.source_ip,
      mwlEnabled: data.mwl_enabled ? "enabled" : "disabled",
      mppsEnabled: data.mpps_enabled ? "enabled" : "disabled",
      isActive: data.is_active ? "enabled" : "disabled"
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["dicom-devices"] }); setEditingId(null); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); }
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => createDicomDevice({
      modalityId: parseInt(data.modality_id, 10),
      deviceName: data.device_name,
      modalityAeTitle: data.modality_ae_title,
      scheduledStationAeTitle: data.scheduled_station_ae_title || data.modality_ae_title,
      stationName: data.station_name,
      stationLocation: data.station_location,
      sourceIp: data.source_ip,
      mwlEnabled: data.mwl_enabled ? "enabled" : "disabled",
      mppsEnabled: data.mpps_enabled ? "enabled" : "disabled",
      isActive: data.is_active ? "enabled" : "disabled"
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["dicom-devices"] }); setShowCreate(false); setMutationError(null); },
    onError: (err: any) => { setMutationError(err?.message || "Create failed"); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["dicom-devices"])} />;
    return <QueryError message={msg} />;
  }

  if (isLoading) return <p className="text-sm text-stone-500 dark:text-stone-400">{t("settings.loading")}</p>;

  const startEdit = (d: any) => {
    setEditingId(d.id);
    setEditForm({
      device_name: d.deviceName,
      modality_ae_title: d.modalityAeTitle,
      scheduled_station_ae_title: d.scheduledStationAeTitle,
      station_name: d.stationName,
      station_location: d.stationLocation || "",
      source_ip: d.sourceIp || "",
      mwl_enabled: d.mwlEnabled,
      mpps_enabled: d.mppsEnabled,
      is_active: d.isActive
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

      <div className="flex justify-between items-center">
        <span className="text-sm text-stone-600 dark:text-stone-400">{data?.devices?.length ?? 0} devices</span>
        <button onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">{showCreate ? "Cancel" : "Add Device"}</button>
      </div>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.modality_id} onChange={(e) => setCreateForm({ ...createForm, modality_id: e.target.value })} placeholder="Modality ID" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.device_name} onChange={(e) => setCreateForm({ ...createForm, device_name: e.target.value })} placeholder="Device Name" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.modality_ae_title} onChange={(e) => setCreateForm({ ...createForm, modality_ae_title: e.target.value })} placeholder="AE Title" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.scheduled_station_ae_title} onChange={(e) => setCreateForm({ ...createForm, scheduled_station_ae_title: e.target.value })} placeholder="Scheduled Station AE Title" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.station_name} onChange={(e) => setCreateForm({ ...createForm, station_name: e.target.value })} placeholder="Station Name" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.station_location} onChange={(e) => setCreateForm({ ...createForm, station_location: e.target.value })} placeholder="Station Location" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.source_ip} onChange={(e) => setCreateForm({ ...createForm, source_ip: e.target.value })} placeholder="Source IP" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
          </div>
          <div className="flex gap-3 text-sm">
            <label><input type="checkbox" checked={createForm.mwl_enabled} onChange={(e) => setCreateForm({ ...createForm, mwl_enabled: e.target.checked })} className="mr-1" /> MWL Enabled</label>
            <label><input type="checkbox" checked={createForm.mpps_enabled} onChange={(e) => setCreateForm({ ...createForm, mpps_enabled: e.target.checked })} className="mr-1" /> MPPS Enabled</label>
            <label><input type="checkbox" checked={createForm.is_active} onChange={(e) => setCreateForm({ ...createForm, is_active: e.target.checked })} className="mr-1" /> Active</label>
          </div>
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.modality_id || !createForm.device_name} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">Create</button>
        </div>
      )}

      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {data?.devices?.map((d: any) => (
          <li key={d.id} className="py-3">
            {editingId === d.id ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editForm.device_name} onChange={(e) => setEditForm({ ...editForm, device_name: e.target.value })} placeholder="Device Name" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.modality_ae_title} onChange={(e) => setEditForm({ ...editForm, modality_ae_title: e.target.value })} placeholder="AE Title" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.station_name} onChange={(e) => setEditForm({ ...editForm, station_name: e.target.value })} placeholder="Station Name" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.station_location} onChange={(e) => setEditForm({ ...editForm, station_location: e.target.value })} placeholder="Location" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.source_ip} onChange={(e) => setEditForm({ ...editForm, source_ip: e.target.value })} placeholder="Source IP" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                </div>
                <div className="flex gap-3">
                  <label><input type="checkbox" checked={editForm.mwl_enabled} onChange={(e) => setEditForm({ ...editForm, mwl_enabled: e.target.checked })} className="mr-1" /> MWL</label>
                  <label><input type="checkbox" checked={editForm.mpps_enabled} onChange={(e) => setEditForm({ ...editForm, mpps_enabled: e.target.checked })} className="mr-1" /> MPPS</label>
                  <label><input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="mr-1" /> Active</label>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: d.id, data: editForm })} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded">Save</button>
                  <button onClick={() => { setEditingId(null); setMutationError(null); }} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-start">
                  <p className="font-medium text-stone-900 dark:text-white">{d.deviceName}</p>
                  <p className="text-sm text-stone-600 dark:text-stone-400">
                    AE: {d.modalityAeTitle} | Modality: {d.modalityCode} | MWL: {d.mwlEnabled ? "Yes" : "No"} | MPPS: {d.mppsEnabled ? "Yes" : "No"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${d.isActive ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {d.isActive ? "Active" : "Inactive"}
                  </span>
                  <button onClick={() => startEdit(d)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  <button onClick={() => { if (window.confirm("Delete this DICOM device?")) deleteMutation.mutate(d.id); }} className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Delete</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
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
