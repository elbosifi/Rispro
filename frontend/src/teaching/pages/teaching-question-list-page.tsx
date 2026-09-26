import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownAZ, ArrowUpDown, Plus, Search } from "lucide-react";
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, Input, LoadingState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/shared";
import { useTeachingAuth } from "../auth/teaching-auth-context";
import { fetchTeachingCatalog, fetchTeachingQuestions, validateAndPublishTeachingQuestionMatching, validateTeachingQuestionMatching, type TeachingBulkPublishResult, type TeachingBulkValidationResult, type TeachingCatalogItem, type TeachingQuestionStatus } from "../api/teaching-api";

const PAGE_SIZE = 20;

function StatusBadge({ status }: { status: TeachingQuestionStatus }) {
  const variant = status === "published" ? "success" : status === "in_review" ? "info" : status === "draft" ? "draft" : "neutral";
  return <Badge variant={variant}>{status.replace("_", " ")}</Badge>;
}

function optionsBelow(items: TeachingCatalogItem[], parentCode: string | null): TeachingCatalogItem[] {
  return parentCode ? items.filter((item) => item.parentCode === parentCode) : [];
}

export function TeachingQuestionListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { identity } = useTeachingAuth();
  const canAuthor = Boolean(identity?.permissions.includes("teaching.author") || identity?.permissions.includes("teaching.admin"));
  const canPublish = Boolean(identity?.permissions.includes("teaching.publish") || identity?.permissions.includes("teaching.admin"));
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [validationSummary, setValidationSummary] = useState<TeachingBulkValidationResult | null>(null);
  const [publishSummary, setPublishSummary] = useState<TeachingBulkPublishResult | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const catalog = useQuery({ queryKey: ["teaching", "catalog"], queryFn: fetchTeachingCatalog, staleTime: 60_000 });
  const query = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(Math.max(1, Number(params.get("page") ?? "1") || 1)));
    params.set("pageSize", String(PAGE_SIZE));
    params.set("sort", params.get("sort") || "updated");
    params.set("direction", params.get("direction") || "desc");
    return params;
  }, [searchParams]);
  const questions = useQuery({
    queryKey: ["teaching", "admin-questions", query.toString()],
    queryFn: () => fetchTeachingQuestions(query),
  });
  const matchingFilters = useMemo(() => {
    const filters = new URLSearchParams(searchParams);
    for (const key of ["page", "pageSize", "limit", "offset", "sort", "direction"]) filters.delete(key);
    return Object.fromEntries(filters.entries());
  }, [searchParams]);
  const validateMatching = useMutation({
    mutationFn: () => validateTeachingQuestionMatching(matchingFilters),
    onSuccess: (result) => {
      setValidationSummary(result);
      setPublishSummary(null);
      void queryClient.invalidateQueries({ queryKey: ["teaching", "admin-questions"] });
    },
  });
  const publishMatching = useMutation({
    mutationFn: () => validateAndPublishTeachingQuestionMatching(matchingFilters),
    onSuccess: (result) => {
      setPublishSummary(result);
      setValidationSummary(null);
      setConfirmPublish(false);
      void queryClient.invalidateQueries({ queryKey: ["teaching", "admin-questions"] });
    },
  });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setSearchParams(next);
  };
  const select = (label: string, key: string, items: Array<{ code: string; label: string }>, disabled = false) => (
    <label className="block min-w-36 flex-1 text-xs font-medium text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      <select
        aria-label={label}
        className="input-premium h-10 w-full"
        value={searchParams.get(key) ?? ""}
        onChange={(event) => setFilter(key, event.target.value)}
        disabled={disabled}
      >
        <option value="">All {label.toLowerCase()}</option>
        {items.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
      </select>
    </label>
  );

  const specialtyCode = searchParams.get("specialtyCode");
  const domainCode = searchParams.get("domainCode");
  const topicCode = searchParams.get("topicCode");
  const domains = optionsBelow(catalog.data?.domains ?? [], specialtyCode);
  const topics = optionsBelow(catalog.data?.topics ?? [], domainCode);
  const subtopics = optionsBelow(catalog.data?.subtopics ?? [], topicCode);
  const requestedPage = Number(query.get("page"));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : questions.data?.pagination.page ?? 1;
  const pagination = questions.data?.pagination;
  const eligibleForPublish = validationSummary?.eligibleForPublish ?? 0;
  const showAttention = () => {
    const next = new URLSearchParams(searchParams);
    next.set("status", "draft");
    next.set("validationStatus", "invalid");
    next.set("page", "1");
    setSearchParams(next);
  };

  const sortItems = [
    { value: "updated", label: "Recently updated" },
    { value: "externalId", label: "External ID" },
    { value: "status", label: "Status" },
    { value: "difficulty", label: "Difficulty" },
  ];

  return (
    <section aria-labelledby="teaching-questions-title" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration</p>
          <h1 id="teaching-questions-title" className="mt-1 text-2xl font-semibold text-foreground">Question Bank</h1>
          <p className="mt-2 text-sm text-muted-foreground">Review and maintain Teaching question content.</p>
        </div>
        {canAuthor ? <Button onClick={() => navigate("/teaching/admin/questions/new")}>
          <Plus size={16} aria-hidden="true" /> New question
        </Button> : null}
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setFilter("search", search.trim()); }}>
          <label className="min-w-60 flex-[2] text-xs font-medium text-muted-foreground" htmlFor="teaching-question-search">
            <span className="mb-1 block">Search external ID, stem, source, or case ID</span>
            <Input id="teaching-question-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search questions" />
          </label>
          <Button type="submit" variant="secondary"><Search size={16} aria-hidden="true" /> Search</Button>
          <label className="block min-w-36 flex-1 text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">Status</span>
            <select aria-label="Status" className="input-premium h-10 w-full" value={searchParams.get("status") ?? ""} onChange={(event) => setFilter("status", event.target.value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="in_review">In Review</option>
              <option value="published">Published</option>
              <option value="retired">Retired</option>
            </select>
          </label>
          {select("Specialty", "specialtyCode", catalog.data?.specialties ?? [])}
          {select("Domain", "domainCode", domains, !specialtyCode)}
          {select("Topic", "topicCode", topics, !domainCode)}
          {select("Subtopic", "subtopicCode", subtopics, !topicCode)}
          {select("Question type", "type", [
            { code: "single_best_answer", label: "Single best answer" },
            { code: "image_based_sba", label: "Image-based SBA" },
            { code: "case_based_sba", label: "Case-based SBA" },
          ])}
          {select("Difficulty", "difficulty", (catalog.data?.difficulties ?? []).map((item) => ({ code: String(item.value), label: item.label })))}
          {select("Training level", "trainingLevelCode", catalog.data?.trainingLevels ?? [])}
          {select("Tag", "tagCode", catalog.data?.tags ?? [])}
          {select("Source type", "sourceType", (catalog.data?.supportedSourceTypes ?? []).map((item) => ({ code: item, label: item.replaceAll("_", " ") })))}
          <label className="block min-w-36 flex-1 text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">Image</span>
            <select aria-label="Image" className="input-premium h-10 w-full" value={searchParams.get("hasImage") ?? ""} onChange={(event) => setFilter("hasImage", event.target.value)}>
              <option value="">Any</option><option value="true">Has image</option><option value="false">No image</option>
            </select>
          </label>
          <label className="block min-w-36 flex-1 text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">Origin</span>
            <select aria-label="Origin" className="input-premium h-10 w-full" value={searchParams.get("imported") ?? ""} onChange={(event) => setFilter("imported", event.target.value)}>
              <option value="">Imported or manual</option><option value="true">Imported</option><option value="false">Manual</option>
            </select>
          </label>
          <label className="block min-w-40 text-xs font-medium text-muted-foreground">
            <span className="mb-1 block">Sort by</span>
            <select aria-label="Sort by" className="input-premium h-10 w-full" value={searchParams.get("sort") ?? "updated"} onChange={(event) => setFilter("sort", event.target.value)}>
              {sortItems.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <Button
            type="button"
            variant="ghost"
            title={`Sort ${searchParams.get("direction") === "asc" ? "descending" : "ascending"}`}
            aria-label="Toggle sort direction"
            onClick={() => setFilter("direction", searchParams.get("direction") === "asc" ? "desc" : "asc")}
          >
            {searchParams.get("direction") === "asc" ? <ArrowDownAZ size={16} /> : <ArrowUpDown size={16} />} Direction
          </Button>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm text-muted-foreground" style={{ borderColor: "var(--border)" }}>
          <span>{pagination ? `${pagination.total} questions · page ${pagination.page} of ${Math.max(1, pagination.totalPages)}` : "Loading question count…"}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span>Filters are saved in this page URL.</span>
            {canAuthor ? <Button type="button" size="sm" variant="secondary" disabled={validateMatching.isPending} onClick={() => validateMatching.mutate()}>
              {validateMatching.isPending ? "Validating all matching…" : "Validate all matching"}
            </Button> : null}
            {canPublish ? <Button type="button" size="sm" disabled={validateMatching.isPending || !validationSummary || eligibleForPublish === 0} onClick={() => setConfirmPublish(true)}>
              {validationSummary ? `Validate & publish all eligible (${eligibleForPublish})` : "Validate & publish all eligible"}
            </Button> : null}
          </div>
        </div>
        {validateMatching.error ? <p role="alert" className="text-sm text-destructive">{validateMatching.error.message}</p> : null}
        {publishMatching.error ? <p role="alert" className="text-sm text-destructive">{publishMatching.error.message}</p> : null}
        {validationSummary ? <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>Matched {validationSummary.total}: {validationSummary.valid} valid, {validationSummary.validWithWarnings} with warnings, {validationSummary.invalid} invalid.</span>
          {validationSummary.invalid || validationSummary.conflicts ? <Button type="button" size="sm" variant="ghost" onClick={showAttention}>View invalid Drafts</Button> : null}
        </div> : null}
        {publishSummary ? <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{publishSummary.requested} matched: {publishSummary.published} published, {publishSummary.warnings} published with warnings, {publishSummary.invalid} invalid / remain Draft, {publishSummary.conflicts} conflicts, {publishSummary.alreadyPublished} already published.</span>
          {publishSummary.invalid || publishSummary.conflicts ? <Button type="button" size="sm" variant="ghost" onClick={showAttention}>View invalid Drafts</Button> : null}
        </div> : null}
      </Card>

      {questions.isPending ? <LoadingState message="Loading Teaching questions…" /> : null}
      {questions.isError ? <ErrorState title="Could not load questions" message={questions.error.message} onRetry={() => void questions.refetch()} /> : null}
      {catalog.isError ? <ErrorState title="Could not load Teaching filters" message={catalog.error.message} onRetry={() => void catalog.refetch()} /> : null}
      {questions.data?.items.length === 0 ? <EmptyState message="No questions found. Adjust the search or filters, or create a new Draft question." /> : null}
      {questions.data?.items.length ? (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[1100px]">
              <TableHeader><TableRow>
                <TableHead>External ID</TableHead><TableHead>Stem</TableHead><TableHead>Status</TableHead><TableHead>Validation</TableHead>
                <TableHead>Type</TableHead><TableHead>Domain / Topic</TableHead><TableHead>Difficulty</TableHead>
                <TableHead>Level</TableHead><TableHead>Source</TableHead><TableHead>Revision</TableHead><TableHead>Updated</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {questions.data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap font-medium"><Link className="text-accent underline-offset-4 hover:underline" to={`/teaching/admin/questions/${item.id}`}>{item.externalId}</Link></TableCell>
                    <TableCell className="max-w-[28rem] min-w-64"><Link className="line-clamp-2 text-foreground hover:text-accent" to={`/teaching/admin/questions/${item.id}`}>{item.revision.stem}</Link></TableCell>
                    <TableCell><StatusBadge status={item.revision.status} /></TableCell>
                    <TableCell>{item.validation ? <Badge variant={item.validation.classification === "invalid" ? "error" : item.validation.classification === "valid_with_warnings" ? "warning" : "success"}>
                      {item.validation.classification === "invalid" ? `${item.validation.errorCount} Errors` : item.validation.classification === "valid_with_warnings" ? `${item.validation.warningCount} Warnings` : "Valid"}
                    </Badge> : <Badge variant="neutral">Not validated</Badge>}</TableCell>
                    <TableCell className="whitespace-nowrap">{item.revision.type.replaceAll("_", " ")}</TableCell>
                    <TableCell className="min-w-44">{item.classification.domain.label}{item.classification.topic ? <span className="block text-xs text-muted-foreground">{item.classification.topic.label}</span> : null}</TableCell>
                    <TableCell>{item.classification.difficulty}</TableCell>
                    <TableCell>{item.classification.trainingLevel?.label ?? "—"}</TableCell>
                    <TableCell className="max-w-48 truncate" title={item.sourceTitle ?? undefined}>{item.sourceTitle ?? "—"}</TableCell>
                    <TableCell>v{item.revision.revisionNumber}</TableCell>
                    <TableCell className="whitespace-nowrap">Updated {new Date(item.updatedAt).toLocaleDateString()}<span className="block text-xs text-muted-foreground">Created {new Date(item.createdAt).toLocaleDateString()}</span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3" style={{ borderColor: "var(--border)" }}>
            <Button type="button" variant="secondary" disabled={!pagination || page <= 1} onClick={() => setFilter("page", String(page - 1))}>Previous</Button>
            <span className="text-sm text-muted-foreground">{pagination ? `Page ${page} of ${Math.max(pagination.totalPages, 1)}` : ""}</span>
            <Button type="button" variant="secondary" disabled={!pagination || page >= pagination.totalPages} onClick={() => setFilter("page", String(page + 1))}>Next</Button>
          </div>
        </Card>
      ) : null}

      <Dialog open={confirmPublish} onClose={() => { if (!publishMatching.isPending) setConfirmPublish(false); }}>
        <DialogContent maxWidth="560px" aria-labelledby="teaching-matching-publish-title">
          <DialogHeader>
            <DialogTitle id="teaching-matching-publish-title">Publish all eligible matching questions?</DialogTitle>
            <DialogDescription>The server will revalidate each matching Draft question before applying its existing lifecycle transitions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-foreground">
            <p><strong>{validationSummary?.total ?? 0} questions</strong> match the current filters.</p>
            <p><strong>{eligibleForPublish} eligible questions</strong> will be published.</p>
            <p><strong>{validationSummary?.validWithWarnings ?? 0} questions have warnings.</strong> Warnings do not block publication.</p>
            <p><strong>{validationSummary?.invalid ?? 0} questions contain errors</strong> and will remain Draft.</p>
          </div>
          <DialogFooter>
            <Button variant="secondary" disabled={publishMatching.isPending} onClick={() => setConfirmPublish(false)}>Cancel</Button>
            <Button disabled={publishMatching.isPending || eligibleForPublish === 0} onClick={() => publishMatching.mutate()}>
              {publishMatching.isPending ? "Publishing…" : `Publish ${eligibleForPublish} eligible questions`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
