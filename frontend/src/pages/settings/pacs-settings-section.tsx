import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";

const SETTINGS_LOAD_TIMEOUT_MS = 5000;

interface PacsNode {
  id: number;
  name: string;
  host: string;
  port: number;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: number;
  is_active: boolean;
  is_default: boolean;
}

type PacsNodeFormState = {
  name: string;
  host: string;
  port: number;
  called_ae_title: string;
  calling_ae_title: string;
  timeout_seconds: number;
  is_active: boolean;
  is_default: boolean;
};

export default function PacsSettingsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<{ nodes: PacsNode[] }>({
    queryKey: ["pacs", "nodes"],
    queryFn: () => api<{ nodes: PacsNode[] }>("/pacs/nodes", {}, SETTINGS_LOAD_TIMEOUT_MS)
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<{ id: number | null; ok: boolean; message: string } | null>(null);

  const emptyForm: PacsNodeFormState = {
    name: "",
    host: "",
    port: 104,
    called_ae_title: "",
    calling_ae_title: "RISPRO",
    timeout_seconds: 10,
    is_active: true,
    is_default: false
  };

  const [createForm, setCreateForm] = useState<PacsNodeFormState>(emptyForm);
  const [editForm, setEditForm] = useState<PacsNodeFormState>(emptyForm);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Normalize snake_case form state to camelCase payload expected by backend
  const toBackendPayload = (form: Partial<PacsNodeFormState>) => ({
    name: form.name,
    host: form.host,
    port: form.port,
    calledAeTitle: form.called_ae_title,
    callingAeTitle: form.calling_ae_title,
    timeoutSeconds: form.timeout_seconds,
    isActive: form.is_active ? "enabled" : "disabled",
    isDefault: form.is_default ? "enabled" : "disabled"
  });

  const createMutation = useMutation({
    mutationFn: async (data: PacsNodeFormState) => {
      return api("/pacs/nodes", {
        method: "POST",
        body: JSON.stringify(toBackendPayload(data))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "nodes"] });
      setShowCreate(false);
      setCreateForm(emptyForm);
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<PacsNodeFormState> }) => {
      return api(`/pacs/nodes/${id}`, {
        method: "PUT",
        body: JSON.stringify(toBackendPayload(data))
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "nodes"] });
      setEditingId(null);
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api(`/pacs/nodes/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pacs", "nodes"] });
      setMutationError(null);
    },
    onError: (err: Error) => setMutationError(err.message)
  });

  const testMutation = useMutation({
    mutationFn: async (nodeId: number) => {
      setTestingId(nodeId);
      await api("/pacs/test", {
        method: "POST",
        body: JSON.stringify({ nodeId })
      });
      return { ok: true };
    },
    onSuccess: (_data, nodeId) => {
      setTestResult({ id: nodeId, ok: true, message: "Connection successful" });
      setTestingId(null);
    },
    onError: (err: Error, nodeId) => {
      setTestResult({ id: nodeId as number, ok: false, message: err.message });
      setTestingId(null);
    }
  });

  if (error) {
    const status = error instanceof ApiError ? error.status : undefined;
    const msg = (error as Error).message;
    if (status === 401 || status === 403 || msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["pacs", "nodes"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) return <p className="text-sm text-stone-500 dark:text-stone-400">Loading...</p>;

  const startEdit = (node: PacsNode) => {
    setEditingId(node.id);
    setEditForm({
      name: node.name,
      host: node.host,
      port: node.port,
      called_ae_title: node.called_ae_title,
      calling_ae_title: node.calling_ae_title,
      timeout_seconds: node.timeout_seconds,
      is_active: node.is_active,
      is_default: node.is_default
    });
  };

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button type="button" onClick={() => setMutationError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="flex justify-between items-center">
        <span className="text-sm text-stone-600 dark:text-stone-400">{data?.nodes?.length ?? 0} PACS nodes</span>
        <button type="button" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="btn-secondary text-xs">
          {showCreate ? "Cancel" : "Add PACS Node"}
        </button>
      </div>

      {showCreate && (
        <PacsNodeForm
          form={createForm}
          onChange={setCreateForm}
          onSubmit={() => createMutation.mutate(createForm)}
          isPending={createMutation.isPending}
          onCancel={() => { setShowCreate(false); setCreateForm(emptyForm); }}
        />
      )}

      <ul className="space-y-3">
        {data?.nodes?.map((node) => (
          <li key={node.id} className="p-4 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800">
            {editingId === node.id ? (
              <PacsNodeForm
                form={editForm}
                onChange={setEditForm}
                onSubmit={() => updateMutation.mutate({ id: node.id, data: editForm })}
                isPending={updateMutation.isPending}
                onCancel={() => { setEditingId(null); setMutationError(null); }}
              />
            ) : (
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-stone-900 dark:text-white">{node.name}</span>
                    {node.is_default && (
                      <span className="px-1.5 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 rounded">Default</span>
                    )}
                    {!node.is_active && (
                      <span className="px-1.5 py-0.5 text-xs bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400 rounded">Inactive</span>
                    )}
                  </div>
                  <div className="text-xs text-stone-600 dark:text-stone-400 mt-1 font-mono">
                    {node.host}:{node.port} | AE: {node.called_ae_title} | Timeout: {node.timeout_seconds}s
                  </div>
                  {testResult?.id === node.id && (
                    <div className={`text-xs mt-1 ${testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                      {testResult.ok ? "✓" : "✗"} {testResult.message}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => testMutation.mutate(node.id)}
                    disabled={testingId === node.id}
                    className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {testingId === node.id ? "Testing..." : "Test"}
                  </button>
                  <button type="button" onClick={() => startEdit(node)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  <button
                    type="button"
                    onClick={() => { if (window.confirm(`Delete "${node.name}"?`)) deleteMutation.mutate(node.id); }}
                    className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>

      {data?.nodes?.length === 0 && !showCreate && (
        <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-8">
          No PACS nodes configured. Click "Add PACS Node" to get started.
        </p>
      )}
    </div>
  );
}

function PacsNodeForm({
  form,
  onChange,
  onSubmit,
  isPending,
  onCancel
}: {
  form: PacsNodeFormState;
  onChange: (form: PacsNodeFormState) => void;
  onSubmit: () => void;
  isPending: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-3 text-sm">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <input
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="Node name (e.g. Primary PACS)"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
        <input
          value={form.host}
          onChange={(e) => onChange({ ...form, host: e.target.value })}
          placeholder="Host (IP or hostname)"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
        <input
          type="number"
          value={form.port}
          onChange={(e) => onChange({ ...form, port: parseInt(e.target.value) || 104 })}
          placeholder="Port"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
        <input
          value={form.called_ae_title}
          onChange={(e) => onChange({ ...form, called_ae_title: e.target.value.toUpperCase() })}
          placeholder="Called AE Title (PACS side)"
          maxLength={16}
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
        <input
          value={form.calling_ae_title}
          onChange={(e) => onChange({ ...form, calling_ae_title: e.target.value.toUpperCase() })}
          placeholder="Calling AE Title (RIS side)"
          maxLength={16}
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm font-mono"
        />
        <input
          type="number"
          value={form.timeout_seconds}
          onChange={(e) => onChange({ ...form, timeout_seconds: parseInt(e.target.value) || 10 })}
          placeholder="Timeout (seconds)"
          className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
        />
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => onChange({ ...form, is_active: e.target.checked })}
          />
          Active
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => onChange({ ...form, is_default: e.target.checked })}
          />
          Default node
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !form.name || !form.host || !form.called_ae_title}
          className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">
          Cancel
        </button>
      </div>
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">Failed to load</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Re-authentication required</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">Please re-authenticate to manage PACS nodes.</p>
      <button type="button" onClick={onReAuthRequired} className="btn-primary text-sm">
        Re-authenticate
      </button>
    </div>
  );
}
