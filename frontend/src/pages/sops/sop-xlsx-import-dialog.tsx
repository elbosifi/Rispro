import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from "@/components/shared";
import {
  confirmSopXlsxImport,
  inspectSopXlsxImport,
  previewSopXlsxImport,
  type SopXlsxConfirmResult,
  type SopXlsxInspect,
  type SopXlsxPreview,
} from "@/lib/api/sops";
import { useLanguage } from "@/providers/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import { localizeSopSectionTitle } from "./sop-section-utils";

type ImportStage = "upload" | "validating" | "validated" | "previewing" | "preview" | "confirming";

function errorMessage(value: unknown, t: (key: TranslationKey) => string): string {
  return value instanceof Error ? value.message : t("sops.xlsxImport.fallbackError");
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function resetState(): { stage: ImportStage; file: File | null; fileContentBase64: string; inspect: SopXlsxInspect | null; preview: SopXlsxPreview | null; error: string | null } {
  return { stage: "upload", file: null, fileContentBase64: "", inspect: null, preview: null, error: null };
}

type SopXlsxSectionPreview = SopXlsxPreview["sections"][number];

function SectionOutcome({ section, t }: { section: SopXlsxSectionPreview; t: (key: TranslationKey) => string }) {
  if (section.errors.length) return <ul className="list-disc space-y-1 ps-5 text-red-700">{section.errors.map((item) => <li key={item}>{item}</li>)}</ul>;
  if (section.action !== "changed") return <span className="text-muted-foreground">{t("sops.xlsxImport.noTextChange")}</span>;
  return <details className="group"><summary className="cursor-pointer font-medium text-accent">{t("sops.xlsxImport.compareText")}</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="min-w-0 rounded-lg bg-muted/20 p-3"><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("sops.xlsxImport.currentRisproText")}</p><p className="whitespace-pre-wrap break-words" dir="auto">{section.currentText || "—"}</p></div><div className="min-w-0 rounded-lg bg-accent/5 p-3"><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t("sops.xlsxImport.importedExcelText")}</p><p className="whitespace-pre-wrap break-words" dir="auto">{section.importedText || "—"}</p></div></div></details>;
}

function SectionResultBadge({ action, t }: { action: SopXlsxSectionPreview["action"]; t: (key: TranslationKey) => string }) {
  return <Badge variant={action === "changed" ? "warning" : action === "invalid" ? "error" : "success"}>{t(`sops.jsonImport.action.${action}` as TranslationKey)}</Badge>;
}

export function SopXlsxImportDialog({
  open,
  sopId,
  version,
  sopCode,
  onClose,
  onConfirmed,
}: {
  open: boolean;
  sopId: number;
  version: string;
  sopCode: string;
  onClose: () => void;
  onConfirmed: (result: SopXlsxConfirmResult) => void;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState(resetState);
  const busy = state.stage === "validating" || state.stage === "previewing" || state.stage === "confirming";

  useEffect(() => {
    if (!open) setState(resetState());
  }, [open]);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setState({ ...resetState(), stage: "validating", file });
    try {
      const fileContentBase64 = await fileToBase64(file);
      const inspect = await inspectSopXlsxImport(sopId, version, { fileContentBase64, fileName: file.name });
      setState({ stage: "validated", file, fileContentBase64, inspect, preview: null, error: null });
    } catch (error) {
      setState({ ...resetState(), stage: "upload", error: errorMessage(error, t) });
    }
  };

  const previewWorkbook = async () => {
    if (!state.file || !state.fileContentBase64) return;
    setState((current) => ({ ...current, stage: "previewing", error: null }));
    try {
      const preview = await previewSopXlsxImport(sopId, version, { fileContentBase64: state.fileContentBase64, fileName: state.file.name });
      setState((current) => ({ ...current, stage: "preview", preview, error: null }));
    } catch (error) {
      setState((current) => ({ ...current, stage: "validated", error: errorMessage(error, t) }));
    }
  };

  const confirmImport = async () => {
    if (!state.file || !state.fileContentBase64 || !state.preview?.canConfirm) return;
    setState((current) => ({ ...current, stage: "confirming", error: null }));
    try {
      const result = await confirmSopXlsxImport(sopId, version, {
        fileContentBase64: state.fileContentBase64,
        fileName: state.file.name,
        expectedDraftUpdatedAt: state.preview.targetUpdatedAt,
      });
      onConfirmed(result);
    } catch (error) {
      setState((current) => ({ ...current, stage: "preview", error: errorMessage(error, t) }));
    }
  };

  const preview = state.preview;
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }}>
      <DialogContent maxWidth="960px" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sops.xlsxImport.title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t("sops.xlsxImport.description", { version })}
          </p>
        </DialogHeader>

        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label={t("sops.jsonImport.progressLabel")}>
          <Badge variant={state.stage === "upload" || state.stage === "validating" ? "accent" : "neutral"}>1. {t("sops.jsonImport.upload")}</Badge>
          <span aria-hidden="true">→</span>
          <Badge variant={state.stage === "validating" || state.stage === "validated" || state.stage === "previewing" ? "accent" : "neutral"}>2. {t("sops.jsonImport.validation")}</Badge>
          <span aria-hidden="true">→</span>
          <Badge variant={state.stage === "preview" || state.stage === "confirming" ? "accent" : "neutral"}>3. {t("sops.jsonImport.preview")}</Badge>
          <span aria-hidden="true">→</span>
          <Badge variant={state.stage === "confirming" ? "accent" : "neutral"}>4. {t("sops.jsonImport.confirm")}</Badge>
        </div>

        {state.stage === "upload" || state.stage === "validating" ? (
          <div className="grid gap-4">
            <Card className="border-dashed p-5">
              <label className="grid gap-2 text-sm font-medium">
                {t("sops.xlsxImport.fileLabel")}
                <input
                  aria-label={t("sops.xlsxImport.fileLabel")}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  className="block w-full rounded-lg border border-border bg-card p-2 text-sm"
                  onChange={(event) => void chooseFile(event.target.files?.[0])}
                />
              </label>
              {state.file ? <p className="mt-2 text-sm text-muted-foreground">{t("sops.xlsxImport.validatingFile", { file: state.file.name })}</p> : <p className="mt-2 text-sm text-muted-foreground">{t("sops.xlsxImport.uploadInstructions")}</p>}
            </Card>
            {state.stage === "validating" ? <p className="text-sm text-muted-foreground">{t("sops.xlsxImport.inspectingStructure")}</p> : null}
          </div>
        ) : null}

        {state.stage === "validated" && state.inspect ? (
          <div className="grid gap-4">
            <Card className="grid gap-2 p-4">
              <h3 className="font-semibold">{t("sops.xlsxImport.validationTitle")}</h3>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <span>{t("sops.jsonImport.codeLabel")}: <strong dir="ltr">{state.inspect.metadata.sopCode || "—"}</strong></span>
                <span>{t("sops.jsonImport.sourceVersion")}: <strong dir="ltr">{state.inspect.metadata.sourceVersion || "—"}</strong></span>
                <span>{t("sops.xlsxImport.sheet")}: <strong>{state.inspect.sheetName}</strong></span>
                <span>{t("sops.xlsxImport.sectionsDetected")}: <strong>{state.inspect.sectionCount}</strong></span>
              </div>
            </Card>
            {state.inspect.structuralErrors.length ? (
              <Alert variant="error">
                <AlertTitle>{t("sops.xlsxImport.needsAttention")}</AlertTitle>
                <div className="mt-1 text-sm"><ul className="list-disc space-y-1 ps-5">{state.inspect.structuralErrors.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </Alert>
            ) : (
              <Alert variant="success"><AlertTitle>{t("sops.xlsxImport.structureValid")}</AlertTitle><AlertDescription>{t("sops.xlsxImport.reviewChangesBeforeApply")}</AlertDescription></Alert>
            )}
            {state.error ? <Alert variant="error"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setState(resetState())}>{t("sops.xlsxImport.chooseAnotherWorkbook")}</Button>
              <Button type="button" onClick={() => void previewWorkbook()} disabled={Boolean(state.inspect.structuralErrors.length)}>{t("sops.xlsxImport.previewChanges")}</Button>
            </DialogFooter>
          </div>
        ) : null}

        {state.stage === "previewing" ? <p className="text-sm text-muted-foreground">{t("sops.xlsxImport.comparingDraft")}</p> : null}

        {preview && (state.stage === "preview" || state.stage === "confirming") ? (
          <div className="grid gap-4">
            <Card className="grid gap-2 p-4">
              <h3 className="font-semibold">{t("sops.xlsxImport.summaryTitle")}</h3>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <span>{t("sops.xlsxImport.sopLabel")}: <strong dir="ltr">{sopCode}</strong></span>
                <span>{t("sops.xlsxImport.workbookSource")}: <strong dir="ltr">v{preview.sourceVersion || "—"}</strong></span>
                <span>{t("sops.xlsxImport.targetDraft")}: <strong dir="ltr">v{preview.targetVersion}</strong></span>
                <span>{t("sops.xlsxImport.sectionsDetected")}: <strong>{preview.sectionCount}</strong></span>
              </div>
            </Card>
            {preview.errors.length ? <Alert variant="error"><AlertTitle>{t("sops.jsonImport.validationErrors")}</AlertTitle><div className="mt-1 text-sm"><ul className="list-disc space-y-1 ps-5">{preview.errors.map((item) => <li key={item}>{item}</li>)}</ul></div></Alert> : null}
            <Alert variant="info"><AlertDescription>{t("sops.xlsxImport.formattingNote")}</AlertDescription></Alert>
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3 text-start">{t("sops.xlsxImport.sectionColumn")}</th><th className="p-3 text-start">{t("sops.xlsxImport.resultColumn")}</th><th className="p-3 text-start">{t("sops.xlsxImport.detailsColumn")}</th></tr></thead>
                <tbody>{preview.sections.map((section) => (
                  <tr key={section.sectionKey} className="border-t border-border align-top">
                    <td className="p-3 font-medium">{localizeSopSectionTitle(section.sectionKey, section.sectionTitle, t)}</td>
                    <td className="p-3"><SectionResultBadge action={section.action} t={t} /></td>
                    <td className="p-3"><SectionOutcome section={section} t={t} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              {preview.sections.map((section) => <div key={section.sectionKey} className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-3"><span className="font-medium">{localizeSopSectionTitle(section.sectionKey, section.sectionTitle, t)}</span><SectionResultBadge action={section.action} t={t} /></div><div className="mt-3 text-sm"><SectionOutcome section={section} t={t} /></div></div>)}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4"><h3 className="font-semibold">{t("sops.jsonImport.effectiveDate")}</h3><p className="mt-1 text-sm text-muted-foreground">{t("sops.xlsxImport.currentDate")}: {preview.effectiveDate.current || "—"} · {t("sops.jsonImport.imported")}: {preview.effectiveDate.imported || "—"}</p></Card>
              <Card className="p-4"><h3 className="font-semibold">{t("sops.jsonImport.changeSummary")}</h3><Textarea aria-label={t("sops.xlsxImport.importedChangeSummaryAria")} className="mt-2 min-h-20" value={preview.changeSummary.imported} readOnly /></Card>
            </div>
            {state.error ? <Alert variant="error"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setState(resetState())} disabled={busy}>{t("sops.xlsxImport.chooseAnotherWorkbook")}</Button>
              <Button type="button" onClick={() => void confirmImport()} disabled={!preview.canConfirm || busy}>{state.stage === "confirming" ? t("sops.xlsxImport.applying") : t("sops.jsonImport.confirmImport")}</Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
