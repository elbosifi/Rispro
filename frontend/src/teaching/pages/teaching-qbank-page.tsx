import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Card, Checkbox, ErrorState, Input, LoadingState } from "@/components/shared";
import {
  createTeachingLearnerSession,
  fetchTeachingCatalog,
  fetchTeachingQuestionAvailability,
  type TeachingCatalogItem,
  type TeachingLearnerFilters,
  type TeachingQuestionStateFilter,
  type TeachingSessionMode,
} from "../api/teaching-api";

const fieldClass = "input-premium w-full";

function setValue(event: ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
}

function codeOptions(items: TeachingCatalogItem[], noneLabel: string, includeNone = true) {
  return <>
    {includeNone && <option value="">{noneLabel}</option>}
    {items.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
  </>;
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TeachingQbankPage() {
  const navigate = useNavigate();
  const catalog = useQuery({ queryKey: ["teaching", "catalog"], queryFn: fetchTeachingCatalog, staleTime: 60_000 });
  const [specialty, setSpecialty] = useState("");
  const [domain, setDomain] = useState("");
  const [topic, setTopic] = useState("");
  const [subtopic, setSubtopic] = useState("");
  const [modalities, setModalities] = useState<string[]>([]);
  const [competencies, setCompetencies] = useState<string[]>([]);
  const [trainingLevels, setTrainingLevels] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<number[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [questionState, setQuestionState] = useState<TeachingQuestionStateFilter>("all");
  const [mode, setMode] = useState<TeachingSessionMode>("study");
  const [questionCount, setQuestionCount] = useState(10);
  const [timed, setTimed] = useState(false);
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(30);
  const [countFilters, setCountFilters] = useState<TeachingLearnerFilters>({ questionState: "all" });

  const filters = useMemo<TeachingLearnerFilters>(() => ({
    ...(specialty ? { specialty } : {}),
    ...(domain ? { domain } : {}),
    ...(topic ? { topics: [topic] } : {}),
    ...(subtopic ? { subtopics: [subtopic] } : {}),
    ...(modalities.length ? { modalities } : {}),
    ...(competencies.length ? { competencies } : {}),
    ...(trainingLevels.length ? { trainingLevels } : {}),
    ...(difficulty.length ? { difficulty } : {}),
    ...(tags.length ? { tags } : {}),
    questionState,
  }), [specialty, domain, topic, subtopic, modalities, competencies, trainingLevels, difficulty, tags, questionState]);

  useEffect(() => {
    const timer = window.setTimeout(() => setCountFilters(filters), 250);
    return () => window.clearTimeout(timer);
  }, [filters]);

  const availability = useQuery({
    queryKey: ["teaching", "qbank-availability", countFilters],
    queryFn: () => fetchTeachingQuestionAvailability(countFilters),
    enabled: Boolean(catalog.data),
    staleTime: 0,
  });

  const creation = useMutation({
    mutationFn: createTeachingLearnerSession,
    onSuccess: (session) => navigate(`/teaching/qbank/session/${session.sessionId}`),
  });

  if (catalog.isLoading) return <LoadingState message="Loading the active Teaching catalog" />;
  if (catalog.isError || !catalog.data) return <ErrorState message="The Teaching catalog could not be loaded." onRetry={() => void catalog.refetch()} />;

  const data = catalog.data;
  const specialties = data.specialties.filter((item) => item.active);
  const domains = data.domains.filter((item) => item.active && (!specialty || item.parentCode === specialty));
  const domainCodes = new Set(domains.map((item) => item.code));
  const topics = data.topics.filter((item) => item.active && (domain ? item.parentCode === domain : domainCodes.has(item.parentCode ?? "")));
  const topicCodes = new Set(topics.map((item) => item.code));
  const subtopics = data.subtopics.filter((item) => item.active && (topic ? item.parentCode === topic : topicCodes.has(item.parentCode ?? "")));
  const states: Array<{ value: TeachingQuestionStateFilter; label: string }> = mode === "review"
    ? [{ value: "incorrect", label: "Incorrect" }, { value: "marked", label: "Marked" }, { value: "answered", label: "Previously answered" }]
    : [
      { value: "all", label: "All" }, { value: "unseen", label: "Unseen" },
      { value: "correct", label: "Correct" }, { value: "incorrect", label: "Incorrect" },
      { value: "answered", label: "Previously answered" }, { value: "marked", label: "Marked" },
    ];

  const start = () => {
    creation.mutate({
      mode,
      questionCount,
      timed: mode === "exam" && timed,
      ...(mode === "exam" && timed ? { timeLimitSeconds: timeLimitMinutes * 60 } : {}),
      filters,
    });
  };

  return (
    <section aria-labelledby="teaching-qbank-title" className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Question Bank</p>
        <h1 id="teaching-qbank-title" className="mt-1 text-2xl font-semibold text-foreground">Create a session</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose a question set and how you want to work through it.</p>
      </header>

      <Card className="space-y-6 p-5 sm:p-6">
        <div>
          <h2 className="text-base font-semibold text-foreground">Classification</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Specialty">
              <select className={fieldClass} value={specialty} onChange={(event) => { setSpecialty(event.target.value); setDomain(""); setTopic(""); setSubtopic(""); }}>
                {codeOptions(specialties, "All specialties")}
              </select>
            </Field>
            <Field label="Domain">
              <select className={fieldClass} value={domain} onChange={(event) => { setDomain(event.target.value); setTopic(""); setSubtopic(""); }}>
                {codeOptions(domains, "All domains")}
              </select>
            </Field>
            <Field label="Topic">
              <select className={fieldClass} value={topic} onChange={(event) => { setTopic(event.target.value); setSubtopic(""); }}>
                {codeOptions(topics, "All topics")}
              </select>
            </Field>
            <Field label="Subtopic">
              <select className={fieldClass} value={subtopic} onChange={(event) => setSubtopic(event.target.value)}>
                {codeOptions(subtopics, "All subtopics")}
              </select>
            </Field>
          </div>
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-semibold text-foreground">More filters</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Modalities" hint="Select one or more.">
              <select aria-label="Modalities" className={`${fieldClass} min-h-24`} multiple value={modalities} onChange={(event) => setModalities(setValue(event))}>
                {data.modalities.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Competencies" hint="Select one or more.">
              <select aria-label="Competencies" className={`${fieldClass} min-h-24`} multiple value={competencies} onChange={(event) => setCompetencies(setValue(event))}>
                {data.competencies.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Training levels" hint="Select one or more.">
              <select aria-label="Training levels" className={`${fieldClass} min-h-24`} multiple value={trainingLevels} onChange={(event) => setTrainingLevels(setValue(event))}>
                {data.trainingLevels.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Difficulty" hint="Select one or more.">
              <select aria-label="Difficulty" className={`${fieldClass} min-h-24`} multiple value={difficulty.map(String)} onChange={(event) => setDifficulty(setValue(event).map(Number))}>
                {data.difficulties.filter((item) => item.active).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Tags" hint="Select one or more.">
              <select aria-label="Tags" className={`${fieldClass} min-h-24`} multiple value={tags} onChange={(event) => setTags(setValue(event))}>
                {data.tags.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </Field>
          </div>
        </details>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Question state">
            <select className={fieldClass} value={questionState} onChange={(event) => setQuestionState(event.target.value as TeachingQuestionStateFilter)}>
              {states.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Mode">
            <select className={fieldClass} value={mode} onChange={(event) => {
              const nextMode = event.target.value as TeachingSessionMode;
              setMode(nextMode);
              if (nextMode === "review" && questionState === "all") setQuestionState("incorrect");
              if (nextMode !== "exam") setTimed(false);
            }}>
              <option value="study">Study / Tutor</option>
              <option value="exam">Exam</option>
              <option value="review">Review</option>
            </select>
          </Field>
          <Field label="Number of questions">
            <Input aria-label="Number of questions" type="number" min={1} max={100} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} />
          </Field>
          {mode === "exam" && (
            <div className="space-y-3">
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-foreground">
                <Checkbox checked={timed} onCheckedChange={setTimed} aria-label="Timed exam" /> Timed Exam
              </label>
              {timed && <Field label="Time limit (minutes)">
                <Input aria-label="Time limit (minutes)" type="number" min={1} max={240} value={timeLimitMinutes} onChange={(event) => setTimeLimitMinutes(Number(event.target.value))} />
              </Field>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted p-4">
          <p className="text-sm font-medium text-foreground" role="status" aria-live="polite">
            {availability.isLoading ? "Checking available questions…" : availability.isError ? "Availability is temporarily unavailable." : `Available questions: ${availability.data?.available ?? 0}`}
          </p>
          <Button onClick={start} disabled={creation.isPending || availability.isLoading || availability.isError || (availability.data?.available ?? 0) < questionCount || questionCount < 1 || questionCount > 100 || (timed && (timeLimitMinutes < 1 || timeLimitMinutes > 240))}>
            {creation.isPending ? "Creating session…" : "Start session"}
          </Button>
        </div>
        {creation.isError && <p className="text-sm text-red-700" role="alert">{creation.error instanceof Error ? creation.error.message : "The session could not be created."}</p>}
      </Card>
    </section>
  );
}
