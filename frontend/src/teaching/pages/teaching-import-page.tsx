import { useRef, useState } from "react";
import { Check, Download, Eye, FileUp, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card } from "@/components/shared";
import {
  confirmTeachingImport,
  downloadTeachingImportTemplate,
  inspectTeachingImport,
  previewTeachingImport,
  type TeachingImportInspectResult,
  type TeachingImportIssue,
  type TeachingImportValidation,
} from "../api/teaching-api";

function IssueList({ title, issues, variant }: { title: string; issues: TeachingImportIssue[]; variant: "error" | "warning" }) {
  if (issues.length === 0) return null;
  return (
    <Alert variant={variant} role={variant === "error" ? "alert" : "status"}>
      <AlertTitle>{title} ({issues.length})</AlertTitle>
      <div className="mt-2 text-sm text-muted-foreground">
        <ul className="mt-2 space-y-2">
          {issues.map((issue, index) => (
            <li key={`${issue.externalId ?? ""}-${issue.path ?? ""}-${issue.code}-${index}`} className="break-words">
              <span className="font-medium">{issue.externalId ? `${issue.externalId} · ` : ""}{issue.path ? `${issue.path}: ` : ""}</span>
              {issue.message}
              {issue.filename ? <span className="ms-1">({issue.filename})</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ApiValidation(error: unknown): TeachingImportValidation | null {
  if (typeof error !== "object" || error === null || !("details" in error)) return null;
  const details = error.details;
  if (typeof details !== "object" || details === null || !("validation" in details)) return null;
  const validation = details.validation;
  if (typeof validation !== "object" || validation === null || !("errors" in validation)) return null;
  return validation as TeachingImportValidation;
}

export function TeachingImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<TeachingImportInspectResult | null>(null);
  const [validation, setValidation] = useState<TeachingImportValidation | null>(null);
  const [busy, setBusy] = useState<"download" | "inspect" | "preview" | "confirm" | null>(null);
  const [message, setMessage] = useState<{ text: string; variant: "error" | "success" } | null>(null);
  const operationInProgress = useRef(false);

  async function runOnce<T>(kind: NonNullable<typeof busy>, operation: () => Promise<T>): Promise<T | null> {
    if (operationInProgress.current) return null;
    operationInProgress.current = true;
    setBusy(kind);
    setMessage(null);
    try {
      return await operation();
    } catch (error) {
      const validationFromError = ApiValidation(error);
      if (validationFromError) setValidation(validationFromError);
      setMessage({ text: error instanceof Error ? error.message : "Teaching import request failed.", variant: "error" });
      return null;
    } finally {
      operationInProgress.current = false;
      setBusy(null);
    }
  }

  function chooseFile(selected: File | null) {
    setFile(selected);
    setInspection(null);
    setValidation(null);
    setMessage(null);
  }

  async function handleDownload() {
    await runOnce("download", downloadTeachingImportTemplate);
  }

  async function handleInspect() {
    if (!file) return;
    const result = await runOnce("inspect", () => inspectTeachingImport(file));
    if (!result) return;
    setInspection(result);
    setValidation(null);
    setMessage(result.structurallyValid ? null : { text: "The file has structural errors. Correct them and upload it again.", variant: "error" });
  }

  async function handlePreview() {
    if (!inspection) return;
    const result = await runOnce("preview", () => previewTeachingImport(inspection.batchId));
    if (result) setValidation(result);
  }

  async function handleConfirm() {
    if (!inspection || !validation || validation.errors.length > 0 || validation.questions.length === 0) return;
    const result = await runOnce("confirm", () => confirmTeachingImport(inspection.batchId));
    if (result?.status === "confirmed") {
      setMessage({ text: `${result.questionCount} questions imported as Draft.`, variant: "success" });
      setInspection(null);
      setValidation(null);
      setFile(null);
    }
  }

  return (
    <section aria-labelledby="teaching-import-title" className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration</p>
          <h1 id="teaching-import-title" className="mt-1 text-2xl font-semibold text-foreground">Question Bank Import</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Prepare questions elsewhere, inspect and validate them against the live Teaching catalog, then import them as drafts.</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void handleDownload()} disabled={busy !== null}>
          <Download size={16} aria-hidden="true" />
          {busy === "download" ? "Preparing template…" : "Download AI Template"}
        </Button>
      </header>

      {message && (
        <Alert variant={message.variant} role={message.variant === "error" ? "alert" : "status"}>
          <AlertTitle>{message.variant === "success" ? "Import complete" : "Import needs attention"}</AlertTitle>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-accent" aria-hidden="true"><FileUp size={18} /></div>
            <div>
              <h2 className="font-semibold text-foreground">1. Upload and inspect</h2>
              <p className="mt-1 text-sm text-muted-foreground">Choose a text-only JSON file or a ZIP containing questions.json and image assets.</p>
            </div>
          </div>
          <label htmlFor="teaching-import-file" className="block cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-colors hover:bg-muted/50" style={{ borderColor: "var(--border)" }}>
            <Upload className="mx-auto text-accent" size={23} aria-hidden="true" />
            <span className="mt-2 block text-sm font-medium text-foreground">{file?.name ?? "Choose JSON or ZIP file"}</span>
            <span className="mt-1 block text-xs text-muted-foreground">JSON up to 12 MB · ZIP up to 32 MB</span>
            <input
              id="teaching-import-file"
              className="sr-only"
              type="file"
              accept=".json,.zip,application/json,application/zip"
              onChange={(event) => chooseFile(event.currentTarget.files?.[0] ?? null)}
            />
          </label>
          <Button type="button" onClick={() => void handleInspect()} disabled={!file || busy !== null} className="w-full">
            {busy === "inspect" ? "Inspecting file…" : "Inspect upload"}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">Inspection stores a short lived Teaching import batch. It creates no questions or permanent images.</p>
        </Card>

        <Card className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-accent" aria-hidden="true"><Eye size={18} /></div>
            <div>
              <h2 className="font-semibold text-foreground">2. Validate and review</h2>
              <p className="mt-1 text-sm text-muted-foreground">Validation checks taxonomy, question structure, source data, case consistency, media and existing external IDs.</p>
            </div>
          </div>
          {inspection ? (
            <>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <Metric label="Questions" value={inspection.questions} />
                <Metric label="Cases" value={inspection.cases} />
                <Metric label="Images" value={inspection.assets} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={inspection.structurallyValid ? "success" : "error"}>{inspection.structurallyValid ? "Structure valid" : "Structural errors"}</Badge>
                {inspection.schemaVersion && <span className="text-muted-foreground">Schema {inspection.schemaVersion}</span>}
                <span className="text-muted-foreground">Batch {inspection.batchId}</span>
              </div>
              <IssueList title="Structural errors" issues={inspection.errors} variant="error" />
              <IssueList title="Warnings" issues={inspection.warnings} variant="warning" />
              <Button type="button" variant="secondary" onClick={() => void handlePreview()} disabled={!inspection.structurallyValid || busy !== null} className="w-full">
                {busy === "preview" ? "Validating against current catalog…" : "Validate and preview"}
              </Button>
            </>
          ) : (
            <div className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">Upload a file and inspect it to see its contents here.</div>
          )}
        </Card>
      </div>

      {validation && (
        <section aria-labelledby="teaching-import-preview-title" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 id="teaching-import-preview-title" className="text-lg font-semibold text-foreground">3. Preview import</h2>
              <p className="mt-1 text-sm text-muted-foreground">{validation.questionCount} questions · {validation.caseCount} cases · {validation.assetCount} ZIP assets</p>
            </div>
            <Button type="button" onClick={() => void handleConfirm()} disabled={validation.errors.length > 0 || validation.questions.length === 0 || busy !== null}>
              <Check size={16} aria-hidden="true" />
              {busy === "confirm" ? "Importing drafts…" : `Import ${validation.questions.length} Draft Questions`}
            </Button>
          </div>
          <IssueList title="Errors · import blocked" issues={validation.errors} variant="error" />
          <IssueList title="Warnings · review before import" issues={validation.warnings} variant="warning" />
          {validation.questions.length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground">There are no valid question previews in this batch.</Card>
          ) : (
            <div className="space-y-3">
              {validation.questions.map((question) => (
                <Card key={question.externalId} className="overflow-hidden">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-accent">{question.externalId}</span>
                          <Badge variant={question.disposition === "new" ? "draft" : "error"} size="sm">{question.disposition.replaceAll("_", " ")}</Badge>
                          <Badge variant="neutral" size="sm">{question.type}</Badge>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm font-medium text-foreground">{question.stem}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {[question.classification.specialty?.label, question.classification.domain?.label, question.classification.topic?.label, question.classification.subtopic?.label].filter(Boolean).join(" · ") || "Classification unavailable"}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">Show details</span>
                      <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">Hide details</span>
                    </summary>
                    <div className="space-y-4 border-t p-4 sm:p-5" style={{ borderColor: "var(--border)" }}>
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Options</h3>
                        <ul className="mt-2 space-y-2">
                          {question.options.map((option) => (
                            <li key={option.id} className={`rounded-lg border p-3 text-sm ${option.isCorrect ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
                              <span className="me-2 font-semibold">{option.id}{option.isCorrect ? " · Correct" : ""}</span>{option.text}
                              {option.explanation && <p className="mt-1 text-xs text-muted-foreground">{option.explanation}</p>}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Explanation</h3><p className="mt-1 text-sm text-foreground">{question.explanation.summary}</p></div>
                        <div><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Teaching point</h3><p className="mt-1 text-sm text-foreground">{question.explanation.teachingPoint}</p></div>
                      </div>
                      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                        <div><dt className="text-xs text-muted-foreground">Modalities</dt><dd>{question.classification.modalities.map((item) => item.label).join(", ") || "—"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Competencies</dt><dd>{question.classification.competencies.map((item) => item.label).join(", ") || "—"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Training level · difficulty</dt><dd>{question.classification.trainingLevel?.label ?? "Not supplied"} · {question.classification.difficulty?.label ?? "Not configured"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Tags</dt><dd>{question.classification.tags.map((item) => item.label).join(", ") || "—"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">Source · provenance</dt><dd>{question.source?.title ?? question.source?.type ?? "No source"} · {question.provenance ?? "Unknown"}</dd></div>
                        <div><dt className="text-xs text-muted-foreground">References · media · case</dt><dd>{question.referenceCount} · {question.media.length} · {question.case?.externalId ?? "—"}</dd></div>
                      </dl>
                      {question.errors.length > 0 && <IssueList title="Question errors" issues={question.errors} variant="error" />}
                      {question.warnings.length > 0 && <IssueList title="Question warnings" issues={question.warnings} variant="warning" />}
                    </div>
                  </details>
                </Card>
              ))}
            </div>
          )}
          <div className="flex justify-end border-t pt-4" style={{ borderColor: "var(--border)" }}>
            <Button type="button" onClick={() => void handleConfirm()} disabled={validation.errors.length > 0 || validation.questions.length === 0 || busy !== null}>
              <Check size={16} aria-hidden="true" />
              {busy === "confirm" ? "Importing drafts…" : `Import ${validation.questions.length} Draft Questions`}
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}
