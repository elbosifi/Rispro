import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpenText, ClipboardList, History } from "lucide-react";
import { Card, EmptyState, ErrorState, LoadingState } from "@/components/shared";
import { fetchTeachingLearnerDashboard, type TeachingLearnerDashboard } from "../api/teaching-api";

function sessionLabel(session: TeachingLearnerDashboard["recentSessions"][number]): string {
  const mode = session.mode === "exam" ? "Exam" : session.mode === "review" ? "Review" : "Study";
  return `${mode} · ${session.questionCount} questions`;
}

export function TeachingDashboardPage() {
  const dashboard = useQuery({
    queryKey: ["teaching", "learner-dashboard"],
    queryFn: fetchTeachingLearnerDashboard,
    staleTime: 30_000,
  });

  if (dashboard.isLoading) return <LoadingState message="Loading your question bank" />;
  if (dashboard.isError || !dashboard.data) {
    return <ErrorState message="Your learner dashboard could not be loaded." onRetry={() => void dashboard.refetch()} />;
  }

  const data = dashboard.data;
  const metrics = [
    ["Current cycle accuracy", data.progress.currentCycleAccuracyPercent === null || data.progress.currentCycleAccuracyPercent === undefined ? "—" : `${data.progress.currentCycleAccuracyPercent}%`],
    ["First-pass accuracy", data.progress.firstPassAccuracyPercent === null || data.progress.firstPassAccuracyPercent === undefined ? "—" : `${data.progress.firstPassAccuracyPercent}%`],
    ["Incorrect this cycle", data.progress.incorrectQuestions],
    ["Unseen this cycle", data.progress.unseenQuestions],
    ["Marked", data.progress.markedQuestions],
  ] as const;

  return (
    <section aria-labelledby="teaching-dashboard-title" className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching</p>
          <h1 id="teaching-dashboard-title" className="mt-1 text-2xl font-semibold text-foreground">Question Bank</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Current cycle: {data.progress.attemptedQuestions} / {data.publishedQuestionCount} questions
            {data.progress.completionPercent === undefined ? "" : ` · ${data.progress.completionPercent}% complete`}.
          </p>
        </div>
        <NavLink to="/teaching/qbank" className="btn-primary inline-flex h-[var(--control-height-md)] items-center gap-2 px-4">
          <BookOpenText size={17} aria-hidden="true" /> Create session
        </NavLink>
      </header>

      {data.continueSession && (
        <Card className="flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent">Continue session</p>
            <h2 className="mt-1 text-lg font-semibold text-foreground">{sessionLabel(data.continueSession)}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Question {data.continueSession.currentPosition} of {data.continueSession.questionCount}
              {data.continueSession.timed ? " · Timed" : " · Untimed"}
            </p>
          </div>
          <NavLink to={`/teaching/qbank/session/${data.continueSession.id}`} className="btn-secondary inline-flex h-[var(--control-height-md)] items-center gap-2 px-4">
            Resume <ArrowRight size={16} aria-hidden="true" />
          </NavLink>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map(([label, value]) => (
          <Card key={label} className="p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
          </Card>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">
        Current-cycle results use your latest answer per question. First-pass accuracy uses each question’s first-ever answer.
        <NavLink to="/teaching/progress" className="ms-1 font-medium text-accent hover:underline">View progress and study cycles</NavLink>
      </p>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Recent sessions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Review a submitted session or return to one in progress.</p>
          </div>
          <NavLink to="/teaching/history" className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline">
            <History size={16} aria-hidden="true" /> Session history
          </NavLink>
        </div>
        {data.recentSessions.length === 0 ? (
          <EmptyState className="mt-4" message="Your sessions will appear here after you answer questions." icon={<ClipboardList size={26} aria-hidden="true" />} />
        ) : (
          <ul className="mt-4 divide-y" style={{ borderColor: "var(--border)" }}>
            {data.recentSessions.slice(0, 5).map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  <p className="font-medium text-foreground">{sessionLabel(session)}</p>
                  <p className="text-sm text-muted-foreground">
                    {session.status === "active" ? `${session.progress.answered} answered` : `${session.progress.correct ?? 0} correct of ${session.questionCount}`}
                    {session.status === "active" ? " · In progress" : " · Submitted"}
                  </p>
                </div>
                <NavLink to={`/teaching/qbank/session/${session.id}`} className="text-sm font-medium text-accent hover:underline">
                  {session.status === "active" ? "Continue" : "Review"}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
