import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, LoadingState, SearchInput } from "@/components/shared";
import {
  fetchTeachingCatalog,
  fetchTeachingProgress,
  fetchTeachingProgressBreakdown,
  fetchTeachingProgressCycles,
  fetchTeachingProgressPreview,
  resetTeachingProgress,
  type TeachingProgressDimension,
  type TeachingResetScope,
} from "../api/teaching-api";

const questionBank = "radiology-main";
const dimensions: Array<{ value: TeachingProgressDimension; label: string }> = [
  { value: "domain", label: "Domain" },
  { value: "topic", label: "Topic" },
  { value: "modality", label: "Modality" },
  { value: "competency", label: "Competency" },
  { value: "difficulty", label: "Difficulty" },
  { value: "tag", label: "Tag" },
];
const fieldClass = "w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground";

function percent(value: number | null): string {
  return value === null ? "No attempts" : `${value}%`;
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

function answerTime(value: number | null): string {
  return value === null ? "—" : `${Math.round(value / 1000)} sec`;
}

export function TeachingProgressPage() {
  const queryClient = useQueryClient();
  const [dimension, setDimension] = useState<TeachingProgressDimension>("domain");
  const [topicDomain, setTopicDomain] = useState("");
  const [tagSearch, setTagSearch] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetType, setResetType] = useState<"bank" | "domain" | "topic">("bank");
  const [resetDomain, setResetDomain] = useState("");
  const [resetTopic, setResetTopic] = useState("");
  const [historyScope, setHistoryScope] = useState<TeachingResetScope>({ type: "bank" });

  const catalog = useQuery({ queryKey: ["teaching", "catalog"], queryFn: fetchTeachingCatalog, staleTime: 60_000 });
  const progress = useQuery({ queryKey: ["teaching", "progress", questionBank], queryFn: () => fetchTeachingProgress(questionBank), staleTime: 0 });
  const breakdown = useQuery({
    queryKey: ["teaching", "progress-breakdown", questionBank, dimension, topicDomain, tagSearch],
    queryFn: () => fetchTeachingProgressBreakdown(dimension, {
      questionBank,
      ...(dimension === "topic" && topicDomain ? { domain: topicDomain } : {}),
      ...(dimension === "tag" && tagSearch ? { search: tagSearch } : {}),
    }),
  });
  const cycles = useQuery({
    queryKey: ["teaching", "progress-cycles", questionBank, historyScope],
    queryFn: () => fetchTeachingProgressCycles(questionBank, historyScope),
  });

  const resetScope = useMemo<TeachingResetScope | null>(() => {
    if (resetType === "bank") return { type: "bank" };
    if (resetType === "domain") return resetDomain ? { type: "domain", code: resetDomain } : null;
    if (!resetDomain || !resetTopic) return null;
    return { type: "topic", code: resetTopic, domain: resetDomain };
  }, [resetType, resetDomain, resetTopic]);
  const preview = useQuery({
    queryKey: ["teaching", "progress-preview", questionBank, resetScope],
    queryFn: () => fetchTeachingProgressPreview(questionBank, resetScope!),
    enabled: resetOpen && resetScope !== null,
  });
  const reset = useMutation({
    mutationFn: () => resetTeachingProgress({
      questionBank,
      scope: resetScope!,
      idempotencyKey: crypto.randomUUID(),
    }),
    onSuccess: () => {
      setResetOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["teaching"] });
    },
  });

  if (catalog.isLoading || progress.isLoading) return <LoadingState message="Loading your Teaching progress" />;
  if (catalog.isError || !catalog.data || progress.isError || !progress.data) {
    return <ErrorState message="Your Teaching progress could not be loaded." onRetry={() => { void catalog.refetch(); void progress.refetch(); }} />;
  }

  const data = progress.data;
  const domains = catalog.data.domains.filter((item) => item.active);
  const topics = catalog.data.topics.filter((item) => item.active && item.parentCode === resetDomain);
  const topicFilterDomains = domains;
  const displayRows = breakdown.data?.items ?? [];
  const cards = [
    { label: "Current cycle", value: `${data.currentCycle.attempted} / ${data.currentCycle.eligible}`, detail: `${data.currentCycle.completionPercent}% complete` },
    { label: "Current-cycle accuracy", value: percent(data.currentCycle.accuracyPercent), detail: `${data.currentCycle.correct} / ${data.currentCycle.attempted} latest answers correct` },
    { label: "First-pass accuracy", value: percent(data.lifetime.firstPassAccuracyPercent), detail: `${data.lifetime.firstPassCorrect} / ${data.lifetime.firstPassAttempted} first answers correct` },
    { label: "Incorrect this cycle", value: data.currentCycle.incorrect, detail: `${data.currentCycle.unseen} unseen` },
    { label: "Lifetime attempts", value: data.lifetime.totalAttempts, detail: `${data.lifetime.uniqueAttempted} unique questions` },
    { label: "Average answer time", value: answerTime(data.lifetime.averageAnswerTimeMs), detail: "Lifetime timed answers" },
  ];

  const selectHistoryForRow = (code: string) => {
    if (dimension === "domain") setHistoryScope({ type: "domain", code });
    else if (dimension === "topic") setHistoryScope({ type: "topic", code, ...(topicDomain ? { domain: topicDomain } : {}) });
  };

  return (
    <section aria-labelledby="teaching-progress-title" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching</p>
          <h1 id="teaching-progress-title" className="mt-1 text-2xl font-semibold text-foreground">Progress</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Resetting progress starts a new study cycle. Previous attempts, sessions, bookmarks, and notes stay in your history.</p>
        </div>
        <Button variant="secondary" onClick={() => { setResetType("bank"); setResetOpen(true); }}>
          <RotateCcw size={16} aria-hidden="true" /> Reset progress
        </Button>
      </header>

      <section aria-label="Current cycle and lifetime summary" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.label} className="p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.detail}</p>
          </Card>
        ))}
      </section>

      <Card className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Performance by dimension</h2>
            <p className="mt-1 text-sm text-muted-foreground">Each result includes its sample count. Multi-classified questions contribute to every matching dimension.</p>
          </div>
          <label className="w-full text-sm font-medium text-foreground sm:w-56">
            Analyze by
            <select className={`${fieldClass} mt-1`} value={dimension} onChange={(event) => { setDimension(event.target.value as TeachingProgressDimension); setTopicDomain(""); }}>
              {dimensions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
        {dimension === "topic" && (
          <label className="block max-w-sm text-sm font-medium text-foreground">
            Domain
            <select className={`${fieldClass} mt-1`} value={topicDomain} onChange={(event) => setTopicDomain(event.target.value)}>
              <option value="">All domains</option>
              {topicFilterDomains.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
            </select>
          </label>
        )}
        {dimension === "tag" && (
          <label className="block max-w-sm text-sm font-medium text-foreground">
            Find tags
            <SearchInput className="mt-1" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="Search tag names or codes" showClearButton onClear={() => setTagSearch("")} />
          </label>
        )}
        {breakdown.isLoading ? <LoadingState message="Loading performance breakdown" />
          : breakdown.isError ? <ErrorState message="The breakdown could not be loaded." onRetry={() => void breakdown.refetch()} />
            : displayRows.length === 0 ? <EmptyState message={dimension === "tag" ? "No attempted tags match this search yet." : "No active classifications are available."} />
              : <div className="overflow-x-auto">
                <table className="w-full min-w-[44rem] text-left text-sm">
                  <thead><tr className="border-b text-xs uppercase tracking-wide text-muted-foreground" style={{ borderColor: "var(--border)" }}>
                    <th className="py-3 pe-4">{dimensions.find((item) => item.value === dimension)?.label}</th>
                    <th className="py-3 pe-4">Current progress</th><th className="py-3 pe-4">Current accuracy</th>
                    <th className="py-3 pe-4">First pass</th><th className="py-3 pe-4">Avg. answer time</th><th className="py-3">History</th>
                  </tr></thead>
                  <tbody>
                    {displayRows.map((row) => <tr key={row.code} className="border-b last:border-0" style={{ borderColor: "var(--border)" }}>
                      <th scope="row" className="py-3 pe-4 font-medium text-foreground">
                        {row.label}
                        {dimension === "domain" && <button type="button" className="ms-2 text-xs font-medium text-accent hover:underline" onClick={() => { setDimension("topic"); setTopicDomain(row.code); }}>Topics</button>}
                      </th>
                      <td className="py-3 pe-4 tabular-nums">{row.attempted} / {row.eligible} · {row.completionPercent}%</td>
                      <td className="py-3 pe-4 tabular-nums">{row.correct} / {row.attempted} · {percent(row.accuracyPercent)}</td>
                      <td className="py-3 pe-4 tabular-nums">{row.firstPassCorrect} / {row.firstPassAttempted} · {percent(row.firstPassAccuracyPercent)}</td>
                      <td className="py-3 pe-4 tabular-nums">{answerTime(row.averageAnswerTimeMs)} <span className="text-xs text-muted-foreground">({row.timedAttemptCount})</span></td>
                      <td className="py-3"><button type="button" className="font-medium text-accent hover:underline" onClick={() => selectHistoryForRow(row.code)}>{dimension === "domain" || dimension === "topic" ? "View cycles" : "—"}</button></td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Study-cycle history</h2>
            <p className="mt-1 text-sm text-muted-foreground">Closed cycle results are snapshots. Later publications and retirements do not change them.</p>
          </div>
          <p className="text-sm text-muted-foreground">{cycles.data?.scope.label ?? "Question bank"}</p>
        </div>
        {cycles.isLoading ? <LoadingState message="Loading cycle history" />
          : cycles.isError || !cycles.data ? <ErrorState message="Cycle history could not be loaded." onRetry={() => void cycles.refetch()} />
            : <ol className="mt-4 space-y-3">
              {cycles.data.items.map((cycle) => <li key={cycle.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-foreground">{cycle.current ? "Current" : `Cycle ${cycle.cycleNumber}`}</h3>
                  <p className="text-sm text-muted-foreground">{dateLabel(cycle.startedAt)}{cycle.endedAt ? ` – ${dateLabel(cycle.endedAt)}` : " · In progress"}</p>
                </div>
                <p className="mt-2 text-sm tabular-nums text-foreground">
                  {cycle.attempted} / {cycle.eligible} complete · {cycle.completionPercent}% · {cycle.correct} / {cycle.attempted} correct · {percent(cycle.accuracyPercent)}
                </p>
              </li>)}
            </ol>}
      </Card>

      <Dialog open={resetOpen} onClose={() => !reset.isPending && setResetOpen(false)}>
        <DialogContent maxWidth="560px" scrollable>
          <DialogHeader>
            <div>
              <DialogTitle>Reset {preview.data?.scope.label ?? "progress"}?</DialogTitle>
              <DialogDescription>Start a new cycle for a question-bank scope.</DialogDescription>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-medium text-foreground">
              Scope
              <select className={`${fieldClass} mt-1`} value={resetType} onChange={(event) => { setResetType(event.target.value as typeof resetType); setResetTopic(""); }}>
                <option value="bank">Entire Radiology Question Bank</option><option value="domain">Domain</option><option value="topic">Topic</option>
              </select>
            </label>
            {(resetType === "domain" || resetType === "topic") && <label className="block text-sm font-medium text-foreground">
              Domain
              <select className={`${fieldClass} mt-1`} value={resetDomain} onChange={(event) => { setResetDomain(event.target.value); setResetTopic(""); }}>
                <option value="">Choose a domain</option>{domains.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>}
            {resetType === "topic" && <label className="block text-sm font-medium text-foreground">
              Topic
              <select className={`${fieldClass} mt-1`} value={resetTopic} onChange={(event) => setResetTopic(event.target.value)} disabled={!resetDomain}>
                <option value="">Choose a topic</option>{topics.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </label>}
            {preview.isLoading ? <LoadingState message="Preparing reset preview" /> : preview.isError ? <ErrorState message="The reset preview could not be loaded." onRetry={() => void preview.refetch()} /> : preview.data && <div className="rounded-lg border p-4 text-sm" style={{ borderColor: "var(--border)" }}>
              <p className="font-semibold text-foreground">{preview.data.scope.label}</p>
              <p className="mt-1 text-muted-foreground">{preview.data.eligibleQuestionCount} published questions · {preview.data.attempted} attempted this cycle · {percent(preview.data.accuracyPercent)} current accuracy</p>
              {preview.data.activeSessionCount > 0 && <p className="mt-3 flex gap-2 text-amber-700" role="status"><AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
                You have an active session containing {preview.data.activeSessionQuestionCount} question(s) from this area. Resetting progress will not delete the session, but answers from that session will remain with its previous learning period.
              </p>}
            </div>}
            <p className="text-sm text-muted-foreground">Your current progress will start again from 0. Previous attempts, session history, bookmarks, and personal notes will not be deleted.</p>
            {reset.isError && <p role="alert" className="text-sm text-destructive">The new cycle could not be started. Your saved history was not changed.</p>}
          </div>
          <DialogFooter className="flex-wrap">
            <Button variant="secondary" onClick={() => setResetOpen(false)} disabled={reset.isPending}>Cancel</Button>
            <Button onClick={() => reset.mutate()} disabled={!resetScope || !preview.data || reset.isPending || preview.isLoading}>
              {reset.isPending ? "Starting…" : "Start new cycle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
