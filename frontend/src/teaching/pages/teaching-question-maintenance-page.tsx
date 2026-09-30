import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card } from "@/components/shared";
import {
  confirmTeachingMaintenanceWorkbook,
  downloadTeachingMaintenanceWorkbook,
  fetchTeachingCatalog,
  previewTeachingMaintenanceWorkbook,
  type TeachingCatalogItem,
  type TeachingMaintenanceExportFilters,
  type TeachingMaintenancePreview,
} from "../api/teaching-api";

const fieldClass = "input-premium h-10 w-full";
const questionStatuses = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In review" },
  { value: "published", label: "Published" },
  { value: "retired", label: "Retired" },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function catalogLabel(items: TeachingCatalogItem[], code: string, allLabel: string): string {
  return code ? items.find((item) => item.code === code)?.label ?? allLabel : allLabel;
}

export function TeachingQuestionMaintenancePage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TeachingMaintenancePreview | null>(null);
  const [busy, setBusy] = useState<"export-selected" | "export-all" | "preview" | "confirm" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ updatedDraft: number; newDraftRevision: number; proposedTopicsCreated: number } | null>(null);
  const [domains, setDomains] = useState<TeachingCatalogItem[]>([]);
  const [topics, setTopics] = useState<TeachingCatalogItem[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [status, setStatus] = useState("draft");
  const [domainCode, setDomainCode] = useState("");
  const [topicCode, setTopicCode] = useState("");

  useEffect(() => {
    let active = true;
    void fetchTeachingCatalog().then((catalog) => {
      if (!active) return;
      setDomains(catalog.domains.filter((item) => item.active));
      setTopics(catalog.topics.filter((item) => item.active));
      setCatalogReady(true);
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Could not load the Teaching catalog.");
    });
    return () => { active = false; };
  }, []);

  const availableTopics = topics.filter((item) => !domainCode || item.parentCode === domainCode);
  const selectedTopic = availableTopics.find((item) => item.code === topicCode);
  const selectedStatusLabel = status ? questionStatuses.find((item) => item.value === status)?.label ?? "Selected status" : "All statuses";
  const selectedScope = `${selectedStatusLabel} · ${catalogLabel(domains, domainCode, "All domains")} · ${selectedTopic?.label ?? "All topics"}`;

  const exportWorkbook = async (filters?: TeachingMaintenanceExportFilters, selected = false) => {
    setBusy(selected ? "export-selected" : "export-all");
    setMessage(null);
    try {
      if (filters) await downloadTeachingMaintenanceWorkbook(filters);
      else await downloadTeachingMaintenanceWorkbook();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  const exportSelected = () => {
    const filters: TeachingMaintenanceExportFilters = {};
    if (status) filters.status = status;
    if (domainCode) filters.domainCode = domainCode;
    if (selectedTopic && (!domainCode || selectedTopic.parentCode === domainCode)) filters.topicCode = selectedTopic.code;
    void exportWorkbook(filters, true);
  };

  const previewWorkbook = async () => {
    if (!file) return;
    setBusy("preview");
    setMessage(null);
    try {
      setPreview(await previewTeachingMaintenanceWorkbook(file));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not preview workbook.");
    } finally {
      setBusy(null);
    }
  };

  const confirm = async () => {
    if (!file || !preview) return;
    setBusy("confirm");
    setMessage(null);
    try {
      setResult(await confirmTeachingMaintenanceWorkbook(file, preview.workbookHash));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm workbook.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration</p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">Question Bank Maintenance</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Export, edit and safely re-import question-bank content. Published revisions are never overwritten; changed published questions receive a new Draft revision.</p>
      </header>
      {message && <Alert variant="error" role="alert"><AlertTitle>Maintenance needs attention</AlertTitle><AlertDescription>{message}</AlertDescription></Alert>}
      {result && <Alert variant="success"><AlertTitle>Maintenance complete</AlertTitle><AlertDescription>{result.updatedDraft} Drafts updated, {result.newDraftRevision} new Draft revisions created, and {result.proposedTopicsCreated} Topics created. Nothing was published automatically. <Link to="/teaching/admin/questions?status=draft" className="underline">View Draft questions</Link></AlertDescription></Alert>}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="font-semibold text-foreground">1. Export</h2>
          <p className="mt-1 text-sm text-muted-foreground">Export a complete workbook or select a smaller maintenance batch.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Status">
            <select aria-label="Status" className={fieldClass} value={status} disabled={busy !== null} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All statuses</option>
              {questionStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Domain">
            <select aria-label="Domain" className={fieldClass} value={domainCode} disabled={!catalogReady || busy !== null} onChange={(event) => { setDomainCode(event.target.value); setTopicCode(""); }}>
              <option value="">All domains</option>
              {domains.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Topic">
            <select aria-label="Topic" className={fieldClass} value={selectedTopic?.code ?? ""} disabled={!catalogReady || availableTopics.length === 0 || busy !== null} onChange={(event) => setTopicCode(event.target.value)}>
              <option value="">All topics</option>
              {availableTopics.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">Selected scope: <span className="font-medium text-foreground">{selectedScope}</span></p>
        <Button type="button" disabled={!catalogReady || busy !== null} onClick={exportSelected}>
          {busy === "export-selected" ? "Preparing selected workbook…" : "Export selected XLSX"}
        </Button>
        <p className="text-xs text-muted-foreground">Smaller domain/topic exports are recommended for focused editorial review and maintenance.</p>
        <hr className="border-border" />
        <p className="text-sm text-muted-foreground">The workbook includes Questions, Options, Sources, References, Media, Taxonomy, Topic Proposals and Instructions sheets.</p>
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => { void exportWorkbook(); }}>
          {busy === "export-all" ? "Preparing workbook…" : "Export all questions XLSX"}
        </Button>
      </Card>
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold text-foreground">2. Upload and preview</h2>
        <input aria-label="Updated XLSX workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setPreview(null); setResult(null); }} />
        <p className="text-xs text-muted-foreground">Maximum 25 MB and 5,000 questions. Media and Taxonomy sheets are reference-only.</p>
        <Button type="button" disabled={!file || busy !== null} onClick={() => void previewWorkbook()}>{busy === "preview" ? "Previewing…" : "Preview changes"}</Button>
      </Card>
      {preview && <Card className="space-y-4 p-5">
        <div><h2 className="font-semibold text-foreground">3. Review changes</h2><p className="mt-1 text-sm text-muted-foreground">Published revisions remain unchanged. Drafts can update in place; all successful changes remain Draft.</p></div>
        <div className="flex flex-wrap gap-2 text-sm">{Object.entries(preview.summary).filter(([key]) => key !== "total").map(([key, count]) => <Badge key={key} variant={count ? "info" : "neutral"}>{key}: {count}</Badge>)}</div>
        {preview.topicProposals.length > 0 && <div><h3 className="font-semibold text-foreground">Proposed Topics</h3><ul className="mt-2 text-sm text-muted-foreground">{preview.topicProposals.map((topic) => <li key={`${topic.domain}-${topic.code}`}>{topic.label} · {topic.domain} · {topic.code}</li>)}</ul></div>}
        {preview.errors.length > 0 && <Alert variant="error"><AlertTitle>Structural errors</AlertTitle><AlertDescription>{preview.errors.map((error) => error.message).join(" ")}</AlertDescription></Alert>}
        <Button type="button" disabled={busy !== null || preview.errors.length > 0 || preview.summary.invalid > 0} onClick={() => void confirm()}>{busy === "confirm" ? "Confirming updates…" : "Confirm Updates"}</Button>
      </Card>}
    </section>
  );
}
