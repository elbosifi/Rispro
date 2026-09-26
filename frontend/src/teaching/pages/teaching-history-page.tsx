import { useQuery } from "@tanstack/react-query";
import { NavLink, useSearchParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, LoadingState } from "@/components/shared";
import { fetchTeachingSessionHistory, type TeachingSessionMode } from "../api/teaching-api";

function modeLabel(mode: TeachingSessionMode): string {
  return mode === "exam" ? "Exam" : mode === "review" ? "Review" : "Study";
}

function filterSummary(filters: Record<string, unknown>): string {
  const parts = [
    typeof filters.specialty === "string" ? filters.specialty : null,
    typeof filters.domain === "string" ? filters.domain : null,
    typeof filters.questionState === "string" && filters.questionState !== "all" ? filters.questionState : null,
  ].filter((item): item is string => item !== null);
  return parts.length ? parts.join(" · ") : "All published questions";
}

export function TeachingHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const history = useQuery({
    queryKey: ["teaching", "session-history", page],
    queryFn: () => fetchTeachingSessionHistory(page),
    staleTime: 10_000,
  });

  if (history.isLoading) return <LoadingState message="Loading session history" />;
  if (history.isError || !history.data) return <ErrorState message="Session history could not be loaded." onRetry={() => void history.refetch()} />;
  const totalPages = Math.max(1, Math.ceil(history.data.pagination.total / history.data.pagination.pageSize));

  return (
    <section aria-labelledby="teaching-history-title" className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching</p>
        <h1 id="teaching-history-title" className="mt-1 text-2xl font-semibold text-foreground">Session history</h1>
        <p className="mt-1 text-sm text-muted-foreground">Resume active sessions or review submitted work.</p>
      </header>

      {history.data.items.length === 0 ? (
        <Card><EmptyState message="No sessions yet. Create a Study, Exam, or Review session to get started." /></Card>
      ) : (
        <div className="space-y-3">
          {history.data.items.map((item) => (
            <Card key={item.id} className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
              <div className="min-w-0">
                <h2 className="font-semibold text-foreground">{modeLabel(item.mode)} · {item.questionCount} questions</h2>
                <p className="mt-1 text-sm text-muted-foreground">{filterSummary(item.filters as Record<string, unknown>)}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {new Date(item.startedAt).toLocaleString()} · {item.status === "active" ? "Active" : "Submitted"} · {item.durationSeconds} sec
                </p>
                {item.status === "submitted" && <p className="mt-1 text-sm font-medium text-foreground">
                  {item.progress.correct ?? 0} correct · {item.progress.incorrect ?? 0} incorrect · {item.progress.unanswered} unanswered · {item.progress.scorePercent ?? 0}% of total
                </p>}
              </div>
              <NavLink to={`/teaching/qbank/session/${item.id}`} className="btn-secondary inline-flex h-[var(--control-height-md)] shrink-0 items-center px-4">
                {item.status === "active" ? "Resume" : "Review"}
              </NavLink>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Page {page} of {totalPages} · {history.data.pagination.total} sessions</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSearchParams(page > 2 ? { page: String(page - 1) } : {})} disabled={page <= 1}>Previous</Button>
          <Button variant="outline" onClick={() => setSearchParams({ page: String(page + 1) })} disabled={page >= totalPages}>Next</Button>
        </div>
      </div>
    </section>
  );
}
