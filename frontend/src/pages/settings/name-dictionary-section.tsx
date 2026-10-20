import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNameDictionaryEntry,
  fetchNameDictionary,
  importNameDictionary,
  updateNameDictionaryEntry,
} from "@/lib/api-hooks";
import { Button } from "@/components/shared";
import { dictionaryReadOptions } from "@/lib/name-dictionary-query";
import { DictionaryLoadStatus } from "@/components/name-dictionary/dictionary-load-status";
import { DictionaryCsvError, parseDictionaryCsv, exportDictionaryCsv } from "@/lib/name-dictionary-csv";
import { useLanguage } from "@/providers/language-provider";
import { ReAuthPrompt } from "./settings-section-helpers";
import { mutationErrorMessage } from "./settings-section-utils";

export default function NameDictionarySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const dictionaryQuery = useQuery({ queryKey: ["name-dictionary"], queryFn: fetchNameDictionary, ...dictionaryReadOptions });
  const { data, isLoading, error } = dictionaryQuery;
  const [exporting, setExporting] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arabicText: "", englishText: "" });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [csvImportStage, setCsvImportStage] = useState<"idle" | "reading" | "parsing" | "uploading">("idle");
  const [csvImportCount, setCsvImportCount] = useState(0);
  const isReauthError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return message.includes("re-authentication") || message.includes("403");
  };

  const deleteMutation = useMutation({
    retry: false,
    mutationFn: (id: number) => deleteNameDictionaryEntry(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Delete failed"));
    }
  });
  const deleteAllMutation = useMutation({
    retry: false,
    mutationFn: async (ids: number[]) => { for (const id of ids) await deleteNameDictionaryEntry(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Delete all failed"));
    }
  });
  const updateMutation = useMutation({
    retry: false,
    mutationFn: (_data: { arabicText: string; englishText: string }) => updateNameDictionaryEntry(editingId!, _data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setEditingId(null); setMutationError(null); },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Update failed"));
    }
  });
  const importMutation = useMutation({
    retry: false,
    mutationFn: (entries: { arabicText: string; englishText: string }[]) => importNameDictionary(entries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });
      setMutationError(null);
      setCsvImportStage("idle");
      setCsvImportCount(0);
    },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        setCsvImportStage("idle");
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Import failed"));
      setCsvImportStage("idle");
    }
  });

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvImportStage("reading");
    setCsvImportCount(0);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        setCsvImportStage("parsing");
        const entries = parseDictionaryCsv(String(ev.target?.result || ""));
        setCsvImportCount(entries.length);
        if (window.confirm(`Import ${entries.length} entries from CSV? This will upsert (update existing or create new).`)) {
          setCsvImportStage("uploading");
          importMutation.mutate(entries);
        } else {
          setCsvImportStage("idle");
        }
      } catch (error) {
        setMutationError(error instanceof DictionaryCsvError ? t(`nameDictionary.csv.${error.reason}`, { row: error.row }) : t("nameDictionary.importFailed"));
        setCsvImportStage("idle");
      }
    };
    reader.onerror = () => {
      setMutationError("Failed to read CSV file.");
      setCsvImportStage("idle");
    };
    reader.readAsText(file);
    // Reset file input
    e.target.value = "";
  };

  const handleDeleteAll = () => {
    const entries = data?.entries ?? [];
    if (entries.length === 0) return;
    if (window.confirm(`Delete all ${entries.length} dictionary entries? This cannot be undone.`)) {
      deleteAllMutation.mutate(entries.map((e) => e.id));
    }
  };

  if (error && !data) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["name-dictionary"])} />;

  }

  const allEntries = data?.entries ?? [];
  const filteredEntries = searchQuery
    ? allEntries.filter((e) =>
        e.arabicText?.includes(searchQuery) ||
        e.englishText?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allEntries;
  const importStatusMessage =
    csvImportStage === "reading"
      ? "Reading CSV file..."
      : csvImportStage === "parsing"
        ? "Parsing CSV entries..."
        : csvImportStage === "uploading"
          ? `Importing ${csvImportCount} entries...`
          : null;

  return (
    <div className="space-y-4">
      <DictionaryLoadStatus isPending={dictionaryQuery.isPending} isError={dictionaryQuery.isError} isFetching={dictionaryQuery.isFetching} hasData={!!data} onRetry={() => void dictionaryQuery.refetch()} />
      {importStatusMessage && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm space-y-2">
          <p>{importStatusMessage}</p>
          <div className="h-2 w-full rounded bg-blue-100 dark:bg-blue-800/40 overflow-hidden" aria-hidden>
            {csvImportStage === "uploading" ? (
              <div className="h-full w-1/2 bg-blue-500 dark:bg-blue-400 animate-pulse" />
            ) : (
              <div
                className="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-300"
                style={{ width: csvImportStage === "reading" ? "35%" : "70%" }}
              />
            )}
          </div>
        </div>
      )}

      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
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
            disabled={importMutation.isPending || csvImportStage === "reading" || csvImportStage === "parsing"}
          />
        </label>
        <Button type="button" variant="secondary" size="sm" disabled={exporting} onClick={async () => {
          setMutationError(null); setExporting(true);
          try { await exportDictionaryCsv(fetchNameDictionary); }
          catch { setMutationError(t("nameDictionary.exportFailed")); }
          finally { setExporting(false); }
        }}>{t("nameDictionary.exportCsv")}</Button>
        {allEntries.length > 0 && (
          <button onClick={handleDeleteAll} disabled={deleteAllMutation.isPending} className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50">
            {deleteAllMutation.isPending ? "Deleting…" : "Delete All"}
          </button>
        )}
      </div>

      {isLoading || (error && !data) ? null : (
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
                filteredEntries.map((e) => (
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
                            <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-xs bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 rounded">إلغاء</button>
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
