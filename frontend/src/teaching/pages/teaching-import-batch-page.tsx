import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shared";
import { useTeachingAuth } from "../auth/teaching-auth-context";
import { TeachingAccessDenied } from "../components/teaching-access-denied";
import {
  fetchTeachingImportBatch,
  publishTeachingImportBatch,
  validateTeachingImportBatch,
  type TeachingBulkQuestionResult,
  type TeachingBulkPublishResult,
  type TeachingBulkValidationResult,
} from "../api/teaching-api";

type ResultFilter = "all" | "valid" | "warnings" | "invalid" | "draft" | "published";

function value(record: Record<string, unknown>, key: string): string {
  const item = record[key];
  if (item === null || item === undefined || item === "") return "—";
  return String(item);
}

function count(record: Record<string, unknown>, key: string): number {
  const result = Number(record[key] ?? 0);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function questionCountLabel(value: number): string {
  return `${value} question${value === 1 ? "" : "s"}`;
}

function validationLabel(question: TeachingBulkQuestionResult): string {
  if (question.validationStatus === "valid") return "Valid";
  if (question.validationStatus === "valid_with_warnings") return `${question.warnings.length} warning${question.warnings.length === 1 ? "" : "s"}`;
  if (question.validationStatus === "invalid") return `${question.errors.length} error${question.errors.length === 1 ? "" : "s"}`;
  return question.revisionStatus.replaceAll("_", " ");
}

function validationVariant(question: TeachingBulkQuestionResult): "success" | "warning" | "error" | "neutral" {
  if (question.validationStatus === "valid") return "success";
  if (question.validationStatus === "valid_with_warnings") return "warning";
  if (question.validationStatus === "invalid") return "error";
  return "neutral";
}

function filteredQuestions(questions: TeachingBulkQuestionResult[], filter: ResultFilter): TeachingBulkQuestionResult[] {
  switch (filter) {
    case "valid": return questions.filter((question) => question.validationStatus === "valid");
    case "warnings": return questions.filter((question) => question.validationStatus === "valid_with_warnings");
    case "invalid": return questions.filter((question) => question.validationStatus === "invalid");
    case "draft": return questions.filter((question) => question.revisionStatus === "draft");
    case "published": return questions.filter((question) => question.revisionStatus === "published");
    default: return questions;
  }
}

export function TeachingImportBatchPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { batchId = "" } = useParams();
  const { identity } = useTeachingAuth();
  const permissions = identity?.permissions ?? [];
  const canInspect = permissions.some((permission) => ["teaching.author", "teaching.review", "teaching.publish", "teaching.admin"].includes(permission));
  const canValidate = permissions.includes("teaching.author") || permissions.includes("teaching.admin");
  const canPublish = permissions.includes("teaching.publish") || permissions.includes("teaching.admin");
  const [questions, setQuestions] = useState<TeachingBulkQuestionResult[] | null>(null);
  const [validationSummary, setValidationSummary] = useState<TeachingBulkValidationResult | null>(null);
  const [publishSummary, setPublishSummary] = useState<TeachingBulkPublishResult | null>(null);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [confirmPublish, setConfirmPublish] = useState(false);

  const batch = useQuery({ queryKey: ["teaching", "import-batch", batchId], queryFn: () => fetchTeachingImportBatch(batchId), enabled: canInspect && Boolean(batchId) });
  const validate = useMutation({
    mutationFn: () => validateTeachingImportBatch(batchId),
    onSuccess: (result) => {
      setQuestions(result.questions);
      setValidationSummary(result);
      setPublishSummary(null);
      setFilter("all");
    },
  });
  const publish = useMutation({
    mutationFn: () => publishTeachingImportBatch(batchId),
    onSuccess: (result) => {
      setQuestions(result.results);
      setPublishSummary(result);
      setConfirmPublish(false);
      setFilter(result.invalid > 0 ? "invalid" : "all");
      void queryClient.invalidateQueries({ queryKey: ["teaching", "import-batch", batchId] });
    },
  });

  if (!canInspect) return <TeachingAccessDenied capability="Teaching editorial access" />;
  if (batch.isPending) return <LoadingState message="Loading Teaching import batch…" />;
  if (batch.isError) return <ErrorState title="Could not load import batch" message={batch.error.message} onRetry={() => void batch.refetch()} />;
  const data = batch.data;
  if (!data) return <ErrorState title="Import batch not found" message="The Teaching import batch is unavailable." />;

  const publication = typeof data.publication === "object" && data.publication !== null
    ? data.publication as Record<string, unknown>
    : {};
  const initialCount = count(data, "questionCount");
  const items = questions ?? [];
  const visibleQuestions = filteredQuestions(items, filter);
  const eligibleCount = items.filter((question) => question.eligibleForPublish && question.revisionStatus === "draft").length;
  const invalidCount = items.filter((question) => question.validationStatus === "invalid").length;
  const warningQuestions = items.filter((question) => question.eligibleForPublish && question.revisionStatus === "draft" && question.validationStatus === "valid_with_warnings");
  const totalWarnings = warningQuestions.reduce((sum, question) => sum + question.warnings.length, 0);
  const filters: Array<{ value: ResultFilter; label: string; count: number }> = [
    { value: "all", label: "All", count: items.length },
    { value: "valid", label: "Valid", count: items.filter((question) => question.validationStatus === "valid").length },
    { value: "warnings", label: "Warnings", count: items.filter((question) => question.validationStatus === "valid_with_warnings").length },
    { value: "invalid", label: "Invalid", count: invalidCount },
    { value: "draft", label: "Draft", count: items.filter((question) => question.revisionStatus === "draft").length },
    { value: "published", label: "Published", count: items.filter((question) => question.revisionStatus === "published").length },
  ];
  const uploader = typeof data.uploader === "object" && data.uploader !== null && "identitySubject" in data.uploader ? String((data.uploader as { identitySubject: unknown }).identitySubject) : "—";
  const canOperate = data.status === "confirmed";

  return (
    <section aria-labelledby="teaching-import-batch-title" className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration · Import lineage</p>
          <h1 id="teaching-import-batch-title" className="mt-1 text-2xl font-semibold text-foreground">Import batch</h1>
          <p className="mt-2 break-all font-mono text-sm text-muted-foreground">{batchId}</p>
          <p className="mt-1 text-sm text-muted-foreground">{initialCount} questions · {value(data, "originalFilename")}</p>
        </div>
        <Badge variant="info">{value(data, "status")}</Badge>
      </div>

      <Card className="space-y-5 p-4 sm:p-6">
        <div>
          <h2 className="font-semibold text-foreground">Validation</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Valid</dt><dd className="mt-1 text-xl font-semibold text-foreground">{validationSummary?.valid ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Valid with warnings</dt><dd className="mt-1 text-xl font-semibold text-foreground">{validationSummary?.validWithWarnings ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Invalid</dt><dd className="mt-1 text-xl font-semibold text-foreground">{validationSummary?.invalid ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Changed during validation</dt><dd className="mt-1 text-xl font-semibold text-foreground">{validationSummary?.conflicts ?? 0}</dd></div>
          </dl>
        </div>
        <div>
          <h2 className="font-semibold text-foreground">Publication</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted-foreground">Published</dt><dd className="mt-1 text-xl font-semibold text-foreground">{count(publication, "published")}</dd></div>
            <div><dt className="text-muted-foreground">Draft</dt><dd className="mt-1 text-xl font-semibold text-foreground">{count(publication, "draft")}</dd></div>
            <div><dt className="text-muted-foreground">In Review</dt><dd className="mt-1 text-xl font-semibold text-foreground">{count(publication, "inReview")}</dd></div>
            <div><dt className="text-muted-foreground">Retired</dt><dd className="mt-1 text-xl font-semibold text-foreground">{count(publication, "retired")}</dd></div>
          </dl>
        </div>
        {canOperate ? (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
            {canValidate ? <Button type="button" variant="secondary" disabled={validate.isPending || publish.isPending} onClick={() => validate.mutate()}>
              {validate.isPending ? `Validating ${initialCount} questions…` : "Validate All"}
            </Button> : null}
            {canPublish ? <Button type="button" disabled={!questions || eligibleCount === 0 || validate.isPending || publish.isPending} onClick={() => setConfirmPublish(true)}>
              Publish All Eligible{questions ? ` (${eligibleCount})` : ""}
            </Button> : null}
            {validate.isPending ? <span role="status" className="text-sm text-muted-foreground">Evaluating current Draft revisions with Teaching validation rules.</span> : null}
            {publish.isPending ? <span role="status" className="text-sm text-muted-foreground">Publishing eligible questions…</span> : null}
            {validate.error ? <p role="alert" className="w-full text-sm text-destructive">{validate.error.message}</p> : null}
            {publish.error ? <p role="alert" className="w-full text-sm text-destructive">{publish.error.message}</p> : null}
            {publishSummary ? <p role="status" className="w-full text-sm text-muted-foreground">
              {publishSummary.published} published · {publishSummary.invalid} invalid · {publishSummary.conflicts} conflicts · {publishSummary.alreadyPublished} already published
              {publishSummary.requiresReview ? ` · ${publishSummary.requiresReview} require author and review access` : ""}
            </p> : null}
          </div>
        ) : null}
      </Card>

      {questions ? (
        <Card className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">Question results</h2>
              <p className="mt-1 text-sm text-muted-foreground">Errors keep a Draft question unchanged. Warnings do not block publication.</p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter questions">
              {filters.map((item) => <Button key={item.value} type="button" size="sm" variant={filter === item.value ? "primary" : "secondary"} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>
                {item.label} ({item.count})
              </Button>)}
            </div>
          </div>
          {validationSummary?.conflicts ? <p role="status" className="text-sm text-warning">{validationSummary.conflicts} question(s) changed during validation. Run Validate All again before publishing.</p> : null}
          {publishSummary?.requiresReview ? <p role="status" className="text-sm text-warning">Some valid Drafts need both author and review capabilities before the existing lifecycle can publish them.</p> : null}
          {visibleQuestions.length ? <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <Table className="min-w-[760px]">
              <TableHeader><TableRow><TableHead>External ID</TableHead><TableHead>Stem preview</TableHead><TableHead>Validation</TableHead><TableHead>Status</TableHead><TableHead>Issues</TableHead><TableHead>Action</TableHead></TableRow></TableHeader>
              <TableBody>{visibleQuestions.map((question) => (
                <TableRow key={question.questionId}>
                  <TableCell className="whitespace-nowrap font-medium">{question.externalId}</TableCell>
                  <TableCell className="max-w-sm min-w-56"><span className="line-clamp-2">{question.stemPreview}</span></TableCell>
                  <TableCell><Badge variant={validationVariant(question)}>{validationLabel(question)}</Badge></TableCell>
                  <TableCell className="capitalize">{question.revisionStatus.replaceAll("_", " ")}</TableCell>
                  <TableCell className="max-w-sm min-w-56">
                    {question.errors.length ? <ul className="list-disc space-y-1 ps-4 text-sm text-destructive">{question.errors.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
                    {!question.errors.length && question.warnings.length ? <ul className="list-disc space-y-1 ps-4 text-sm text-warning">{question.warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
                    {!question.errors.length && !question.warnings.length && question.publishStatus === "conflict" ? <span className="text-sm text-warning">Changed during publication; validate again.</span> : null}
                    {!question.errors.length && !question.warnings.length && question.publishStatus === "requires_review" ? <span className="text-sm text-muted-foreground">Author and review access are required.</span> : null}
                  </TableCell>
                  <TableCell>{question.revisionStatus === "draft" && question.validationStatus === "invalid" ? <Link className="text-accent underline-offset-4 hover:underline" to={`/teaching/admin/questions/${question.questionId}`}>Edit</Link> : question.publishStatus === "already_published" ? <span className="text-sm text-muted-foreground">Already published</span> : "—"}</TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </div> : <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">No questions match this filter.</p>}
          {invalidCount > 0 ? <p className="text-sm font-medium text-destructive">{invalidCount} question{invalidCount === 1 ? " requires" : "s require"} attention and remain Draft.</p> : null}
          {totalWarnings > 0 ? <p className="text-sm text-warning">{warningQuestions.length} eligible question{warningQuestions.length === 1 ? " contains" : "s contain"} {totalWarnings} warning{totalWarnings === 1 ? "" : "s"}.</p> : null}
        </Card>
      ) : <p className="text-sm text-muted-foreground">Run Validate All to see per-question validation and exceptions for this batch.</p>}

      <Card className="p-4 sm:p-6">
        <h2 className="font-semibold text-foreground">Import audit details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted-foreground">Schema version</dt><dd>{value(data, "schemaVersion")}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Imported by</dt><dd>{uploader}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Import date</dt><dd>{data.createdAt ? new Date(String(data.createdAt)).toLocaleString() : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confirmed date</dt><dd>{data.confirmedAt ? new Date(String(data.confirmedAt)).toLocaleString() : "—"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Confirmed by</dt><dd>{typeof data.confirmedBy === "object" && data.confirmedBy !== null && "identitySubject" in data.confirmedBy ? String((data.confirmedBy as { identitySubject: unknown }).identitySubject) : "—"}</dd></div>
        </dl>
        {data.failureMessage ? <p role="alert" className="mt-4 text-sm text-destructive">{String(data.failureMessage)}</p> : null}
      </Card>
      <div className="flex flex-wrap gap-3"><Button variant="secondary" onClick={() => navigate("/teaching/admin/questions")}>Back to questions</Button></div>

      <Dialog open={confirmPublish} onClose={() => { if (!publish.isPending) setConfirmPublish(false); }}>
        <DialogContent maxWidth="560px" aria-labelledby="teaching-batch-publish-title">
          <DialogHeader>
            <DialogTitle id="teaching-batch-publish-title">Publish imported questions?</DialogTitle>
            <DialogDescription>This action publishes immutable question revisions. Each question is revalidated on the server before its lifecycle transitions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-foreground">
            <p><strong>{questionCountLabel(eligibleCount)}</strong> {eligibleCount === 1 ? "is" : "are"} eligible for publication.</p>
            <p><strong>{questionCountLabel(invalidCount)}</strong> {invalidCount === 1 ? "contains" : "contain"} validation errors and will remain Draft.</p>
            <p><strong>{warningQuestions.length} eligible question{warningQuestions.length === 1 ? "" : "s"}</strong> {warningQuestions.length === 1 ? "contains" : "contain"} {totalWarnings} warning{totalWarnings === 1 ? "" : "s"}. Warnings do not block publication.</p>
            {warningQuestions.length ? <details className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
              <summary className="cursor-pointer font-medium">View warnings</summary>
              <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                {warningQuestions.map((question) => <li key={question.questionId}><span className="font-medium">{question.externalId}:</span> {question.warnings.map((issue) => issue.message).join("; ")}</li>)}
              </ul>
            </details> : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={publish.isPending} onClick={() => setConfirmPublish(false)}>Cancel</Button>
            <Button disabled={publish.isPending || eligibleCount === 0} onClick={() => publish.mutate()}>
              {publish.isPending ? "Publishing…" : `Publish ${questionCountLabel(eligibleCount)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
