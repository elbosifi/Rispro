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

type ImportStage = "upload" | "validating" | "validated" | "previewing" | "preview" | "confirming";

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Unable to validate the workbook.";
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

function SectionOutcome({ section }: { section: SopXlsxSectionPreview }) {
  if (section.errors.length) return <ul className="list-disc space-y-1 ps-5 text-red-700">{section.errors.map((item) => <li key={item}>{item}</li>)}</ul>;
  if (section.action !== "changed") return <span className="text-muted-foreground">No text change detected.</span>;
  return <details className="group"><summary className="cursor-pointer font-medium text-accent">Compare current and imported text</summary><div className="mt-3 grid gap-3 md:grid-cols-2"><div className="min-w-0 rounded-lg bg-muted/20 p-3"><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Current RISpro text</p><p className="whitespace-pre-wrap break-words" dir="auto">{section.currentText || "—"}</p></div><div className="min-w-0 rounded-lg bg-accent/5 p-3"><p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Imported Excel text</p><p className="whitespace-pre-wrap break-words" dir="auto">{section.importedText || "—"}</p></div></div></details>;
}

function SectionResultBadge({ action }: { action: SopXlsxSectionPreview["action"] }) {
  return <Badge variant={action === "changed" ? "warning" : action === "invalid" ? "error" : "success"}>{action === "changed" ? "Changed" : action === "invalid" ? "Invalid" : "Unchanged"}</Badge>;
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
      setState({ ...resetState(), stage: "upload", error: errorMessage(error) });
    }
  };

  const previewWorkbook = async () => {
    if (!state.file || !state.fileContentBase64) return;
    setState((current) => ({ ...current, stage: "previewing", error: null }));
    try {
      const preview = await previewSopXlsxImport(sopId, version, { fileContentBase64: state.fileContentBase64, fileName: state.file.name });
      setState((current) => ({ ...current, stage: "preview", preview, error: null }));
    } catch (error) {
      setState((current) => ({ ...current, stage: "validated", error: errorMessage(error) }));
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
      setState((current) => ({ ...current, stage: "preview", error: errorMessage(error) }));
    }
  };

  const preview = state.preview;
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }}>
      <DialogContent maxWidth="960px" className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Excel changes</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Upload an exported SOP workbook, review the detected changes, then apply them to draft v{version}.
          </p>
        </DialogHeader>

        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-label="Import progress">
          <Badge variant={state.stage === "upload" || state.stage === "validating" ? "accent" : "neutral"}>1. Upload</Badge>
          <span aria-hidden="true">→</span>
          <Badge variant={state.stage === "validating" || state.stage === "validated" || state.stage === "previewing" ? "accent" : "neutral"}>2. Validation</Badge>
          <span aria-hidden="true">→</span>
          <Badge variant={state.stage === "preview" || state.stage === "confirming" ? "accent" : "neutral"}>3. Preview</Badge>
          <span aria-hidden="true">→</span>
          <Badge variant={state.stage === "confirming" ? "accent" : "neutral"}>4. Confirm</Badge>
        </div>

        {state.stage === "upload" || state.stage === "validating" ? (
          <div className="grid gap-4">
            <Card className="border-dashed p-5">
              <label className="grid gap-2 text-sm font-medium">
                Excel workbook (.xlsx)
                <input
                  aria-label="Excel workbook"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  className="block w-full rounded-lg border border-border bg-card p-2 text-sm"
                  onChange={(event) => void chooseFile(event.target.files?.[0])}
                />
              </label>
              {state.file ? <p className="mt-2 text-sm text-muted-foreground">Validating {state.file.name}…</p> : <p className="mt-2 text-sm text-muted-foreground">Use an XLSX exported from RISpro. The server validates the workbook before any draft change is possible.</p>}
            </Card>
            {state.stage === "validating" ? <p className="text-sm text-muted-foreground">Inspecting workbook structure…</p> : null}
          </div>
        ) : null}

        {state.stage === "validated" && state.inspect ? (
          <div className="grid gap-4">
            <Card className="grid gap-2 p-4">
              <h3 className="font-semibold">Workbook validation</h3>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <span>SOP code: <strong dir="ltr">{state.inspect.metadata.sopCode || "—"}</strong></span>
                <span>Source version: <strong dir="ltr">{state.inspect.metadata.sourceVersion || "—"}</strong></span>
                <span>Sheet: <strong>{state.inspect.sheetName}</strong></span>
                <span>Sections detected: <strong>{state.inspect.sectionCount}</strong></span>
              </div>
            </Card>
            {state.inspect.structuralErrors.length ? (
              <Alert variant="error">
                <AlertTitle>Workbook needs attention</AlertTitle>
                <div className="mt-1 text-sm"><ul className="list-disc space-y-1 ps-5">{state.inspect.structuralErrors.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </Alert>
            ) : (
              <Alert variant="success"><AlertTitle>Workbook structure is valid</AlertTitle><AlertDescription>Review the section changes before applying them to the draft.</AlertDescription></Alert>
            )}
            {state.error ? <Alert variant="error"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setState(resetState())}>Choose another workbook</Button>
              <Button type="button" onClick={() => void previewWorkbook()} disabled={Boolean(state.inspect.structuralErrors.length)}>Preview changes</Button>
            </DialogFooter>
          </div>
        ) : null}

        {state.stage === "previewing" ? <p className="text-sm text-muted-foreground">Comparing the workbook with the current persisted draft…</p> : null}

        {preview && (state.stage === "preview" || state.stage === "confirming") ? (
          <div className="grid gap-4">
            <Card className="grid gap-2 p-4">
              <h3 className="font-semibold">Workbook summary</h3>
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <span>SOP: <strong dir="ltr">{sopCode}</strong></span>
                <span>Workbook source: <strong dir="ltr">v{preview.sourceVersion || "—"}</strong></span>
                <span>Target draft: <strong dir="ltr">v{preview.targetVersion}</strong></span>
                <span>Sections detected: <strong>{preview.sectionCount}</strong></span>
              </div>
            </Card>
            {preview.errors.length ? <Alert variant="error"><AlertTitle>Validation errors</AlertTitle><div className="mt-1 text-sm"><ul className="list-disc space-y-1 ps-5">{preview.errors.map((item) => <li key={item}>{item}</li>)}</ul></div></Alert> : null}
            <Alert variant="info"><AlertDescription>Changed sections are imported as normalized SOP text. Excel visual formatting is not imported. Unchanged RISpro sections keep their existing rich formatting.</AlertDescription></Alert>
            <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3 text-start">Section</th><th className="p-3 text-start">Result</th><th className="p-3 text-start">Details</th></tr></thead>
                <tbody>{preview.sections.map((section) => (
                  <tr key={section.sectionKey} className="border-t border-border align-top">
                    <td className="p-3 font-medium">{section.sectionTitle}</td>
                    <td className="p-3"><SectionResultBadge action={section.action} /></td>
                    <td className="p-3"><SectionOutcome section={section} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <div className="grid gap-3 md:hidden">
              {preview.sections.map((section) => <div key={section.sectionKey} className="rounded-xl border border-border p-3"><div className="flex items-start justify-between gap-3"><span className="font-medium">{section.sectionTitle}</span><SectionResultBadge action={section.action} /></div><div className="mt-3 text-sm"><SectionOutcome section={section} /></div></div>)}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4"><h3 className="font-semibold">Effective date</h3><p className="mt-1 text-sm text-muted-foreground">Current: {preview.effectiveDate.current || "—"} · Imported: {preview.effectiveDate.imported || "—"}</p></Card>
              <Card className="p-4"><h3 className="font-semibold">Change summary</h3><Textarea aria-label="Imported change summary" className="mt-2 min-h-20" value={preview.changeSummary.imported} readOnly /></Card>
            </div>
            {state.error ? <Alert variant="error"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setState(resetState())} disabled={busy}>Choose another workbook</Button>
              <Button type="button" onClick={() => void confirmImport()} disabled={!preview.canConfirm || busy}>{state.stage === "confirming" ? "Applying…" : "Confirm import"}</Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
