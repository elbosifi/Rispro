import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Download, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  applyNameDictionaryToPatients,
  deleteNameDictionaryEntry,
  fetchNameDictionary,
  importNameDictionary,
  upsertNameDictionaryEntry,
} from "@/lib/api-hooks";
import { Button, Card } from "@/components/shared";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";

type SortMode = "arabic" | "english" | "recent";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function NameDictionaryPage() {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const [arabicText, setArabicText] = useState("");
  const [englishText, setEnglishText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("arabic");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arabicText: "", englishText: "" });

  const dictionaryQuery = useQuery({
    queryKey: ["name-dictionary"],
    queryFn: fetchNameDictionary,
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });

  const saveMutation = useMutation({
    mutationFn: (payload: { arabicText: string; englishText: string }) => upsertNameDictionaryEntry(payload.arabicText, payload.englishText),
    onSuccess: async () => {
      setArabicText("");
      setEnglishText("");
      setEditingId(null);
      await invalidate();
      pushToast({ type: "success", title: t("nameDictionary.saved") });
    },
    onError: (error) => pushToast({ type: "error", title: t("nameDictionary.saveFailed"), message: errorMessage(error, t("nameDictionary.saveFailed")) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteNameDictionaryEntry(id),
    onSuccess: async () => {
      await invalidate();
      pushToast({ type: "success", title: t("nameDictionary.deleted") });
    },
    onError: (error) => pushToast({ type: "error", title: t("nameDictionary.deleteFailed"), message: errorMessage(error, t("nameDictionary.deleteFailed")) }),
  });

  const importMutation = useMutation({
    mutationFn: (entries: { arabicText: string; englishText: string }[]) => importNameDictionary(entries),
    onSuccess: async (result) => {
      await invalidate();
      pushToast({ type: "success", title: t("nameDictionary.imported"), message: t("nameDictionary.importedMessage", { count: result.entries.length }) });
    },
    onError: (error) => pushToast({ type: "error", title: t("nameDictionary.importFailed"), message: errorMessage(error, t("nameDictionary.importFailed")) }),
  });

  const applyMutation = useMutation({
    mutationFn: applyNameDictionaryToPatients,
    onSuccess: (result) => {
      pushToast({
        type: "success",
        title: t("nameDictionary.applied"),
        message: t("nameDictionary.appliedMessage", {
          updated: result.updatedCount,
          scanned: result.scannedCount,
          skipped: result.skippedMissingTokensCount,
        }),
      });
    },
    onError: (error) => pushToast({ type: "error", title: t("nameDictionary.applyFailed"), message: errorMessage(error, t("nameDictionary.applyFailed")) }),
  });

  const entries = dictionaryQuery.data?.entries ?? [];
  const visibleEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = query
      ? entries.filter((entry) => entry.arabicText.includes(searchQuery.trim()) || entry.englishText.toLowerCase().includes(query))
      : entries;
    return [...filtered].sort((a, b) => {
      if (sortMode === "recent") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      if (sortMode === "english") return a.englishText.localeCompare(b.englishText);
      return a.arabicText.localeCompare(b.arabicText, "ar");
    });
  }, [entries, searchQuery, sortMode]);

  const submitEntry = (event: FormEvent) => {
    event.preventDefault();
    const cleanArabic = arabicText.trim();
    const cleanEnglish = englishText.trim();
    if (!cleanArabic || !cleanEnglish) return;
    saveMutation.mutate({ arabicText: cleanArabic, englishText: cleanEnglish });
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const text = String(loadEvent.target?.result || "");
      const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const parsed = rows
        .map((row) => row.split(",").map((part) => part.trim().replace(/^"|"$/g, "")))
        .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
        .map(([arabicText, englishText]) => ({ arabicText: arabicText!, englishText: englishText! }));
      if (parsed.length === 0) {
        pushToast({ type: "error", title: t("nameDictionary.importFailed"), message: t("nameDictionary.noImportRows") });
        return;
      }
      importMutation.mutate(parsed);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4" dir={language === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <BookOpenText size={22} className="text-accent" />
          <div>
            <h2 className="text-xl font-bold text-foreground">{t("nameDictionary.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("nameDictionary.description")}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (window.confirm(t("nameDictionary.applyConfirm"))) applyMutation.mutate();
          }}
          disabled={applyMutation.isPending || entries.length === 0}
        >
          <RefreshCw size={16} className={applyMutation.isPending ? "animate-spin" : ""} />
          {t("nameDictionary.applyToPatients")}
        </Button>
      </div>

      <Card className="p-4">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitEntry}>
          <input value={arabicText} onChange={(event) => setArabicText(event.target.value)} className="input-premium input-rtl h-10" placeholder={t("nameDictionary.arabicPlaceholder")} />
          <input value={englishText} onChange={(event) => setEnglishText(event.target.value)} className="input-premium input-ltr h-10" placeholder={t("nameDictionary.englishPlaceholder")} />
          <Button type="submit" disabled={saveMutation.isPending || !arabicText.trim() || !englishText.trim()}>{t("nameDictionary.addOrUpdate")}</Button>
        </form>
      </Card>

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="input-premium h-10 w-full pl-9" placeholder={t("nameDictionary.searchPlaceholder")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="input-premium h-10 text-sm">
              <option value="arabic">{t("nameDictionary.sortArabic")}</option>
              <option value="english">{t("nameDictionary.sortEnglish")}</option>
              <option value="recent">{t("nameDictionary.sortRecent")}</option>
            </select>
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-muted/50">
              <Download size={15} />
              {t("nameDictionary.importCsv")}
              <input type="file" accept=".csv,.txt" onChange={handleImport} className="hidden" />
            </label>
            <span className="text-sm text-muted-foreground">{t("nameDictionary.entryCount", { visible: visibleEntries.length, total: entries.length })}</span>
          </div>
        </div>

        <div className="mt-4 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="p-2 text-start">{t("nameDictionary.arabic")}</th>
                <th className="p-2 text-start">{t("nameDictionary.english")}</th>
                <th className="p-2 text-start">{t("nameDictionary.created")}</th>
                <th className="w-40 p-2 text-center">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {dictionaryQuery.isLoading ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">{t("settings.loading")}</td></tr>
              ) : visibleEntries.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">{t("nameDictionary.empty")}</td></tr>
              ) : (
                visibleEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/30">
                    {editingId === entry.id ? (
                      <>
                        <td className="p-2"><input value={editForm.arabicText} onChange={(event) => setEditForm((current) => ({ ...current, arabicText: event.target.value }))} className="input-premium input-rtl h-9 w-full" /></td>
                        <td className="p-2"><input value={editForm.englishText} onChange={(event) => setEditForm((current) => ({ ...current, englishText: event.target.value }))} className="input-premium input-ltr h-9 w-full" /></td>
                        <td className="p-2 text-muted-foreground">{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "-"}</td>
                        <td className="p-2 text-center">
                          <div className="flex justify-center gap-2">
                            <Button type="button" size="sm" onClick={() => saveMutation.mutate(editForm)} disabled={saveMutation.isPending}>{t("nameDictionary.save")}</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>{t("common.cancel")}</Button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-2 font-semibold input-rtl">{entry.arabicText}</td>
                        <td className="p-2 input-ltr">{entry.englishText}</td>
                        <td className="p-2 text-muted-foreground">{entry.createdAt ? new Date(entry.createdAt).toLocaleDateString() : "-"}</td>
                        <td className="p-2 text-center">
                          <div className="flex justify-center gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => { setEditingId(entry.id ?? null); setEditForm({ arabicText: entry.arabicText, englishText: entry.englishText }); }}>{t("common.edit")}</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { if (entry.id && window.confirm(t("nameDictionary.deleteConfirm", { word: entry.arabicText }))) deleteMutation.mutate(entry.id); }} disabled={deleteMutation.isPending}>
                              <Trash2 size={14} />
                              {t("common.delete")}
                            </Button>
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
      </Card>
    </div>
  );
}
