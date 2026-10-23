import "@/components/shared/compact-controls.css";
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, RotateCcw, Save } from "lucide-react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Input,
  LoadingState,
  Textarea,
} from "@/components/shared";
import {
  downloadSopJsonExample,
  fetchSopJsonExampleConfig,
  fetchSopMeta,
  resetSopJsonExampleConfig,
  updateSopJsonExampleConfig,
  type SopJsonExampleConfig,
  type SopJsonExampleConfigResult,
} from "@/lib/api/sops";
import {
  proceedWithUnsavedNavigation,
  registerUnsavedNavigationGuard,
} from "@/lib/unsaved-navigation-guard";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import { SopStructuredEditor } from "./sop-editor";

const isManagement = (role?: string) => role === "supervisor" || role === "super_admin";
const configSignature = (config: SopJsonExampleConfig) => JSON.stringify(config);
const categoryKeys: Record<string, TranslationKey> = {
  General: "sops.category.general", CT: "sops.category.ct", MRI: "sops.category.mri", Ultrasound: "sops.category.ultrasound",
  Mammography: "sops.category.mammography", "X-Ray": "sops.category.xray", "Interventional Radiology": "sops.category.interventionalRadiology",
  "Patient Safety": "sops.category.patientSafety", "PACS / IT": "sops.category.pacsIt", "Reception / Registration": "sops.category.receptionRegistration", Administrative: "sops.category.administrative",
};

function ManagementSopJsonExampleEditor({ initial }: { initial: SopJsonExampleConfigResult }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { language, t } = useLanguage();
  const metaQuery = useQuery({ queryKey: ["sops", "meta"], queryFn: fetchSopMeta, staleTime: Infinity });
  const [config, setConfig] = useState(initial.config);
  const [source, setSource] = useState(initial.source);
  const [savedSignature, setSavedSignature] = useState(configSignature(initial.config));
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const dirty = configSignature(config) !== savedSignature;

  const save = useMutation({
    mutationFn: () => updateSopJsonExampleConfig(config),
    onSuccess: (result) => {
      setConfig(result.config);
      setSource(result.source);
      setSavedSignature(configSignature(result.config));
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["sops", "jsonExampleConfig"] });
    },
    onError: (value) => setError(value instanceof Error ? value.message : t("sops.jsonExample.saveError")),
  });
  const reset = useMutation({
    mutationFn: resetSopJsonExampleConfig,
    onSuccess: (result) => {
      setConfig(result.config);
      setSource(result.source);
      setSavedSignature(configSignature(result.config));
      setResetOpen(false);
      setError(null);
      void queryClient.setQueryData(["sops", "jsonExampleConfig"], result);
    },
    onError: (value) => setError(value instanceof Error ? value.message : t("sops.jsonExample.resetError")),
  });
  const busy = save.isPending || reset.isPending;

  const requestLeave = useCallback((proceed: () => void) => {
    if (!dirty) {
      proceed();
      return;
    }
    setPendingNavigation(() => proceed);
    setDiscardOpen(true);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    return registerUnsavedNavigationGuard(requestLeave);
  }, [dirty, requestLeave]);
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const update = <K extends keyof SopJsonExampleConfig>(key: K, value: SopJsonExampleConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const downloadSavedExample = async () => {
    setDownloadError(null);
    try { await downloadSopJsonExample(); }
    catch (value) { setDownloadError(value instanceof Error ? value.message : t("sops.jsonExample.downloadError")); }
  };

  return (
    <main className="compact-controls mx-auto flex w-full min-w-0 max-w-[1400px] flex-col gap-4" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => requestLeave(() => navigate("/sops"))}>
            <ArrowLeft className="h-4 w-4" />{t("sops.jsonExample.backToLibrary")}
          </Button>
          <h1 className="mt-3 text-xl font-semibold sm:text-2xl">{t("sops.jsonExample.pageTitle")}</h1>
          <p className="mt-1 text-sm font-semibold">{t("sops.jsonExample.configurationNotice")}</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("sops.jsonExample.description")}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{t("sops.jsonExample.activeExample", { source: source === "custom" ? t("sops.jsonExample.customized") : t("sops.jsonExample.builtInDefault") })}</p>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label={t("sops.jsonExample.metadataAria")}>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">{t("sops.jsonExample.codeLabel")}<Input aria-label={t("sops.jsonExample.codeLabel")} value={config.code} onChange={(event) => update("code", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium">{t("sops.jsonExample.titleLabel")}<Input aria-label={t("sops.jsonExample.titleLabel")} value={config.title} onChange={(event) => update("title", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium">{t("sops.jsonExample.categoryLabel")}
            <select aria-label={t("sops.jsonExample.categoryLabel")} className="input-premium h-10 !py-1 leading-normal" value={config.category} onChange={(event) => update("category", event.target.value)} disabled={busy}>
              {(metaQuery.data?.categories ?? ["General", "CT", "MRI", "Ultrasound", "Mammography", "X-Ray", "Interventional Radiology", "Patient Safety", "PACS / IT", "Reception / Registration", "Administrative"]).map((category) => <option key={category} value={category}>{categoryKeys[category] ? t(categoryKeys[category]) : category}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">{t("sops.jsonImport.versionLabel")}<Input aria-label={t("sops.jsonImport.versionLabel")} value={config.version} onChange={(event) => update("version", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium">{t("sops.jsonImport.effectiveDate")}<Input aria-label={t("sops.jsonImport.effectiveDate")} type="date" value={config.effectiveDate} onChange={(event) => update("effectiveDate", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">{t("sops.jsonExample.changeSummary")}<Textarea aria-label={t("sops.jsonExample.changeSummary")} className="min-h-20" value={config.changeSummary} onChange={(event) => update("changeSummary", event.target.value)} disabled={busy} /></label>
        </div>
      </section>

      <aside className="rounded-xl border border-border bg-muted/20 p-4 text-sm leading-6">
        {t("sops.jsonExample.languageGuidance")}
      </aside>

      <SopStructuredEditor value={config.document} editable={!busy} onChange={(document) => update("document", document)} />

      {error ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
      {downloadError ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{downloadError}</div> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => requestLeave(() => navigate("/sops"))} disabled={busy}>{t("common.cancel")}</Button>
        <Button type="button" variant="secondary" onClick={() => setResetOpen(true)} disabled={save.isPending || reset.isPending}>
          <RotateCcw className="h-4 w-4" />{t("sops.jsonExample.resetToDefault")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => void downloadSavedExample()} disabled={dirty || save.isPending || reset.isPending} title={dirty ? t("sops.jsonExample.saveBeforeDownload") : undefined}>
          <Download className="h-4 w-4" />{t("sops.jsonExample.downloadExample")}
        </Button>
        <Button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending || reset.isPending}>
          <Save className="h-4 w-4" />{save.isPending ? t("sops.jsonExample.saving") : t("sops.jsonExample.saveExample")}
        </Button>
      </div>

      <Dialog open={resetOpen} onClose={() => { if (!reset.isPending) setResetOpen(false); }}>
        <DialogContent maxWidth="520px" className="compact-controls">
          <DialogHeader>
            <DialogTitle>{t("sops.jsonExample.resetTitle")}</DialogTitle>
            <DialogDescription>{t("sops.jsonExample.resetDescription")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">{t("sops.jsonExample.existingSopsUnaffected")}</p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setResetOpen(false)} disabled={reset.isPending}>{t("common.cancel")}</Button>
            <Button type="button" variant="destructive" onClick={() => reset.mutate()} disabled={reset.isPending}>
              {reset.isPending ? t("sops.jsonExample.resetting") : t("sops.jsonExample.resetToDefault")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)}>
        <DialogContent maxWidth="460px" className="compact-controls">
          <DialogHeader>
            <DialogTitle>{t("sops.editor.discardTitle")}</DialogTitle>
            <DialogDescription>{t("sops.jsonExample.discardDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDiscardOpen(false)}>{t("sops.editor.keepEditing")}</Button>
            <Button type="button" variant="destructive" onClick={() => {
              const proceed = pendingNavigation;
              setPendingNavigation(null);
              setDiscardOpen(false);
              if (proceed) proceedWithUnsavedNavigation(proceed);
            }}>{t("sops.editor.discardChanges")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

export default function SopJsonExamplePage() {
  const { user } = useAuth();
  if (!isManagement(user?.role)) return <Navigate to="/sops" replace />;
  return <AuthorizedSopJsonExamplePage />;
}

function AuthorizedSopJsonExamplePage() {
  const { t } = useLanguage();
  const configQuery = useQuery({ queryKey: ["sops", "jsonExampleConfig"], queryFn: fetchSopJsonExampleConfig, retry: false });
  if (configQuery.isLoading) return <LoadingState message={t("sops.jsonExample.loading")} />;
  if (configQuery.isError) return <ErrorState message={configQuery.error instanceof Error ? configQuery.error.message : t("sops.jsonExample.loadError")} />;
  if (!configQuery.data) return <ErrorState message={t("sops.jsonExample.loadError")} />;
  return <ManagementSopJsonExampleEditor key={configSignature(configQuery.data.config)} initial={configQuery.data} />;
}
