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
import { SopStructuredEditor } from "./sop-editor";

const isManagement = (role?: string) => role === "supervisor" || role === "super_admin";
const configSignature = (config: SopJsonExampleConfig) => JSON.stringify(config);

function ManagementSopJsonExampleEditor({ initial }: { initial: SopJsonExampleConfigResult }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { language } = useLanguage();
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
    onError: (value) => setError(value instanceof Error ? value.message : "Unable to save the JSON example."),
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
    onError: (value) => setError(value instanceof Error ? value.message : "Unable to reset the JSON example."),
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
    catch (value) { setDownloadError(value instanceof Error ? value.message : "Unable to download the JSON example."); }
  };

  return (
    <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4" dir={language === "ar" ? "rtl" : "ltr"}>
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => requestLeave(() => navigate("/sops"))}>
            <ArrowLeft className="h-4 w-4" />Back to SOP Library
          </Button>
          <h1 className="mt-3 text-xl font-semibold sm:text-2xl">RISpro SOP JSON Example</h1>
          <p className="mt-1 text-sm font-semibold">JSON Example Template — configuration only, not a real SOP.</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Edit the example used when generating the downloadable RISpro SOP JSON V1 template. This does not modify existing SOPs.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">Active example: {source === "custom" ? "Customized" : "Built-in default"}</p>
        </div>
      </header>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="JSON example metadata">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Example SOP Code<Input aria-label="Example SOP Code" value={config.code} onChange={(event) => update("code", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium">Example Title<Input aria-label="Example Title" value={config.title} onChange={(event) => update("title", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium">Category
            <select aria-label="Category" className="input-premium h-10" value={config.category} onChange={(event) => update("category", event.target.value)} disabled={busy}>
              {(metaQuery.data?.categories ?? ["General", "CT", "MRI", "Ultrasound", "Mammography", "X-Ray", "Interventional Radiology", "Patient Safety", "PACS / IT", "Reception / Registration", "Administrative"]).map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Version<Input aria-label="Version" value={config.version} onChange={(event) => update("version", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium">Effective Date<Input aria-label="Effective Date" type="date" value={config.effectiveDate} onChange={(event) => update("effectiveDate", event.target.value)} disabled={busy} /></label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">Change Summary<Textarea aria-label="Change Summary" className="min-h-20" value={config.changeSummary} onChange={(event) => update("changeSummary", event.target.value)} disabled={busy} /></label>
        </div>
      </section>

      <aside className="rounded-xl border border-border bg-muted/20 p-4 text-sm leading-6">
        SOP content may be Arabic, English, or bilingual. For bilingual SOPs, the departmental convention is Arabic first, followed by English within the same SOP section and version. Use RTL blocks for Arabic and LTR blocks for English.
      </aside>

      <SopStructuredEditor value={config.document} editable={!busy} onChange={(document) => update("document", document)} />

      {error ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}
      {downloadError ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{downloadError}</div> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => requestLeave(() => navigate("/sops"))} disabled={busy}>Cancel</Button>
        <Button type="button" variant="secondary" onClick={() => setResetOpen(true)} disabled={save.isPending || reset.isPending}>
          <RotateCcw className="h-4 w-4" />Reset to Default
        </Button>
        <Button type="button" variant="secondary" onClick={() => void downloadSavedExample()} disabled={dirty || save.isPending || reset.isPending} title={dirty ? "Save changes before downloading the example." : undefined}>
          <Download className="h-4 w-4" />Download Example
        </Button>
        <Button type="button" onClick={() => save.mutate()} disabled={!dirty || save.isPending || reset.isPending}>
          <Save className="h-4 w-4" />{save.isPending ? "Saving…" : "Save Example"}
        </Button>
      </div>

      <Dialog open={resetOpen} onClose={() => { if (!reset.isPending) setResetOpen(false); }}>
        <DialogContent maxWidth="520px">
          <DialogHeader>
            <DialogTitle>Reset JSON Example?</DialogTitle>
            <DialogDescription>This will discard the customized JSON example and restore the built-in RISpro bilingual example.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">This does not affect any existing SOPs.</p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setResetOpen(false)} disabled={reset.isPending}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => reset.mutate()} disabled={reset.isPending}>
              {reset.isPending ? "Resetting…" : "Reset to Default"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onClose={() => setDiscardOpen(false)}>
        <DialogContent maxWidth="460px">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>Changes to the JSON example have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDiscardOpen(false)}>Keep editing</Button>
            <Button type="button" variant="destructive" onClick={() => {
              const proceed = pendingNavigation;
              setPendingNavigation(null);
              setDiscardOpen(false);
              if (proceed) proceedWithUnsavedNavigation(proceed);
            }}>Discard changes</Button>
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
  const configQuery = useQuery({ queryKey: ["sops", "jsonExampleConfig"], queryFn: fetchSopJsonExampleConfig, retry: false });
  if (configQuery.isLoading) return <LoadingState message="Loading JSON example…" />;
  if (configQuery.isError) return <ErrorState message={configQuery.error instanceof Error ? configQuery.error.message : "Unable to load the JSON example."} />;
  if (!configQuery.data) return <ErrorState message="Unable to load the JSON example." />;
  return <ManagementSopJsonExampleEditor key={configSignature(configQuery.data.config)} initial={configQuery.data} />;
}
