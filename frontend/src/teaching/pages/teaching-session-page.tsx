import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Bookmark, Check, Clock3, X } from "lucide-react";
import { Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, LoadingState, Textarea } from "@/components/shared";
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
  const [timerTicks, setTimerTicks] = useState({ sessionId: 0, ticks: 0 });
  const [noteDraftState, setNoteDraftState] = useState<{ questionId: number; text: string } | null>(null);
  const [choiceState, setChoiceState] = useState<{ questionId: number; key: string | null } | null>(null);
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
  const elapsedTimerTicks = session && timerTicks.sessionId === session.id ? timerTicks.ticks : 0;
  const remainingSeconds = session?.timed
    ? Math.max(0, (session.remainingSeconds ?? 0) - elapsedTimerTicks)
    : null;
  const noteDraft = question && noteDraftState?.questionId === question.questionId ? noteDraftState.text : question?.note ?? "";
  const selectedChoice = question && choiceState?.questionId === question.questionId
    ? choiceState.key
    : question?.selectedOptionKey ?? null;

  useEffect(() => {
    if (!session?.timed || session.status !== "active") return;
    const timer = window.setInterval(() => setTimerTicks((current) => current.sessionId === session.id
      ? { sessionId: session.id, ticks: current.ticks + 1 }
      : { sessionId: session.id, ticks: 1 }), 1000);
    return () => window.clearInterval(timer);
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
    onSuccess: (value) => {
      storeSession(value.session);
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

  const isExam = session.mode === "exam";
  const isActive = session.status === "active";
  const canAnswer = isActive && (isExam || !question.answered);
  const answeredCount = session.progress.answered;
  const unansweredCount = session.questionCount - answeredCount;
  const choosePosition = (next: number) => {
    setSearchParams({ position: String(next) });
    answerMutation.reset();
    responseMutation.reset();
  };

  const saveExamChoice = (key: string) => {
    setChoiceState({ questionId: question.questionId, key });
    responseMutation.mutate(key);
  };
  const submitStudyAnswer = () => {
    if (selectedChoice) answerMutation.mutate(selectedChoice);
  };
  const timerLabel = session.timed ? formatTime(remainingSeconds ?? question.session.remainingSeconds) : null;

  return (
    <section aria-labelledby="teaching-session-title" className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">{session.mode === "exam" ? "Exam" : session.mode === "review" ? "Review" : "Study"} session</p>
          <h1 id="teaching-session-title" className="mt-1 text-xl font-semibold text-foreground">Question {question.position} of {question.totalQuestions}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{question.answered ? "Answered" : "Unanswered"}</p>
        </div>
        {session.timed && <p role="timer" aria-label={`Time remaining ${timerLabel}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold tabular-nums" style={{ borderColor: "var(--border)" }}>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Progress: {question.position} / {question.totalQuestions}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Question navigation">
            {session.questions.map((item) => (
              <Button key={item.position} size="sm" variant={item.position === question.position ? "primary" : "outline"} className="!min-w-10 !px-2" onClick={() => choosePosition(item.position)} aria-current={item.position === question.position ? "step" : undefined} aria-label={`Question ${item.position}${item.answered ? ", answered" : ", unanswered"}`}>
                {item.position}
              </Button>
            ))}
          </div>
        </div>

        <article>
          <p className="whitespace-pre-wrap text-base leading-7 text-foreground">{question.stem}</p>
          {question.case && (question.case.title || question.case.clinicalHistory) && (
            <aside className="mt-4 rounded-lg bg-muted p-4" aria-label="Teaching case">
              {question.case.title && <h2 className="font-semibold text-foreground">{question.case.title}</h2>}
              {question.case.clinicalHistory && <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.case.clinicalHistory}</p>}
            </aside>
          )}
          {question.images.length > 0 && <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {question.images.map((image) => <img key={image.id} src={image.url} alt={image.altText || "Teaching question image"} className="mx-auto max-h-[32rem] max-w-full rounded-lg object-contain" />)}
          </div>}
        </article>

        <fieldset disabled={!canAnswer || answerMutation.isPending || responseMutation.isPending} className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-foreground">Choose one answer</legend>
          {question.options.map((option) => (
            <label key={option.key} className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm leading-6 ${selectedChoice === option.key ? "border-accent bg-muted" : "border-border"}`}>
              <input
                type="radio"
                name="teaching-answer"
                value={option.key}
                checked={selectedChoice === option.key}
                onChange={() => isExam
                  ? saveExamChoice(option.key)
                  : setChoiceState({ questionId: question.questionId, key: option.key })}
                className="mt-1 h-4 w-4 shrink-0 accent-accent"
              />
              <span className="font-semibold">{option.key}.</span>
              <span className="whitespace-pre-wrap">{option.text}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={() => bookmarkMutation.mutate(!question.bookmarked)} disabled={bookmarkMutation.isPending} aria-pressed={question.bookmarked}>
            <Bookmark size={16} aria-hidden="true" className={question.bookmarked ? "fill-current" : ""} />
            {question.bookmarked ? "Marked" : "Mark question"}
          </Button>
          <div className="flex flex-wrap gap-2">
            {question.position > 1 && <Button variant="ghost" onClick={() => choosePosition(question.position - 1)}>Previous</Button>}
            {isExam && isActive && <Button variant="destructive" onClick={() => setShowSubmitConfirm(true)} disabled={submitMutation.isPending}>Submit exam</Button>}
            {canAnswer && !isExam && <Button onClick={submitStudyAnswer} disabled={!selectedChoice || answerMutation.isPending}>
              {answerMutation.isPending ? "Saving answer…" : "Submit answer"}
            </Button>}
            {question.position < question.totalQuestions && <Button variant="secondary" onClick={() => choosePosition(question.position + 1)} disabled={isExam && responseMutation.isPending}>
              {question.answered || isExam || session.status === "submitted" ? "Next" : "Skip"}
            </Button>}
            {!isExam && isActive && question.position === question.totalQuestions && <Button variant="secondary" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>End {session.mode === "review" ? "review" : "study"} session</Button>}
          </div>
        </div>

        {question.feedback && (
          <div ref={feedbackRef} tabIndex={-1} className="space-y-4 rounded-lg border p-4 outline-none" style={{ borderColor: question.feedback.isCorrect === null ? "var(--border)" : question.feedback.isCorrect ? "var(--state-success-border)" : "var(--state-error-border)" }} aria-live="polite">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              {question.feedback.isCorrect === true ? <Check size={19} aria-hidden="true" /> : question.feedback.isCorrect === false ? <X size={19} aria-hidden="true" /> : null}
              {question.feedback.isCorrect === null ? "Unanswered" : question.feedback.isCorrect ? "Correct" : "Incorrect"}
            </h2>
            {question.feedback.correctOption && <p className="text-sm text-foreground"><strong>Correct answer:</strong> {question.feedback.correctOption.key}. {question.feedback.correctOption.text}</p>}
            {question.feedback.explanation.summary && <div><h3 className="font-semibold text-foreground">Explanation</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.feedback.explanation.summary}</p></div>}
            {question.feedback.explanation.teachingPoint && <div><h3 className="font-semibold text-foreground">Teaching point</h3><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{question.feedback.explanation.teachingPoint}</p></div>}
            {question.feedback.explanation.furtherDiscussion && <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{question.feedback.explanation.furtherDiscussion}</p>}
            {question.feedback.optionExplanations.length > 0 && <div><h3 className="font-semibold text-foreground">Option explanations</h3><ul className="mt-1 space-y-1 text-sm text-foreground">{question.feedback.optionExplanations.map((item) => <li key={item.key}><strong>{item.key}.</strong> {item.explanation}</li>)}</ul></div>}
            {question.feedback.references.length > 0 && <div><h3 className="font-semibold text-foreground">References</h3><ul className="mt-1 space-y-1 text-sm text-foreground">{question.feedback.references.map((reference, index) => <li key={`${reference.title}-${index}`}>{reference.url ? <a href={reference.url} target="_blank" rel="noreferrer" className="text-accent underline">{reference.citationText || reference.title}</a> : reference.citationText || reference.title}{reference.year ? ` · ${reference.year}` : ""}</li>)}</ul></div>}
          </div>
        )}

        <details className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <summary className="cursor-pointer text-sm font-semibold text-foreground">Personal note</summary>
          <div className="mt-3 space-y-3">
            <Textarea value={noteDraft} maxLength={5000} onChange={(event) => setNoteDraftState({ questionId: question.questionId, text: event.target.value })} aria-label="Personal note" placeholder="Private to your Teaching identity" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => noteMutation.mutate(noteDraft)} disabled={!noteDraft.trim() || noteMutation.isPending}>Save note</Button>
              <Button size="sm" variant="outline" onClick={() => clearNoteMutation.mutate()} disabled={!question.note || clearNoteMutation.isPending}>Clear note</Button>
              {noteMutation.isSuccess && <span className="self-center text-sm text-muted-foreground" role="status">Note saved</span>}
            </div>
            {(noteMutation.isError || clearNoteMutation.isError) && <p role="alert" className="text-sm text-red-700">Your note could not be saved.</p>}
          </div>
        </details>
      </Card>

      {answerMutation.isError && <p role="alert" className="text-sm text-red-700">{answerMutation.error instanceof Error ? answerMutation.error.message : "Your answer could not be saved."}</p>}
      {responseMutation.isError && <p role="alert" className="text-sm text-red-700">{responseMutation.error instanceof Error ? responseMutation.error.message : "Your response could not be saved."}</p>}
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
            <Button variant="destructive" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>Submit exam</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
