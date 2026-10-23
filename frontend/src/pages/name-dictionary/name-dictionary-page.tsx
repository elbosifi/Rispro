import "@/components/shared/compact-controls.css";
import { useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpenText, Download, RefreshCw, Trash2 } from "lucide-react";
import {
  applyNameDictionaryToPatients,
  deleteNameDictionaryEntry,
  fetchNameDictionary,
  fetchUnresolvedNameDictionaryPatients,
  importNameDictionary,
  upsertNameDictionaryEntry,
  updateNameDictionaryEntry,
} from "@/lib/api-hooks";
import { ApiError } from "@/lib/api-client";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useAuth } from "@/providers/auth-provider";
import { dictionaryReadOptions } from "@/lib/name-dictionary-query";
import { DictionaryLoadStatus } from "@/components/name-dictionary/dictionary-load-status";
import { DictionaryCsvError, parseDictionaryCsv, exportDictionaryCsv } from "@/lib/name-dictionary-csv";
import { Button, Card, Input, SearchInput } from "@/components/shared";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import type { PersistedDictionaryEntry } from "@/lib/name-generation";

type SortMode = "arabic" | "english" | "recent";

const EMPTY_DICTIONARY_ENTRIES: PersistedDictionaryEntry[] = [];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function NameDictionaryPage() {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const canManage = user?.role === "supervisor" || user?.role === "super_admin";
  const [showReauth, setShowReauth] = useState(false);
  const reportMutationError = (error: unknown, title: string) => {
    if (error instanceof ApiError && error.status === 403 && error.message.includes("re-authentication")) setShowReauth(true);
    pushToast({ type: "error", title, message: errorMessage(error, title) });
  };
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
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
    ...dictionaryReadOptions,
  });

  const unresolvedPatientsQuery = useQuery({
    queryKey: ["name-dictionary", "unresolved-patients"],
    queryFn: fetchUnresolvedNameDictionaryPatients,
    enabled: canManage,
    ...dictionaryReadOptions,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });

  const saveMutation = useMutation({
    retry: false,
    mutationFn: (payload: { arabicText: string; englishText: string }) => editingId == null ? upsertNameDictionaryEntry(payload.arabicText, payload.englishText) : updateNameDictionaryEntry(editingId, payload),
    onSuccess: async () => {
      setArabicText("");
      setEnglishText("");
      setEditingId(null);
      await invalidate();
      pushToast({ type: "success", title: t("nameDictionary.saved") });
    },
    onError: (error) => reportMutationError(error, t("nameDictionary.saveFailed")),
  });

  const deleteMutation = useMutation({
    retry: false,
    mutationFn: (id: number) => deleteNameDictionaryEntry(id),
    onSuccess: async () => {
      await invalidate();
      pushToast({ type: "success", title: t("nameDictionary.deleted") });
    },
    onError: (error) => reportMutationError(error, t("nameDictionary.deleteFailed")),
  });

  const importMutation = useMutation({
    retry: false,
    mutationFn: (entries: { arabicText: string; englishText: string }[]) => importNameDictionary(entries),
    onSuccess: async (result) => {
      await invalidate();
      pushToast({ type: "success", title: t("nameDictionary.imported"), message: t("nameDictionary.importedMessage", { count: result.entries.length }) });
    },
    onError: (error) => reportMutationError(error, t("nameDictionary.importFailed")),
  });

  const applyMutation = useMutation({
    retry: false,
    mutationFn: applyNameDictionaryToPatients,
    onSuccess: async (result) => {
      await invalidate();
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
    onError: (error) => reportMutationError(error, t("nameDictionary.applyFailed")),
  });

  const entries = dictionaryQuery.data?.entries ?? EMPTY_DICTIONARY_ENTRIES;
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
      try {
        importMutation.mutate(parseDictionaryCsv(String(loadEvent.target?.result || "")));
      } catch (error) {
        const message = error instanceof DictionaryCsvError ? t(`nameDictionary.csv.${error.reason}`, { row: error.row }) : t("nameDictionary.importFailed");
        pushToast({ type: "error", title: t("nameDictionary.importFailed"), message });
      }
    };
    reader.onerror = () => pushToast({ type: "error", title: t("nameDictionary.importFailed") });
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <div className="compact-controls mx-auto max-w-7xl space-y-4" dir={language === "ar" ? "rtl" : "ltr"}>
      {showReauth && <SupervisorReAuthModal onClose={() => setShowReauth(false)} onSuccess={() => { setShowReauth(false); void invalidate(); }} />}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <BookOpenText size={22} className="text-accent" />
          <div>
            <h2 className="text-xl font-bold text-foreground">{t("nameDictionary.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("nameDictionary.description")}</p>
          </div>
        </div>
        {canManage && <Button
          type="button"
          variant="secondary"
          onClick={() => {
            if (window.confirm(t("nameDictionary.applyConfirm"))) applyMutation.mutate();
          }}
          disabled={applyMutation.isPending || entries.length === 0}
        >
          <RefreshCw size={16} className={applyMutation.isPending ? "animate-spin" : ""} />
          {t("nameDictionary.applyToPatients")}
        </Button>}
      </div>

      {canManage && <Card className="p-4">
        <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end" onSubmit={submitEntry}>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">{t("nameDictionary.arabic")}<Input value={arabicText} onChange={(event) => setArabicText(event.target.value)} className="input-rtl h-10" placeholder={t("nameDictionary.arabicPlaceholder")} /></label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">{t("nameDictionary.english")}<Input value={englishText} onChange={(event) => setEnglishText(event.target.value)} className="input-ltr h-10" placeholder={t("nameDictionary.englishPlaceholder")} /></label>
          <Button type="submit" disabled={saveMutation.isPending || !arabicText.trim() || !englishText.trim()}>{t("nameDictionary.addOrUpdate")}</Button>
        </form>
      </Card>}

      {canManage && <Card className="p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-foreground">{t("nameDictionary.unresolvedTitle")}</h3>
            <p className="text-sm text-muted-foreground">{t("nameDictionary.unresolvedDescription")}</p>
          </div>
          <span className="text-sm text-muted-foreground">{t("nameDictionary.unresolvedCount", { count: unresolvedPatientsQuery.data?.unresolvedCount ?? 0 })}</span>
        </div>

        {unresolvedPatientsQuery.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("settings.loading")}</p>
        ) : unresolvedPatientsQuery.isError ? (
          <div className="mt-4 space-y-2"><p>{t("nameDictionary.unresolvedLoadFailed")}</p>
            <Button type="button" variant="secondary" disabled={unresolvedPatientsQuery.isFetching} onClick={() => void unresolvedPatientsQuery.refetch()}>{t("nameDictionary.retry")}</Button>
            <Button type="button" variant="ghost" onClick={() => setShowReauth(true)}>{t("common.reAuthenticate")}</Button></div>
        ) : unresolvedPatientsQuery.data?.patients.length ? (
          <div className="mt-4 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t("nameDictionary.patientId")}</th>
                  <th className="p-2 text-start">{t("nameDictionary.arabic")}</th>
                  <th className="p-2 text-start">{t("nameDictionary.currentEnglish")}</th>
                  <th className="p-2 text-start">{t("nameDictionary.missingWords")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {unresolvedPatientsQuery.data.patients.map((patient) => (
                  <tr key={patient.id} className="hover:bg-muted/30">
                    <td className="p-2">{patient.id}</td>
                    <td className="p-2 input-rtl">{patient.arabicFullName}</td>
                    <td className="p-2 input-ltr">{patient.englishFullName || "—"}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {patient.missingTokens.map((token, index) => (
                          <span key={`${token}-${index}`} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{token}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("nameDictionary.unresolvedEmpty")}</p>
        )}
      </Card>}

      <Card className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-md">
            <SearchInput aria-label={t("nameDictionary.searchPlaceholder")} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="h-10 w-full" placeholder={t("nameDictionary.searchPlaceholder")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} className="input-premium h-10 text-sm">
              <option value="arabic">{t("nameDictionary.sortArabic")}</option>
              <option value="english">{t("nameDictionary.sortEnglish")}</option>
              <option value="recent">{t("nameDictionary.sortRecent")}</option>
            </select>
            {canManage && <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground hover:bg-muted/50">
              <Download size={15} />
              {t("nameDictionary.importCsv")}
              <input type="file" accept=".csv,.txt" onChange={handleImport} className="hidden" />
            </label>}
            <Button type="button" variant="secondary" disabled={exporting} onClick={async () => {
              setExportError(null); setExporting(true);
              try { await exportDictionaryCsv(fetchNameDictionary); }
              catch { setExportError(t("nameDictionary.exportFailed")); }
              finally { setExporting(false); }
            }}>{t("nameDictionary.exportCsv")}</Button>
            <span className="text-sm text-muted-foreground">{t("nameDictionary.entryCount", { visible: visibleEntries.length, total: entries.length })}</span>
          </div>
        </div>

        {exportError && <p role="alert" className="mt-3 text-destructive">{exportError}</p>}
        <DictionaryLoadStatus isPending={false} isError={dictionaryQuery.isError} isFetching={dictionaryQuery.isFetching} hasData={!!dictionaryQuery.data} onRetry={() => void dictionaryQuery.refetch()} />
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
              ) : dictionaryQuery.isError && !dictionaryQuery.data ? null : visibleEntries.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-muted-foreground">{t("nameDictionary.empty")}</td></tr>
              ) : (
                visibleEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-muted/30">
                    {editingId === entry.id ? (
                      <>
                        <td className="p-2"><Input aria-label={t("nameDictionary.arabic")} value={editForm.arabicText} onChange={(event) => setEditForm((current) => ({ ...current, arabicText: event.target.value }))} className="input-premium input-rtl h-9 w-full" /></td>
                        <td className="p-2"><Input aria-label={t("nameDictionary.english")} value={editForm.englishText} onChange={(event) => setEditForm((current) => ({ ...current, englishText: event.target.value }))} className="input-premium input-ltr h-9 w-full" /></td>
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
                          {canManage && <div className="flex justify-center gap-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => { setEditingId(entry.id ?? null); setEditForm({ arabicText: entry.arabicText, englishText: entry.englishText }); }}>{t("common.edit")}</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => { if (entry.id && window.confirm(t("nameDictionary.deleteConfirm", { word: entry.arabicText }))) deleteMutation.mutate(entry.id); }} disabled={deleteMutation.isPending}>
                              <Trash2 size={14} />
                              {t("common.delete")}
                            </Button>
                          </div>}
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
