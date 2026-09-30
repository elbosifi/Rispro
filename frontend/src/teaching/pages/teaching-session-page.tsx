import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Bookmark, Check, Clock3, X } from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, LoadingState, Textarea } from "@/components/shared";
import { TeachingImageViewer } from "../components/teaching-image-viewer";
import {
  clearTeachingQuestionNote,
  fetchTeachingLearnerQuestion,
  fetchTeachingLearnerSession,
  saveTeachingLearnerExamResponse,
  saveTeachingQuestionNote,
  setTeachingQuestionBookmark,
  submitTeachingLearnerAnswer,
  submitTeachingLearnerSession,
  type TeachingLearnerQuestion,
  type TeachingLearnerSession,
} from "../api/teaching-api";

function formatTime(seconds: number | null): string {
  if (seconds === null) return "";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function TeachingSessionPage() {
  const { sessionId: rawSessionId } = useParams();
  const sessionId = Number(rawSessionId);
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showQuestionNavigator, setShowQuestionNavigator] = useState(false);
  const [timer, setTimer] = useState(() => {
    const now = Date.now();
    return { sessionId, mountedAt: now, now };
  });
  if (timer.sessionId !== sessionId) setTimer({ sessionId, mountedAt: timer.now, now: timer.now });
  const [noteDraftState, setNoteDraftState] = useState<{ questionId: number; text: string } | null>(null);
  const [choiceState, setChoiceState] = useState<{ questionId: number; key: string | null } | null>(null);
  const [examResponseState, setExamResponseState] = useState<{ questionId: number; pendingKey: string | null; failedKey: string | null } | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const sessionQuery = useQuery({
    queryKey: ["teaching", "session", sessionId],
    queryFn: () => fetchTeachingLearnerSession(sessionId),
    enabled: Number.isSafeInteger(sessionId) && sessionId > 0,
    staleTime: 0,
  });
  const refetchSession = sessionQuery.refetch;
  const session = sessionQuery.data;
  const requestedPosition = Number(searchParams.get("position"));
  const position = Number.isSafeInteger(requestedPosition) && requestedPosition > 0
    ? requestedPosition
    : session?.currentPosition ?? 1;
  const questionQuery = useQuery({
    queryKey: ["teaching", "session-question", sessionId, position, session?.status ?? "active"],
    queryFn: () => fetchTeachingLearnerQuestion(sessionId, position),
    enabled: Boolean(session && session.status !== "abandoned"),
    staleTime: 0,
  });
  const question = questionQuery.data;
  const timerBaseline = Math.max(timer.mountedAt, sessionQuery.dataUpdatedAt);
  const elapsedSeconds = Math.max(0, Math.floor((timer.now - timerBaseline) / 1000));
  const remainingSeconds = session?.timed
    ? Math.max(0, (session.remainingSeconds ?? 0) - elapsedSeconds)
    : null;
  const noteDraft = question && noteDraftState?.questionId === question.questionId ? noteDraftState.text : question?.note ?? "";
  const noteDirty = Boolean(question && noteDraft !== question.note);
  const selectedChoice = question && session?.mode === "exam"
    ? examResponseState?.questionId === question.questionId && examResponseState.pendingKey !== null
      ? examResponseState.pendingKey
      : question.selectedOptionKey ?? null
    : question && choiceState?.questionId === question.questionId
      ? choiceState.key
      : question?.selectedOptionKey ?? null;

  useEffect(() => {
    if (!session?.timed || session.status !== "active") return;
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      setTimer((current) => ({ ...current, now }));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [session?.id, session?.status, session?.timed]);

  useEffect(() => {
    if (remainingSeconds !== 0 || !session?.timed || session.status !== "active" || sessionQuery.isFetching) return;
    void refetchSession();
  }, [remainingSeconds, session?.status, session?.timed, sessionQuery.isFetching, refetchSession]);

  const storeSession = (value: TeachingLearnerSession) => {
    queryClient.setQueryData(["teaching", "session", sessionId], value);
    void queryClient.invalidateQueries({ queryKey: ["teaching", "learner-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["teaching", "session-history"] });
  };

  const answerMutation = useMutation({
    mutationFn: (key: string) => submitTeachingLearnerAnswer(sessionId, position, key),
    onSuccess: (value) => {
      queryClient.setQueryData(["teaching", "session-question", sessionId, position, value.session.status], value);
      void sessionQuery.refetch();
      requestAnimationFrame(() => feedbackRef.current?.focus());
    },
  });
  const responseMutation = useMutation({
    mutationFn: (key: string) => saveTeachingLearnerExamResponse(sessionId, position, key),
    onSuccess: (value, key) => {
      storeSession(value.session);
      setExamResponseState((current) => current?.pendingKey === key ? null : current);
      queryClient.setQueryData<TeachingLearnerQuestion>(
        ["teaching", "session-question", sessionId, position, session?.status ?? "active"],
        (current) => current ? { ...current, selectedOptionKey: key, answered: true } : current,
      );
    },
    onError: (_error, key) => {
      setExamResponseState((current) => current?.pendingKey === key
        ? { ...current, pendingKey: null, failedKey: key }
        : current);
    },
  });
  const submitMutation = useMutation({
    mutationFn: () => submitTeachingLearnerSession(sessionId),
    onSuccess: (value) => {
      storeSession(value);
      setShowSubmitConfirm(false);
    },
  });
  const bookmarkMutation = useMutation({
    mutationFn: (marked: boolean) => setTeachingQuestionBookmark(question!.questionId, marked),
    onSuccess: (value) => queryClient.setQueryData<TeachingLearnerQuestion>(
      ["teaching", "session-question", sessionId, position, session?.status ?? "active"],
      (current) => current ? { ...current, bookmarked: value.marked } : current,
    ),
  });
  const noteMutation = useMutation({
    mutationFn: (note: string) => saveTeachingQuestionNote(question!.questionId, note),
    onSuccess: (value) => {
      setNoteDraftState({ questionId: value.questionId, text: value.note });
      queryClient.setQueryData<TeachingLearnerQuestion>(
        ["teaching", "session-question", sessionId, position, session?.status ?? "active"],
        (current) => current ? { ...current, note: value.note } : current,
      );
    },
  });
  const clearNoteMutation = useMutation({
    mutationFn: () => clearTeachingQuestionNote(question!.questionId),
    onSuccess: () => {
      setNoteDraftState({ questionId: question!.questionId, text: "" });
      queryClient.setQueryData<TeachingLearnerQuestion>(
        ["teaching", "session-question", sessionId, position, session?.status ?? "active"],
        (current) => current ? { ...current, note: "" } : current,
      );
    },
  });

  if (!Number.isSafeInteger(sessionId) || sessionId < 1) return <ErrorState message="This session link is invalid." />;
  if (sessionQuery.isLoading) return <LoadingState message="Restoring your session" />;
  if (sessionQuery.isError || !session) return <ErrorState message="This session could not be loaded." onRetry={() => void sessionQuery.refetch()} />;
  if (session.status === "abandoned") return <ErrorState message="This session is no longer active." />;
  if (questionQuery.isLoading) return <LoadingState message="Loading question" />;
  if (questionQuery.isError || !question) return <ErrorState message="This question could not be loaded." onRetry={() => void questionQuery.refetch()} />;
  if (question.position !== position) return <LoadingState message="Loading question" />;

  const isExam = session.mode === "exam";
  const isActive = session.status === "active";
  const canAnswer = isActive && (isExam || !question.answered);
  const examResponseUnresolved = isExam && examResponseState?.questionId === question.questionId
    && (examResponseState.pendingKey !== null || examResponseState.failedKey !== null);
  const answeredCount = session.progress.answered;
  const unansweredCount = session.questionCount - answeredCount;
  const choosePosition = (next: number) => {
    if (examResponseUnresolved) return;
    setShowQuestionNavigator(false);
    setSearchParams({ position: String(next) });
    answerMutation.reset();
    responseMutation.reset();
  };

  const saveExamChoice = (key: string) => {
    setExamResponseState({ questionId: question.questionId, pendingKey: key, failedKey: null });
    responseMutation.reset();
    responseMutation.mutate(key);
  };
  const submitStudyAnswer = () => {
    if (selectedChoice) answerMutation.mutate(selectedChoice);
  };
  const timerLabel = session.timed ? formatTime(remainingSeconds ?? question.session.remainingSeconds) : null;
  const caseHasContent = Boolean(question.case && (question.case.title || question.case.clinicalHistory));

  return (
    <section aria-labelledby="teaching-session-title" className="mx-auto max-w-5xl space-y-5 pb-4">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 py-3 backdrop-blur sm:rounded-lg sm:border sm:px-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-accent">{session.mode === "exam" ? "Exam" : session.mode === "review" ? "Review" : "Study"}</p>
          <h1 id="teaching-session-title" className="mt-0.5 text-lg font-semibold text-foreground">Question {question.position} of {question.totalQuestions}</h1>
        </div>
        {session.timed && <p role="timer" aria-label={`Time remaining ${timerLabel}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold tabular-nums text-foreground">
          <Clock3 size={16} aria-hidden="true" /> <span>{timerLabel}</span>
        </p>}
      </header>

      {session.status === "submitted" && (
        <Card className="grid gap-3 p-4 sm:grid-cols-4 sm:p-5" aria-label="Session results">
          <div><p className="text-xs text-muted-foreground">Score</p><p className="text-lg font-semibold">{session.progress.correct ?? 0} / {session.progress.total} <span className="text-sm font-normal">({session.progress.scorePercent ?? 0}%)</span></p></div>
          <div><p className="text-xs text-muted-foreground">Answered</p><p className="text-lg font-semibold">{session.progress.answered}</p></div>
          <div><p className="text-xs text-muted-foreground">Incorrect</p><p className="text-lg font-semibold">{session.progress.incorrect ?? 0}</p></div>
          <div><p className="text-xs text-muted-foreground">Unanswered</p><p className="text-lg font-semibold">{session.progress.unanswered}</p></div>
        </Card>
      )}

      <Card className="space-y-5 p-4 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <p className="text-sm font-medium text-muted-foreground" aria-live="polite">{question.answered ? "Answered" : "Unanswered"}</p>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Question navigation">
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowQuestionNavigator(true)} disabled={examResponseUnresolved} aria-haspopup="dialog">Questions</Button>
          </div>
        </div>

        <article className="space-y-5" aria-label="Question content">
          {caseHasContent && question.case ? (
            <aside data-testid="teaching-clinical-history" className="rounded-xl border border-border bg-muted/40 p-4 sm:p-5" aria-label="Clinical history">
              {question.case.title && <h2 className="font-semibold text-foreground">{question.case.title}</h2>}
              {question.case.clinicalHistory && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.case.clinicalHistory}</p>}
            </aside>
          ) : null}
          {question.images.length > 0 ? <TeachingImageViewer images={question.images} resetKey={question.questionId} /> : null}
          <div data-testid="teaching-question-stem">
            <p className="whitespace-pre-wrap text-base leading-7 text-foreground">{question.stem}</p>
          </div>
        </article>

        <fieldset disabled={!canAnswer || answerMutation.isPending || responseMutation.isPending} className="min-w-0 space-y-2" aria-label="Answer options">
          <legend className="mb-2 text-sm font-semibold text-foreground">Choose one answer</legend>
          {question.options.map((option) => {
            const feedback = question.feedback;
            const isCorrectOption = feedback?.correctOption?.key === option.key
              || (feedback?.isCorrect === true && feedback.selectedOptionKey === option.key);
            const isIncorrectSelection = feedback?.isCorrect === false && feedback.selectedOptionKey === option.key;
            const hasAnswerResult = isCorrectOption || isIncorrectSelection;
            const answerResultStyle = isCorrectOption
              ? { borderColor: "var(--state-success-border)", backgroundColor: "var(--state-success-bg)" }
              : isIncorrectSelection
                ? { borderColor: "var(--state-error-border)", backgroundColor: "var(--state-error-bg)" }
                : undefined;
            return (
              <label
                key={option.key}
                className={`flex min-h-16 w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm leading-6 transition-colors hover:border-accent/60 hover:bg-muted/40 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent/50 sm:gap-4 sm:p-4 ${hasAnswerResult ? "" : selectedChoice === option.key ? "border-accent bg-accent/5 ring-1 ring-accent/30" : "border-border bg-card"}`}
                style={answerResultStyle}
              >
                <input
                  type="radio"
                  name="teaching-answer"
                  value={option.key}
                  checked={selectedChoice === option.key}
                  onChange={() => isExam
                    ? saveExamChoice(option.key)
                    : setChoiceState({ questionId: question.questionId, key: option.key })}
                  className="mt-1 h-5 w-5 shrink-0 accent-accent"
                />
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words"><span className="me-1 font-semibold">{option.key}.</span> {option.text}</span>
              </label>
            );
          })}
        </fieldset>
        {isExam && responseMutation.isPending ? <p role="status" className="text-sm text-muted-foreground">Saving…</p> : null}
        {isExam && examResponseState?.questionId === question.questionId && examResponseState.failedKey !== null ? <p role="alert" className="text-sm text-red-700">Answer was not saved. Please select it again or retry.</p> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant={question.bookmarked ? "secondary" : "outline"} onClick={() => bookmarkMutation.mutate(!question.bookmarked)} disabled={bookmarkMutation.isPending} aria-pressed={question.bookmarked} className={question.bookmarked ? "ring-2 ring-accent/30" : ""}>
            <Bookmark size={16} aria-hidden="true" className={question.bookmarked ? "fill-current" : ""} />
            {question.bookmarked ? "Marked" : "Mark question"}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            {question.position > 1 ? <Button type="button" variant="ghost" onClick={() => choosePosition(question.position - 1)} disabled={examResponseUnresolved}>Previous</Button> : null}
            {canAnswer && !isExam ? <Button type="button" onClick={submitStudyAnswer} disabled={!selectedChoice || answerMutation.isPending}>
              {answerMutation.isPending ? "Saving answer…" : "Submit answer"}
            </Button> : null}
            {question.position < question.totalQuestions && (question.answered || isExam || !isActive) ? <Button type="button" variant="secondary" onClick={() => choosePosition(question.position + 1)} disabled={examResponseUnresolved}>Next</Button> : null}
            {!isExam && isActive && question.position === question.totalQuestions && question.answered ? <Button type="button" variant="secondary" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>End {session.mode === "review" ? "review" : "study"} session</Button> : null}
            {isExam && isActive ? <Button type="button" variant="outline" onClick={() => setShowSubmitConfirm(true)} disabled={submitMutation.isPending || examResponseUnresolved}>Submit exam</Button> : null}
          </div>
        </div>

        {question.feedback && (
          <div ref={feedbackRef} tabIndex={-1} className="space-y-4 rounded-lg border p-4 outline-none" style={{ borderColor: question.feedback.isCorrect === null ? "var(--border)" : question.feedback.isCorrect ? "var(--state-success-border)" : "var(--state-error-border)" }} aria-live="polite">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              {question.feedback.isCorrect === true ? <Check size={19} aria-hidden="true" /> : question.feedback.isCorrect === false ? <X size={19} aria-hidden="true" /> : null}
              {question.feedback.isCorrect === null ? "Unanswered" : question.feedback.isCorrect ? "Correct" : "Incorrect"}
            </h2>
            {question.feedback.correctOption && <p className="text-sm text-foreground"><strong>Correct answer:</strong> {question.feedback.correctOption.key}. {question.feedback.correctOption.text}</p>}
            {question.feedback.explanation.teachingPoint && <div className="rounded-lg bg-muted/50 p-3"><h3 className="font-semibold text-foreground">Teaching point</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.feedback.explanation.teachingPoint}</p></div>}
            {question.feedback.explanation.summary && <div><h3 className="font-semibold text-foreground">Explanation</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.feedback.explanation.summary}</p></div>}
            {question.feedback.optionExplanations.length > 0 && <div><h3 className="font-semibold text-foreground">Why the other options are wrong</h3><ul className="mt-2 space-y-2 text-sm leading-6 text-foreground">{question.feedback.optionExplanations.map((item) => <li key={item.key}><strong>{item.key}.</strong> {item.explanation}</li>)}</ul></div>}
            {question.feedback.explanation.furtherDiscussion && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer font-semibold text-foreground">Further discussion</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.feedback.explanation.furtherDiscussion}</p></details>}
            {question.feedback.evidenceReview?.status === "updated" && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3"><h3 className="font-semibold text-foreground">Current evidence update{question.feedback.evidenceReview.checkedAt ? ` · ${question.feedback.evidenceReview.checkedAt}` : ""}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{question.feedback.evidenceReview.summary}</p><p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{question.feedback.evidenceReview.update}</p></div>}
            {question.feedback.evidenceReview?.status === "confirmed" && <div className="rounded-lg bg-muted/50 p-3"><h3 className="font-semibold text-foreground">Current evidence checked {question.feedback.evidenceReview.checkedAt ?? ""}</h3><p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{question.feedback.evidenceReview.summary}</p></div>}
            {question.feedback.evidenceReview?.status === "uncertain" && <div className="rounded-lg bg-muted/50 p-3"><h3 className="font-semibold text-foreground">Evidence review</h3><p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{question.feedback.evidenceReview.summary}</p></div>}
            {question.feedback.evidenceReview?.status === "not_verified" && <p className="text-xs text-muted-foreground">Current evidence not independently verified.</p>}
            {question.feedback.references.length > 0 && <div><h3 className="font-semibold text-foreground">References</h3><ul className="mt-2 space-y-1 text-sm text-foreground">{question.feedback.references.map((reference, index) => <li key={`${reference.title}-${index}`}>{reference.url ? <a href={reference.url} target="_blank" rel="noreferrer" className="text-accent underline">{reference.citationText || reference.title}</a> : reference.citationText || reference.title}{reference.year ? ` · ${reference.year}` : ""}</li>)}</ul></div>}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Personal note</summary>
          <div className="mt-3 space-y-3">
            <Textarea value={noteDraft} maxLength={5000} onChange={(event) => {
              noteMutation.reset();
              clearNoteMutation.reset();
              setNoteDraftState({ questionId: question.questionId, text: event.target.value });
            }} aria-label="Personal note" placeholder="Private to your Teaching identity" />
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={() => noteMutation.mutate(noteDraft)} disabled={!noteDraft.trim() || !noteDirty || noteMutation.isPending}>Save note</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => clearNoteMutation.mutate()} disabled={!question.note || clearNoteMutation.isPending}>Clear note</Button>
              {noteMutation.isPending || clearNoteMutation.isPending ? <span className="self-center text-sm text-muted-foreground" role="status">Saving note…</span> : null}
              {noteDirty && !noteMutation.isPending && !clearNoteMutation.isPending ? <span className="self-center text-sm text-muted-foreground" role="status">Unsaved changes</span> : null}
              {noteMutation.isSuccess && !noteDirty && <span className="self-center text-sm text-muted-foreground" role="status">Note saved</span>}
              {clearNoteMutation.isSuccess && !noteDirty && <span className="self-center text-sm text-muted-foreground" role="status">Note cleared</span>}
            </div>
            {(noteMutation.isError || clearNoteMutation.isError) && <p role="alert" className="text-sm text-red-700">Your note could not be saved.</p>}
          </div>
        </details>
      </Card>

      {answerMutation.isError && <p role="alert" className="text-sm text-red-700">{answerMutation.error instanceof Error ? answerMutation.error.message : "Your answer could not be saved."}</p>}
      {submitMutation.isError && <p role="alert" className="text-sm text-red-700">{submitMutation.error instanceof Error ? submitMutation.error.message : "The session could not be submitted."}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/teaching/history" className="text-sm font-medium text-accent hover:underline">Session history</Link>
        {session.mode === "review" && <Link to="/teaching/qbank" className="text-sm font-medium text-accent hover:underline">Create another session</Link>}
      </div>

      <Dialog open={showSubmitConfirm} onClose={() => setShowSubmitConfirm(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submit Exam?</DialogTitle>
            <DialogDescription>Answers become final and explanations become available after submission.</DialogDescription>
          </DialogHeader>
          <p className="text-sm text-foreground">{session.questionCount} questions · {answeredCount} answered · {unansweredCount} unanswered</p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowSubmitConfirm(false)}>Continue exam</Button>
            <Button onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending || examResponseUnresolved}>Submit exam</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showQuestionNavigator} onClose={() => setShowQuestionNavigator(false)}>
        <DialogContent maxWidth="min(calc(100vw - 32px), 680px)" aria-label="Question navigator">
          <DialogHeader>
            <DialogTitle>Questions</DialogTitle>
            <DialogDescription>Choose a question. Check marks indicate answered questions; dashes indicate unanswered.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[62vh] overflow-y-auto pe-1">
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-8" role="group" aria-label="Questions in this session">
              {session.questions.map((item) => {
                const current = item.position === question.position;
                return (
                  <Button
                    key={item.position}
                    type="button"
                    size="sm"
                    variant={current ? "primary" : item.answered ? "secondary" : "outline"}
                    className="!h-12 !min-w-0 !px-1"
                    onClick={() => choosePosition(item.position)}
                    disabled={examResponseUnresolved}
                    aria-current={current ? "step" : undefined}
                    aria-label={`Question ${item.position}, ${item.answered ? "answered" : "unanswered"}${current ? ", current" : ""}`}
                  >
                    <span className="flex min-w-0 flex-col items-center leading-4">
                      <span>{item.position}</span>
                      <span aria-hidden="true" className="text-[10px]">{item.answered ? "✓" : "–"}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
