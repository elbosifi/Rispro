import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useMatch, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, Input, LoadingState, Textarea } from "@/components/shared";
import { registerUnsavedNavigationGuard, requestNavigationWithUnsavedGuard } from "@/lib/unsaved-navigation-guard";
import { useTeachingAuth } from "../auth/teaching-auth-context";
import { TeachingAccessDenied } from "../components/teaching-access-denied";
import {
  approveTeachingQuestionReview,
  createTeachingCaseRequest,
  createTeachingQuestionRequest,
  createTeachingQuestionRevision,
  createTeachingReferenceRequest,
  createTeachingSourceRequest,
  fetchTeachingCatalog,
  fetchTeachingImportBatch,
  fetchTeachingQuestion,
  fetchTeachingQuestionBanks,
  listTeachingCases,
  listTeachingAssets,
  listTeachingReferences,
  listTeachingSources,
  publishTeachingQuestion,
  retireTeachingQuestion,
  returnTeachingQuestionToDraft,
  submitTeachingQuestionForReview,
  teachingAssetUrl,
  updateTeachingQuestionDraft,
  validateTeachingQuestionContent,
  type TeachingCatalog,
  type TeachingQuestionCommand,
  type TeachingQuestionDetail,
  type TeachingQuestionRevision,
  type TeachingReference,
  type TeachingSource,
  uploadTeachingAsset,
} from "../api/teaching-api";

function blankCommand(catalog: TeachingCatalog, banks: Array<{ code: string; name: string; specialtyCode: string }>): TeachingQuestionCommand {
  const bank = banks[0];
  const specialtyCode = bank?.specialtyCode ?? catalog.specialties[0]?.code ?? "";
  const domainCode = catalog.domains.find((item) => item.parentCode === specialtyCode)?.code ?? "";
  return {
    externalId: "", questionBankCode: bank?.code ?? "", type: "single_best_answer", stem: "",
    specialtyCode, domainCode, topicCode: null, subtopicCode: null, difficulty: 3,
    trainingLevelCode: null, caseId: null,
    explanation: { summary: "", teachingPoint: "", furtherDiscussion: null },
    options: [{ key: "A", text: "", isCorrect: false, explanation: null }, { key: "B", text: "", isCorrect: true, explanation: null }],
    modalityCodes: [], competencyCodes: [], tagCodes: [], sources: [], references: [], assetIds: [], assetAltTexts: [],
    authorship: { kind: "human_authored", modelName: null },
  };
}

function revisionCommand(question: TeachingQuestionDetail, revision: TeachingQuestionRevision): TeachingQuestionCommand {
  return {
    externalId: question.externalId,
    questionBankCode: question.questionBank.code,
    type: revision.type,
    stem: revision.stem,
    specialtyCode: revision.classification.specialty.code,
    domainCode: revision.classification.domain.code,
    topicCode: revision.classification.topic?.code ?? null,
    subtopicCode: revision.classification.subtopic?.code ?? null,
    difficulty: revision.difficulty,
    trainingLevelCode: revision.trainingLevel,
    caseId: revision.case?.id ?? null,
    explanation: { ...revision.explanation },
    options: revision.options.map((option) => ({ ...option })),
    modalityCodes: revision.modalities.map((item) => item.code),
    competencyCodes: revision.competencies.map((item) => item.code),
    tagCodes: revision.tags.map((item) => item.code),
    sources: revision.sources.map((source) => ({ sourceId: source.id, relationship: source.relationship, notes: source.notes })),
    references: revision.references.map((reference) => ({ referenceId: reference.id, notes: reference.notes })),
    assetIds: revision.assets.map((asset) => asset.id),
    assetAltTexts: revision.assets.map((asset) => ({ assetId: asset.id, altText: asset.altText })),
    authorship: { ...revision.authorship },
  };
}

function statusVariant(status: string): "success" | "info" | "draft" | "neutral" {
  return status === "published" ? "success" : status === "in_review" ? "info" : status === "draft" ? "draft" : "neutral";
}

function FieldLabel({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-xs font-semibold text-muted-foreground">{children}</label>;
}

function selectCatalog(items: Array<{ code: string; label: string }>, value: string | null, label: string, onChange: (next: string | null) => void, disabled = false) {
  return (
    <select aria-label={label} className="input-premium h-10 w-full" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">Select {label.toLowerCase()}</option>
      {items.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
    </select>
  );
}

export function TeachingQuestionEditorPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id: routeId } = useParams();
  const isNew = useMatch("/teaching/admin/questions/new") !== null;
  const [searchParams, setSearchParams] = useSearchParams();
  const { identity } = useTeachingAuth();
  const questionId = isNew ? null : Number(routeId);
  const permissions = identity?.permissions ?? [];
  const canAuthor = permissions.includes("teaching.author") || permissions.includes("teaching.admin");
  const canReview = permissions.includes("teaching.review") || permissions.includes("teaching.admin");
  const canPublish = permissions.includes("teaching.publish") || permissions.includes("teaching.admin");
  const canManage = canAuthor || canReview || canPublish;
  const catalog = useQuery({ queryKey: ["teaching", "catalog"], queryFn: fetchTeachingCatalog, staleTime: 60_000 });
  const banks = useQuery({ queryKey: ["teaching", "admin-question-banks"], queryFn: fetchTeachingQuestionBanks, staleTime: 60_000 });
  const question = useQuery({ queryKey: ["teaching", "question", questionId], queryFn: () => fetchTeachingQuestion(questionId!), enabled: questionId !== null && Number.isSafeInteger(questionId) && questionId > 0 });
  const current = question.data;
  const selectedRevisionId = searchParams.get("revisionId");
  const revision = current?.revisions.find((item) => String(item.id) === selectedRevisionId) ?? current?.revisions[0];
  const selectedIsLatest = Boolean(current && revision && current.revisions[0]?.id === revision.id);
  const editable = canAuthor && (isNew || revision?.status === "draft");
  const [command, setCommand] = useState<TeachingQuestionCommand | null>(null);
  const [baseline, setBaseline] = useState("");
  const [message, setMessage] = useState<{ text: string; kind: "success" | "error" | "info" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [validation, setValidation] = useState<{ errors: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }> } | null>(null);
  const [failedImages, setFailedImages] = useState<number[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [referenceSearch, setReferenceSearch] = useState("");
  const [assetSearch, setAssetSearch] = useState("");
  const [catalogSearch, setCatalogSearch] = useState({ modalities: "", competencyCodes: "", tagCodes: "" });
  const [newSourceOpen, setNewSourceOpen] = useState(false);
  const [newReferenceOpen, setNewReferenceOpen] = useState(false);
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [sourceForm, setSourceForm] = useState({ sourceType: "textbook", title: "", organization: "", year: "", authors: "", edition: "", chapter: "", page: "", examName: "", examSitting: "", examPaper: "", questionNumber: "", url: "", doi: "", notes: "" });
  const [referenceForm, setReferenceForm] = useState({ referenceType: "textbook", title: "", organization: "", year: "", authors: "", edition: "", url: "", doi: "", citationText: "", notes: "" });
  const [caseForm, setCaseForm] = useState({ externalId: "", specialtyCode: "", title: "", clinicalHistory: "" });
  const sourceCatalog = useQuery({ queryKey: ["teaching", "editorial-sources", sourceSearch], queryFn: () => listTeachingSources(sourceSearch), enabled: canManage });
  const referenceCatalog = useQuery({ queryKey: ["teaching", "editorial-references", referenceSearch], queryFn: () => listTeachingReferences(referenceSearch), enabled: canManage });
  const caseCatalog = useQuery({ queryKey: ["teaching", "editorial-cases"], queryFn: () => listTeachingCases(), enabled: canManage });
  const assetCatalog = useQuery({ queryKey: ["teaching", "editorial-assets", assetSearch], queryFn: () => listTeachingAssets(assetSearch), enabled: canAuthor });
  const initializedKey = useRef("");
  const draftJson = command ? JSON.stringify(command) : "";
  const dirty = Boolean(command && baseline && draftJson !== baseline);

  useEffect(() => {
    const initializationKey = isNew ? "new" : `${questionId}:${revision?.id ?? "loading"}:${revision?.version ?? ""}`;
    if (initializationKey === initializedKey.current) return;
    if (isNew) {
      if (!catalog.data || !banks.data) return;
      const initial = blankCommand(catalog.data, banks.data.items);
      setCommand(initial);
      setBaseline(JSON.stringify(initial));
      initializedKey.current = initializationKey;
      return;
    }
    if (!current || !revision) return;
    const initial = revisionCommand(current, revision);
    setCommand(initial);
    setBaseline(JSON.stringify(initial));
    setValidation(null);
    initializedKey.current = initializationKey;
  }, [isNew, questionId, catalog.data, banks.data, current, revision]);

  useEffect(() => {
    if (!dirty) return;
    return registerUnsavedNavigationGuard((proceed) => {
      if (window.confirm("You have unsaved Teaching question changes. Leave this page?")) proceed();
    });
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const detailQuery = useQuery({
    queryKey: ["teaching", "import-batch", revision?.audit.importBatchId],
    queryFn: () => fetchTeachingImportBatch(revision!.audit.importBatchId!),
    enabled: Boolean(revision?.audit.importBatchId),
  });

  const specialty = command?.specialtyCode ?? "";
  const domain = command?.domainCode ?? "";
  const topic = command?.topicCode ?? null;
  const domains = catalog.data?.domains.filter((item) => item.parentCode === specialty) ?? [];
  const topics = catalog.data?.topics.filter((item) => item.parentCode === domain) ?? [];
  const subtopics = catalog.data?.subtopics.filter((item) => item.parentCode === topic) ?? [];
  const filteredSources = useMemo(() => sourceCatalog.data?.items ?? [], [sourceCatalog.data]);
  const filteredReferences = useMemo(() => referenceCatalog.data?.items ?? [], [referenceCatalog.data]);
  const filteredAssets = useMemo(() => assetCatalog.data?.items ?? [], [assetCatalog.data]);

  const update = <K extends keyof TeachingQuestionCommand>(key: K, value: TeachingQuestionCommand[K]) => setCommand((currentValue) => currentValue ? { ...currentValue, [key]: value } : currentValue);
  const updateExplanation = (key: keyof TeachingQuestionCommand["explanation"], value: string) => setCommand((currentValue) => currentValue ? { ...currentValue, explanation: { ...currentValue.explanation, [key]: value || null } } : currentValue);
  const updateOption = (index: number, patch: Partial<TeachingQuestionCommand["options"][number]>) => setCommand((currentValue) => currentValue ? { ...currentValue, options: currentValue.options.map((option, position) => position === index ? { ...option, ...patch } : option) } : currentValue);

  const commitResult = (result: TeachingQuestionDetail) => {
    queryClient.setQueryData(["teaching", "question", result.id], result);
    void queryClient.invalidateQueries({ queryKey: ["teaching", "admin-questions"] });
    const latest = result.revisions[0];
    if (latest) {
      const next = revisionCommand(result, latest);
      setCommand(next);
      setBaseline(JSON.stringify(next));
    }
    setMessage({ text: "Teaching question updated.", kind: "success" });
  };

  const save = async () => {
    if (!command || !editable) return;
    setBusy(true); setMessage(null);
    try {
      if (isNew) {
        const created = await createTeachingQuestionRequest(command);
        queryClient.setQueryData(["teaching", "question", created.id], created);
        void queryClient.invalidateQueries({ queryKey: ["teaching", "admin-questions"] });
        const createdRevision = created.revisions[0];
        if (createdRevision) {
          const next = revisionCommand(created, createdRevision);
          setCommand(next); setBaseline(JSON.stringify(next));
        }
        setMessage({ text: "Draft question created.", kind: "success" });
        navigate(`/teaching/admin/questions/${created.id}`);
      } else if (current && revision) {
        const updated = await updateTeachingQuestionDraft(current.id, revision.id, command, revision.version);
        commitResult(updated);
      }
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not save this Teaching question.", kind: "error" });
    } finally { setBusy(false); }
  };

  const runAction = async (action: () => Promise<TeachingQuestionDetail>, success: string) => {
    if (!current) return;
    setBusy(true); setMessage(null);
    try { commitResult(await action()); setMessage({ text: success, kind: "success" }); }
    catch (error) { setMessage({ text: error instanceof Error ? error.message : "Teaching action failed.", kind: "error" }); }
    finally { setBusy(false); }
  };

  const checkValidation = async () => {
    if (!command) return;
    setBusy(true); setMessage(null);
    try {
      const result = await validateTeachingQuestionContent(command);
      setValidation(result);
      setMessage(result.errors.length ? { text: "Resolve the validation errors before submitting for review.", kind: "error" } : { text: "Content validation completed.", kind: "success" });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Content validation failed.", kind: "error" }); }
    finally { setBusy(false); }
  };

  const createSource = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const source: Omit<TeachingSource, "id"> = {
        sourceType: sourceForm.sourceType, title: sourceForm.title.trim() || null, organization: sourceForm.organization.trim() || null,
        authors: sourceForm.authors.split(",").map((item) => item.trim()).filter(Boolean), edition: sourceForm.edition || null,
        year: sourceForm.year ? Number(sourceForm.year) : null, chapter: sourceForm.chapter || null, page: sourceForm.page || null,
        examName: sourceForm.examName || null, examSitting: sourceForm.examSitting || null, examPaper: sourceForm.examPaper || null,
        questionNumber: sourceForm.questionNumber || null, url: sourceForm.url || null, doi: sourceForm.doi || null,
        notes: sourceForm.notes || null, metadata: {},
      };
      const saved = await createTeachingSourceRequest(source);
      await queryClient.invalidateQueries({ queryKey: ["teaching", "editorial-sources"] });
      update("sources", [...(command?.sources ?? []), { sourceId: saved.id, relationship: "original", notes: null }]);
      setNewSourceOpen(false); setSourceForm((value) => ({ ...value, title: "" }));
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Could not create source.", kind: "error" }); }
    finally { setBusy(false); }
  };

  const createReference = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const input: Omit<TeachingReference, "id"> = {
        referenceType: referenceForm.referenceType, title: referenceForm.title.trim(), organization: referenceForm.organization || null,
        authors: referenceForm.authors.split(",").map((item) => item.trim()).filter(Boolean), year: referenceForm.year ? Number(referenceForm.year) : null,
        edition: referenceForm.edition || null, url: referenceForm.url || null, doi: referenceForm.doi || null,
        citationText: referenceForm.citationText || null, notes: referenceForm.notes || null,
      };
      const saved = await createTeachingReferenceRequest(input);
      await queryClient.invalidateQueries({ queryKey: ["teaching", "editorial-references"] });
      update("references", [...(command?.references ?? []), { referenceId: saved.id, notes: null }]);
      setNewReferenceOpen(false); setReferenceForm((value) => ({ ...value, title: "" }));
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Could not create reference.", kind: "error" }); }
    finally { setBusy(false); }
  };

  const createCase = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const saved = await createTeachingCaseRequest({ externalId: caseForm.externalId.trim(), specialtyCode: caseForm.specialtyCode, title: caseForm.title || null, clinicalHistory: caseForm.clinicalHistory || null });
      await queryClient.invalidateQueries({ queryKey: ["teaching", "editorial-cases"] });
      update("caseId", saved.id);
      setNewCaseOpen(false); setCaseForm((value) => ({ ...value, externalId: "", title: "", clinicalHistory: "" }));
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : "Could not create Teaching case.", kind: "error" }); }
    finally { setBusy(false); }
  };

  const uploadImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !command || !editable) return;
    setBusy(true); setMessage(null);
    try {
      const asset = await uploadTeachingAsset(file);
      await queryClient.invalidateQueries({ queryKey: ["teaching", "editorial-assets"] });
      queryClient.setQueryData<{ items: typeof asset[] }>(["teaching", "editorial-assets", assetSearch], (currentAssets) => ({
        items: currentAssets?.items.some((item) => item.id === asset.id) ? currentAssets.items : [asset, ...(currentAssets?.items ?? [])],
      }));
      update("assetIds", command.assetIds.includes(asset.id) ? command.assetIds : [...command.assetIds, asset.id]);
      update("assetAltTexts", [...command.assetAltTexts.filter((item) => item.assetId !== asset.id), { assetId: asset.id, altText: asset.altText }]);
      setMessage({ text: "Teaching image uploaded and attached. Save the Draft to retain it.", kind: "success" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not upload this Teaching image.", kind: "error" });
    } finally {
      input.value = "";
      setBusy(false);
    }
  };

  if (!canManage) return <TeachingAccessDenied capability="Teaching editorial access" />;
  if (isNew && !canAuthor) return <TeachingAccessDenied capability="teaching.author" />;
  if ((!isNew && question.isPending) || !command || !catalog.data || !banks.data) return <LoadingState message="Loading Teaching editor…" />;
  if (!isNew && question.isError) return <ErrorState title="Could not load question" message={question.error.message} onRetry={() => void question.refetch()} />;
  if (!isNew && !current) return <ErrorState title="Question not found" message="This Teaching question may have been removed or the link is invalid." />;
  if (!isNew && !revision) return <ErrorState title="Revision not found" message="Select a revision from the question history." />;

  const selectedAssets = (command?.assetIds ?? []).map((assetId) =>
    revision?.assets.find((asset) => asset.id === assetId)
      ?? assetCatalog.data?.items.find((asset) => asset.id === assetId)
      ?? { id: assetId, mimeType: "image/jpeg", originalFilename: `Teaching asset ${assetId}`, altText: "", sizeBytes: 0 },
  );
  const caseAssets = revision?.case?.assets ?? [];
  const batchId = revision?.audit.importBatchId;
  const batch = detailQuery.data;
  const batchUploader = typeof batch?.uploader === "object" && batch.uploader !== null && "identitySubject" in batch.uploader ? String((batch.uploader as { identitySubject: unknown }).identitySubject) : "Unknown";
  const canApproveReview = Boolean(canReview && revision?.status === "in_review" && !revision.audit.reviewedAt);
  const canPublishCurrent = Boolean(canPublish && revision?.status === "in_review" && revision.audit.reviewedAt);

  const changeRevision = (revisionId: number) => {
    const next = new URLSearchParams(searchParams); next.set("revisionId", String(revisionId));
    requestNavigationWithUnsavedGuard(() => setSearchParams(next));
  };

  return (
    <section aria-labelledby="teaching-question-editor-title" className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">Teaching administration</p>
          <h1 id="teaching-question-editor-title" className="mt-1 break-words text-2xl font-semibold text-foreground">{isNew ? "New question" : current!.externalId}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{isNew ? "Create a new question as Draft." : `Question bank: ${current!.questionBank.name} · ${revision!.revisionNumber === undefined ? "" : `Revision ${revision!.revisionNumber}`}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={() => requestNavigationWithUnsavedGuard(() => navigate("/teaching/admin/questions"))}>Back to questions</Button>
          {!isNew ? <Badge variant={statusVariant(revision!.status)}>{revision!.status.replace("_", " ")}</Badge> : <Badge variant="draft">Draft</Badge>}
        </div>
      </div>

      {message ? <Alert role="status" variant={message.kind === "error" ? "error" : message.kind === "success" ? "success" : "info"}>{message.text}</Alert> : null}

      {!isNew && current!.revisions.length > 1 ? (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm font-semibold text-foreground">Revision history</span>
          {current!.revisions.map((item) => (
            <Button key={item.id} type="button" variant={item.id === revision!.id ? "primary" : "secondary"} size="sm" onClick={() => changeRevision(item.id)}>
              v{item.revisionNumber} · {item.status.replace("_", " ")}
            </Button>
          ))}
        </Card>
      ) : null}

      {!isNew && batchId ? (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="font-semibold text-foreground">Imported lineage</h2><p className="mt-1 text-sm text-muted-foreground">Read-only import audit metadata.</p></div>
            <Badge variant="info">Imported</Badge>
          </div>
          {detailQuery.isPending ? <p className="mt-3 text-sm text-muted-foreground">Loading import details…</p> : null}
          {detailQuery.isError ? <p role="alert" className="mt-3 text-sm text-destructive">Could not load import batch metadata.</p> : null}
          {batch ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs text-muted-foreground">Batch ID</dt><dd className="break-all font-mono">{batchId}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Original filename</dt><dd>{String(batch.originalFilename ?? "Unknown")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Import date</dt><dd>{String(batch.createdAt ? new Date(String(batch.createdAt)).toLocaleString() : "Unknown")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Imported by</dt><dd>{batchUploader}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Schema version</dt><dd>{String(batch.schemaVersion ?? "Unknown")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Batch status</dt><dd>{String(batch.status ?? "Unknown")}</dd></div>
          </dl> : null}
          <Link className="mt-4 inline-flex min-h-9 items-center gap-2 text-sm font-medium text-accent hover:underline" to={`/teaching/admin/import/batches/${encodeURIComponent(batchId)}`} onClick={(event) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); requestNavigationWithUnsavedGuard(() => navigate(`/teaching/admin/import/batches/${encodeURIComponent(batchId)}`));
          }}>Open import batch <ExternalLink size={14} aria-hidden="true" /></Link>
        </Card>
      ) : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-5">
          <Card className="space-y-5 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold text-foreground">Question content</h2><p className="mt-1 text-sm text-muted-foreground">Structured text is saved to this revision.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><FieldLabel htmlFor="teaching-external-id">External ID</FieldLabel><Input id="teaching-external-id" value={command.externalId} disabled={!isNew} onChange={(event) => update("externalId", event.target.value.toUpperCase())} placeholder="RAD-NEURO-001" /></div>
              <div><FieldLabel htmlFor="teaching-question-bank">Question bank</FieldLabel><select id="teaching-question-bank" className="input-premium h-10 w-full" value={command.questionBankCode} disabled={!isNew} onChange={(event) => {
                const selected = banks.data.items.find((bank) => bank.code === event.target.value);
                const domainCode = catalog.data.domains.find((item) => item.parentCode === selected?.specialtyCode)?.code ?? "";
                setCommand((value) => value ? { ...value, questionBankCode: event.target.value, specialtyCode: selected?.specialtyCode ?? value.specialtyCode, domainCode, topicCode: null, subtopicCode: null } : value);
              }}>{banks.data.items.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></div>
              <div><FieldLabel htmlFor="teaching-question-type">Question type</FieldLabel><select id="teaching-question-type" className="input-premium h-10 w-full" value={command.type} disabled={!editable} onChange={(event) => update("type", event.target.value as TeachingQuestionCommand["type"])}><option value="single_best_answer">Single best answer</option><option value="image_based_sba">Image-based SBA</option><option value="case_based_sba">Case-based SBA</option></select></div>
              <div className="sm:col-span-2"><FieldLabel htmlFor="teaching-question-stem">Question stem</FieldLabel><Textarea id="teaching-question-stem" value={command.stem} disabled={!editable} onChange={(event) => update("stem", event.target.value)} rows={5} /></div>
            </div>
          </Card>

          <Card className="space-y-5 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold text-foreground">Answer options</h2><p className="mt-1 text-sm text-muted-foreground">Choose exactly one correct option. The server checks this when saving.</p></div>
            <div className="space-y-3">
              {command.options.map((option, index) => (
                <div key={option.key} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:items-start" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center gap-2 sm:flex-col">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-sm font-semibold" aria-label={`Option ${option.key}`}>{option.key}</span>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="sm" aria-label={`Move option ${option.key} up`} disabled={!editable || index === 0} onClick={() => setCommand((value) => { if (!value) return value; const options = [...value.options]; [options[index - 1], options[index]] = [options[index]!, options[index - 1]!]; return { ...value, options }; })}><ArrowUp size={15} /></Button>
                      <Button type="button" variant="ghost" size="sm" aria-label={`Move option ${option.key} down`} disabled={!editable || index === command.options.length - 1} onClick={() => setCommand((value) => { if (!value) return value; const options = [...value.options]; [options[index + 1], options[index]] = [options[index]!, options[index + 1]!]; return { ...value, options }; })}><ArrowDown size={15} /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="sr-only" htmlFor={`teaching-option-${option.key}`}>Option {option.key} text</label>
                    <Textarea id={`teaching-option-${option.key}`} value={option.text} disabled={!editable} onChange={(event) => updateOption(index, { text: event.target.value })} rows={2} placeholder={`Option ${option.key}`} />
                    <label className="sr-only" htmlFor={`teaching-option-explanation-${option.key}`}>Option {option.key} explanation</label>
                    <Input id={`teaching-option-explanation-${option.key}`} value={option.explanation ?? ""} disabled={!editable} onChange={(event) => updateOption(index, { explanation: event.target.value || null })} placeholder="Option explanation (optional)" />
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="radio" name="teaching-correct-option" aria-label={`Mark option ${option.key} correct`} checked={option.isCorrect} disabled={!editable} onChange={() => setCommand((value) => value ? { ...value, options: value.options.map((item, position) => ({ ...item, isCorrect: position === index })) } : value)} /> Correct answer</label>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Delete option ${option.key}`} disabled={!editable || command.options.length <= 2} onClick={() => setCommand((value) => {
                      if (!value) return value;
                      const options = value.options.filter((_, position) => position !== index).map((item, position) => ({ ...item, key: String.fromCharCode(65 + position) }));
                      if (!options.some((item) => item.isCorrect)) options[0] = { ...options[0]!, isCorrect: true };
                      return { ...value, options };
                    })}><Trash2 size={15} aria-hidden="true" /> Remove</Button>
                  </div>
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" disabled={!editable || command.options.length >= 26} onClick={() => setCommand((value) => value ? { ...value, options: [...value.options, { key: String.fromCharCode(65 + value.options.length), text: "", isCorrect: false, explanation: null }] } : value)}><Plus size={15} aria-hidden="true" /> Add option</Button>
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold text-foreground">Explanation</h2><p className="mt-1 text-sm text-muted-foreground">Faculty-facing rationale and teaching notes.</p></div>
            <div><FieldLabel htmlFor="teaching-explanation-summary">Summary</FieldLabel><Textarea id="teaching-explanation-summary" value={command.explanation.summary} disabled={!editable} onChange={(event) => updateExplanation("summary", event.target.value)} rows={3} /></div>
            <div><FieldLabel htmlFor="teaching-teaching-point">Teaching point</FieldLabel><Textarea id="teaching-teaching-point" value={command.explanation.teachingPoint} disabled={!editable} onChange={(event) => updateExplanation("teachingPoint", event.target.value)} rows={3} /></div>
            <div><FieldLabel htmlFor="teaching-further-discussion">Further discussion</FieldLabel><Textarea id="teaching-further-discussion" value={command.explanation.furtherDiscussion ?? ""} disabled={!editable} onChange={(event) => updateExplanation("furtherDiscussion", event.target.value)} rows={4} /></div>
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold text-foreground">Classification</h2><p className="mt-1 text-sm text-muted-foreground">Each selection constrains the next level of the Teaching catalog.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><FieldLabel htmlFor="teaching-specialty">Specialty</FieldLabel><div id="teaching-specialty">{selectCatalog(catalog.data.specialties, command.specialtyCode, "Specialty", (value) => {
                const code = value ?? ""; const bank = banks.data.items.find((item) => item.code === command.questionBankCode);
                const domainCode = catalog.data.domains.find((item) => item.parentCode === code)?.code ?? "";
                setCommand((currentValue) => currentValue ? { ...currentValue, specialtyCode: code, domainCode, topicCode: null, subtopicCode: null, caseId: bank?.specialtyCode === code ? currentValue.caseId : null } : currentValue);
              }, !editable || !isNew)}</div></div>
              <div><FieldLabel htmlFor="teaching-domain">Domain</FieldLabel><div id="teaching-domain">{selectCatalog(domains, command.domainCode, "Domain", (value) => { setCommand((currentValue) => currentValue ? { ...currentValue, domainCode: value ?? "", topicCode: null, subtopicCode: null } : currentValue); }, !editable)}</div></div>
              <div><FieldLabel htmlFor="teaching-topic">Topic</FieldLabel><div id="teaching-topic">{selectCatalog(topics, command.topicCode, "Topic", (value) => { setCommand((currentValue) => currentValue ? { ...currentValue, topicCode: value, subtopicCode: null } : currentValue); }, !editable || !command.domainCode)}</div></div>
              <div><FieldLabel htmlFor="teaching-subtopic">Subtopic</FieldLabel><div id="teaching-subtopic">{selectCatalog(subtopics, command.subtopicCode, "Subtopic", (value) => update("subtopicCode", value), !editable || !command.topicCode)}</div></div>
              <div><FieldLabel htmlFor="teaching-difficulty">Difficulty</FieldLabel><select id="teaching-difficulty" className="input-premium h-10 w-full" value={command.difficulty} disabled={!editable} onChange={(event) => update("difficulty", Number(event.target.value))}>{catalog.data.difficulties.map((item) => <option key={item.value} value={item.value}>{item.value} · {item.label}</option>)}</select></div>
              <div><FieldLabel htmlFor="teaching-training-level">Training level</FieldLabel><select id="teaching-training-level" className="input-premium h-10 w-full" value={command.trainingLevelCode ?? ""} disabled={!editable} onChange={(event) => update("trainingLevelCode", event.target.value || null)}><option value="">Select training level</option>{catalog.data.trainingLevels.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div>
            </div>
            {([
              ["modalities", "Modalities", catalog.data.modalities],
              ["competencyCodes", "Competencies", catalog.data.competencies],
              ["tagCodes", "Tags", catalog.data.tags],
            ] as const).map(([key, label, items]) => {
              const commandKey = key === "modalities" ? "modalityCodes" : key;
              const searchKey = key as keyof typeof catalogSearch;
              const selected = command[commandKey];
              const needle = catalogSearch[searchKey].trim().toLowerCase();
              const visibleItems = items.filter((item) => `${item.code} ${item.label}`.toLowerCase().includes(needle));
              return <fieldset key={key} className="space-y-2"><legend className="text-xs font-semibold text-muted-foreground">{label}</legend><Input aria-label={`Search ${label.toLowerCase()}`} value={catalogSearch[searchKey]} onChange={(event) => setCatalogSearch((value) => ({ ...value, [searchKey]: event.target.value }))} placeholder={`Find ${label.toLowerCase()}`} /><div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>{visibleItems.map((item) => <label key={item.code} className="flex min-h-8 items-center gap-2 text-sm text-foreground"><Checkbox checked={selected.includes(item.code)} disabled={!editable} onCheckedChange={(checked) => update(commandKey, checked ? [...selected, item.code] : selected.filter((code) => code !== item.code))} /><span>{item.label}</span></label>)}{visibleItems.length === 0 ? <p className="text-sm text-muted-foreground">No matching {label.toLowerCase()}.</p> : null}</div></fieldset>;
            })}
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">Question source</h2><p className="mt-1 text-sm text-muted-foreground">Where the question originated. Supporting references are listed separately.</p></div>{canAuthor && permissions.includes("teaching.manage_sources") ? <Button type="button" variant="secondary" onClick={() => setNewSourceOpen(true)}><Plus size={15} /> New source</Button> : null}</div>
            <Input aria-label="Search sources" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Find an existing source" />
            <div className="space-y-3">{command.sources.map((source, index) => {
              const found = sourceCatalog.data?.items.find((item) => item.id === source.sourceId);
              return <div key={source.sourceId} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-center" style={{ borderColor: "var(--border)" }}>
                <div className="min-w-0"><span className="text-sm font-medium text-foreground">{found?.title ?? found?.sourceType ?? `Source ${source.sourceId}`}</span><p className="mt-1 text-xs text-muted-foreground">{found ? [found.sourceType.replaceAll("_", " "), found.authors.join(", "), found.edition, found.year, found.chapter ? `Chapter ${found.chapter}` : null, found.page ? `Page ${found.page}` : null, found.examName, found.examSitting, found.examPaper, found.questionNumber ? `Question ${found.questionNumber}` : null, found.organization].filter(Boolean).join(" · ") : "Source record"}</p>{found?.url ? <a className="mt-1 inline-block text-xs text-accent underline" href={found.url} target="_blank" rel="noreferrer">{found.url}</a> : null}<label className="mt-2 block text-xs text-muted-foreground">Source link notes<Input aria-label={`Notes for source ${found?.title ?? source.sourceId}`} className="mt-1" value={source.notes ?? ""} disabled={!editable} onChange={(event) => update("sources", command.sources.map((item, position) => position === index ? { ...item, notes: event.target.value || null } : item))} /></label></div>
                <label className="text-xs text-muted-foreground">Relationship<select aria-label={`Source relationship ${source.sourceId}`} className="input-premium mt-1 h-9 w-full" value={source.relationship} disabled={!editable} onChange={(event) => update("sources", command.sources.map((item, position) => position === index ? { ...item, relationship: event.target.value } : item))}>{(catalog.data.supportedProvenanceRelationships ?? []).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
                <Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => update("sources", command.sources.filter((_, position) => position !== index))} aria-label={`Remove source ${found?.title ?? source.sourceId}`}><Trash2 size={15} /> Remove</Button>
              </div>;
            })}</div>
            <label className="block text-xs font-semibold text-muted-foreground">Add an existing source<select aria-label="Add existing source" className="input-premium mt-1 h-10 w-full" value="" disabled={!editable} onChange={(event) => { const sourceId = Number(event.target.value); if (sourceId && !command.sources.some((item) => item.sourceId === sourceId)) update("sources", [...command.sources, { sourceId, relationship: "unknown", notes: null }]); }}><option value="">Select a source</option>{filteredSources.filter((source) => !command.sources.some((link) => link.sourceId === source.id)).map((source) => <option key={source.id} value={source.id}>{source.title ?? source.sourceType} · {source.sourceType.replaceAll("_", " ")}</option>)}</select></label>
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">Supporting references</h2><p className="mt-1 text-sm text-muted-foreground">Citations supporting the explanation, separate from the question source.</p></div>{editable ? <Button type="button" variant="secondary" onClick={() => setNewReferenceOpen(true)}><Plus size={15} /> New reference</Button> : null}</div>
            <Input aria-label="Search references" value={referenceSearch} onChange={(event) => setReferenceSearch(event.target.value)} placeholder="Find a citation" />
            <ul className="space-y-2">{command.references.map((reference) => {
              const found = referenceCatalog.data?.items.find((item) => item.id === reference.referenceId);
              return <li key={reference.referenceId} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}><div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground">{found?.title ?? `Reference ${reference.referenceId}`}</p><p className="mt-1 text-xs text-muted-foreground">{found ? [found.referenceType.replaceAll("_", " "), found.authors.join(", "), found.edition, found.year, found.organization].filter(Boolean).join(" · ") : "Citation"}</p>{found?.citationText ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{found.citationText}</p> : null}<label className="mt-2 block text-xs text-muted-foreground">Reference link notes<Input aria-label={`Notes for reference ${found?.title ?? reference.referenceId}`} className="mt-1" value={reference.notes ?? ""} disabled={!editable} onChange={(event) => update("references", command.references.map((item) => item.referenceId === reference.referenceId ? { ...item, notes: event.target.value || null } : item))} /></label></div><Button type="button" variant="ghost" size="sm" disabled={!editable} onClick={() => update("references", command.references.filter((item) => item.referenceId !== reference.referenceId))} aria-label={`Remove reference ${found?.title ?? reference.referenceId}`}><Trash2 size={15} /> Remove</Button></li>;
            })}</ul>
            <label className="block text-xs font-semibold text-muted-foreground">Add an existing reference<select aria-label="Add existing reference" className="input-premium mt-1 h-10 w-full" value="" disabled={!editable} onChange={(event) => { const referenceId = Number(event.target.value); if (referenceId && !command.references.some((item) => item.referenceId === referenceId)) update("references", [...command.references, { referenceId, notes: null }]); }}><option value="">Select a reference</option>{filteredReferences.filter((reference) => !command.references.some((link) => link.referenceId === reference.id)).map((reference) => <option key={reference.id} value={reference.id}>{reference.title}</option>)}</select></label>
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-foreground">Teaching case</h2><p className="mt-1 text-sm text-muted-foreground">Educational case material and any associated Teaching images.</p></div>{editable && command.type === "case_based_sba" ? <Button type="button" variant="secondary" onClick={() => { setCaseForm((value) => ({ ...value, specialtyCode: command.specialtyCode })); setNewCaseOpen(true); }}><Plus size={15} /> New case</Button> : null}</div>
            <label className="block text-xs font-semibold text-muted-foreground">Case<select aria-label="Teaching case" className="input-premium mt-1 h-10 w-full" value={command.caseId ?? ""} disabled={!editable || command.type !== "case_based_sba"} onChange={(event) => update("caseId", event.target.value ? Number(event.target.value) : null)}><option value="">{command.type === "case_based_sba" ? "Select an educational case" : "Not used for this question type"}</option>{caseCatalog.data?.items.filter((item) => item.specialtyCode === command.specialtyCode).map((item) => <option key={item.id} value={item.id}>{item.externalId} · {item.title ?? "Untitled case"}</option>)}</select></label>
            {revision?.case ? <div className="rounded-lg bg-muted/50 p-3"><p className="font-medium text-foreground">{revision.case.externalId} · {revision.case.title ?? "Untitled case"}</p>{revision.case.clinicalHistory ? <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{revision.case.clinicalHistory}</p> : null}<AssetPreviews assets={caseAssets} failed={failedImages} setFailed={setFailedImages} /></div> : null}
          </Card>

          <Card className="space-y-4 p-4 sm:p-6">
            <div><h2 className="text-lg font-semibold text-foreground">Question media</h2><p className="mt-1 text-sm text-muted-foreground">Teaching-owned images are served through the protected Teaching API.</p></div>
            {editable ? <>
              <Input aria-label="Search Teaching images" value={assetSearch} onChange={(event) => setAssetSearch(event.target.value)} placeholder="Find an existing Teaching image" />
              <label className="block text-xs font-semibold text-muted-foreground">Attach an existing Teaching image<select aria-label="Attach Teaching image" className="input-premium mt-1 h-10 w-full" value="" onChange={(event) => {
                const assetId = Number(event.target.value); const asset = assetCatalog.data?.items.find((item) => item.id === assetId);
                if (!asset || command.assetIds.includes(assetId)) return;
                update("assetIds", [...command.assetIds, assetId]);
                update("assetAltTexts", [...command.assetAltTexts, { assetId, altText: asset.altText }]);
              }}><option value="">Select an image</option>{filteredAssets.filter((asset) => !command.assetIds.includes(asset.id)).map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename} · {asset.mimeType}</option>)}</select></label>
              <label className="block text-xs font-semibold text-muted-foreground">Upload a Teaching image (JPEG, PNG, or WebP)<Input aria-label="Upload Teaching image" className="mt-1 w-full" type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" disabled={busy} onChange={(event) => void uploadImage(event)} /></label>
            </> : null}
            {selectedAssets.length ? <>
              {selectedAssets.map((asset) => {
                const altText = command.assetAltTexts.find((item) => item.assetId === asset.id)?.altText ?? asset.altText;
                return <div key={asset.id} className="flex flex-wrap items-end gap-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="min-w-0 flex-1"><label className="block text-xs font-semibold text-muted-foreground" htmlFor={`teaching-asset-alt-${asset.id}`}>Alt text · {asset.originalFilename}</label><Input id={`teaching-asset-alt-${asset.id}`} value={altText} disabled={!editable} onChange={(event) => update("assetAltTexts", command.assetAltTexts.map((item) => item.assetId === asset.id ? { ...item, altText: event.target.value } : item))} /></div>
                  {editable ? <Button type="button" variant="ghost" size="sm" onClick={() => { update("assetIds", command.assetIds.filter((id) => id !== asset.id)); update("assetAltTexts", command.assetAltTexts.filter((item) => item.assetId !== asset.id)); }} aria-label={`Remove image ${asset.originalFilename}`}><Trash2 size={15} /> Remove</Button> : null}
                </div>;
              })}
              <AssetPreviews assets={selectedAssets.map((asset) => ({ ...asset, altText: command.assetAltTexts.find((item) => item.assetId === asset.id)?.altText ?? asset.altText }))} failed={failedImages} setFailed={setFailedImages} />
            </> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground" style={{ borderColor: "var(--border)" }}>{command.type === "image_based_sba" ? "No image is attached. Image-based questions must have a Teaching image before they can be published." : "No image is attached to this revision."}</p>}
            {editable ? <p className="text-xs text-muted-foreground">Uploads use the same image decoder, metadata stripping, and Teaching-owned storage path as ZIP imports.</p> : null}
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <Card className="space-y-3 p-4">
            <h2 className="text-base font-semibold text-foreground">Editorial workflow</h2>
            {!isNew ? <dl className="grid grid-cols-2 gap-2 text-xs"><dt className="text-muted-foreground">Question</dt><dd className="text-right text-foreground">{current!.externalId}</dd><dt className="text-muted-foreground">Revision</dt><dd className="text-right text-foreground">{revision!.revisionNumber} · v{revision!.version}</dd><dt className="text-muted-foreground">Created</dt><dd className="text-right text-foreground">{new Date(revision!.audit.createdAt).toLocaleDateString()}</dd><dt className="text-muted-foreground">Created by</dt><dd className="truncate text-right text-foreground">{revision!.audit.createdBy}</dd>{revision!.audit.reviewedAt ? <><dt className="text-muted-foreground">Reviewed</dt><dd className="text-right text-foreground">{new Date(revision!.audit.reviewedAt).toLocaleDateString()} · {revision!.audit.reviewedBy}</dd></> : null}{revision!.audit.publishedAt ? <><dt className="text-muted-foreground">Published</dt><dd className="text-right text-foreground">{new Date(revision!.audit.publishedAt).toLocaleDateString()} · {revision!.audit.publishedBy}</dd></> : null}</dl> : null}
            {!isNew && revision!.authorship.kind !== "human_authored" ? <div className="rounded-lg bg-accent/10 p-3 text-sm"><p className="font-semibold text-foreground">Generation: {revision!.authorship.kind.replaceAll("_", " ")}</p>{revision!.authorship.modelName ? <p className="mt-1 text-muted-foreground">Model: {revision!.authorship.modelName}</p> : null}<p className="mt-1 text-xs text-muted-foreground">Generation provenance does not indicate review or approval.</p></div> : null}
            {isNew && editable ? <><Button className="w-full" type="button" variant="secondary" disabled={busy} onClick={() => void checkValidation()}>Validate content</Button><Button className="w-full" type="button" disabled={busy || !dirty} onClick={() => void save()}><Save size={15} /> Create Draft</Button></> : null}
            {!isNew && editable ? <><Button className="w-full" type="button" disabled={busy || !dirty} onClick={() => void save()}><Save size={15} /> Save Draft</Button><Button className="w-full" type="button" variant="secondary" disabled={busy} onClick={() => void checkValidation()}>Validate content</Button><Button className="w-full" type="button" variant="secondary" disabled={busy || dirty} onClick={() => void runAction(() => submitTeachingQuestionForReview(current!.id), "Submitted for review.")}>Submit for Review</Button></> : null}
            {canApproveReview ? <><Button className="w-full" type="button" disabled={busy} onClick={() => void runAction(() => approveTeachingQuestionReview(current!.id, revision!.id), "Review recorded. A publisher may publish this revision.")}>Approve Review</Button><Button className="w-full" type="button" variant="secondary" disabled={busy} onClick={() => void runAction(() => returnTeachingQuestionToDraft(current!.id, revision!.id), "Returned to Draft.")}>Return to Draft</Button></> : null}
            {canPublishCurrent ? <Button className="w-full" type="button" disabled={busy} onClick={() => void runAction(() => publishTeachingQuestion(current!.id), "Revision published.")}>Publish revision</Button> : null}
            {!isNew && canAuthor && selectedIsLatest && revision!.status === "published" && !current!.retiredAt ? <Button className="w-full" type="button" variant="secondary" disabled={busy} onClick={() => void (async () => {
              setBusy(true); setMessage(null);
              try { const updated = await createTeachingQuestionRevision(current!.id); queryClient.setQueryData(["teaching", "question", current!.id], updated); const draft = updated.revisions[0]!; setSearchParams(new URLSearchParams({ revisionId: String(draft.id) })); setMessage({ text: `Revision ${draft.revisionNumber} created as Draft.`, kind: "success" }); }
              catch (error) { setMessage({ text: error instanceof Error ? error.message : "Could not create revision.", kind: "error" }); }
              finally { setBusy(false); }
            })()}>Create New Revision</Button> : null}
            {!isNew && canPublish && selectedIsLatest && !current!.retiredAt && revision!.status !== "retired" ? <Button className="w-full" type="button" variant="ghost" disabled={busy} onClick={() => {
              if (window.confirm("Retire this Teaching question? Its history will be preserved and it will no longer be available to future learners.")) void runAction(() => retireTeachingQuestion(current!.id), "Question retired; revision history was preserved.");
            }}>Retire question</Button> : null}
            {dirty ? <p role="status" className="text-xs font-medium text-amber-700">Unsaved changes</p> : null}
          </Card>

          <Card className="space-y-3 p-4">
            <div><h2 className="text-base font-semibold text-foreground">Validation</h2><p className="mt-1 text-xs text-muted-foreground">Checked by the Teaching domain rules used by imports and lifecycle transitions.</p></div>
            {validation?.errors.length ? <section aria-label="Validation errors"><h3 className="text-sm font-semibold text-destructive">Errors</h3><ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-destructive">{validation.errors.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></section> : null}
            {validation?.warnings.length ? <section aria-label="Validation warnings"><h3 className="text-sm font-semibold text-amber-700">Warnings</h3><ul className="mt-1 list-disc space-y-1 ps-5 text-sm text-muted-foreground">{validation.warnings.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></section> : null}
            {validation && validation.errors.length === 0 && validation.warnings.length === 0 ? <p className="text-sm text-emerald-700">No validation issues were found.</p> : null}
            {!validation ? <p className="text-sm text-muted-foreground">Run validation to check required content and show educational metadata warnings.</p> : null}
          </Card>
        </aside>
      </div>

      <Dialog open={newSourceOpen} onClose={() => setNewSourceOpen(false)}><DialogContent maxWidth="680px"><DialogHeader><div><DialogTitle>New question source</DialogTitle><DialogDescription>Create a reusable Teaching source record.</DialogDescription></div></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void createSource(event)}>
          <label className="text-xs font-semibold text-muted-foreground">Source type<select className="input-premium mt-1 h-10 w-full" value={sourceForm.sourceType} onChange={(event) => setSourceForm((value) => ({ ...value, sourceType: event.target.value }))}>{catalog.data.supportedSourceTypes.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
          {sourceForm.sourceType !== "original" && sourceForm.sourceType !== "unknown" ? <div><FieldLabel htmlFor="source-title">Title</FieldLabel><Input id="source-title" required value={sourceForm.title} onChange={(event) => setSourceForm((value) => ({ ...value, title: event.target.value }))} /></div> : null}
          <div><FieldLabel htmlFor="source-organization">Organization</FieldLabel><Input id="source-organization" value={sourceForm.organization} onChange={(event) => setSourceForm((value) => ({ ...value, organization: event.target.value }))} /></div>
          <div><FieldLabel htmlFor="source-authors">Authors (comma separated)</FieldLabel><Input id="source-authors" value={sourceForm.authors} onChange={(event) => setSourceForm((value) => ({ ...value, authors: event.target.value }))} /></div>
          {sourceForm.sourceType === "textbook" ? <><div><FieldLabel htmlFor="source-edition">Edition</FieldLabel><Input id="source-edition" value={sourceForm.edition} onChange={(event) => setSourceForm((value) => ({ ...value, edition: event.target.value }))} /></div><div><FieldLabel htmlFor="source-chapter">Chapter</FieldLabel><Input id="source-chapter" value={sourceForm.chapter} onChange={(event) => setSourceForm((value) => ({ ...value, chapter: event.target.value }))} /></div><div><FieldLabel htmlFor="source-page">Page</FieldLabel><Input id="source-page" value={sourceForm.page} onChange={(event) => setSourceForm((value) => ({ ...value, page: event.target.value }))} /></div></> : null}
          {sourceForm.sourceType === "exam" ? <><div><FieldLabel htmlFor="source-exam-name">Exam name</FieldLabel><Input id="source-exam-name" value={sourceForm.examName} onChange={(event) => setSourceForm((value) => ({ ...value, examName: event.target.value }))} /></div><div><FieldLabel htmlFor="source-exam-sitting">Sitting</FieldLabel><Input id="source-exam-sitting" value={sourceForm.examSitting} onChange={(event) => setSourceForm((value) => ({ ...value, examSitting: event.target.value }))} /></div><div><FieldLabel htmlFor="source-exam-paper">Paper</FieldLabel><Input id="source-exam-paper" value={sourceForm.examPaper} onChange={(event) => setSourceForm((value) => ({ ...value, examPaper: event.target.value }))} /></div><div><FieldLabel htmlFor="source-question-number">Question number</FieldLabel><Input id="source-question-number" value={sourceForm.questionNumber} onChange={(event) => setSourceForm((value) => ({ ...value, questionNumber: event.target.value }))} /></div></> : null}
          <div><FieldLabel htmlFor="source-year">Year</FieldLabel><Input id="source-year" type="number" min="1000" max="9999" value={sourceForm.year} onChange={(event) => setSourceForm((value) => ({ ...value, year: event.target.value }))} /></div>
          {sourceForm.sourceType === "website" ? <div><FieldLabel htmlFor="source-url">URL</FieldLabel><Input id="source-url" type="url" value={sourceForm.url} onChange={(event) => setSourceForm((value) => ({ ...value, url: event.target.value }))} /></div> : null}
          <div className="sm:col-span-2"><FieldLabel htmlFor="source-notes">Notes</FieldLabel><Textarea id="source-notes" value={sourceForm.notes} onChange={(event) => setSourceForm((value) => ({ ...value, notes: event.target.value }))} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setNewSourceOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>Create source</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>

      <Dialog open={newReferenceOpen} onClose={() => setNewReferenceOpen(false)}><DialogContent maxWidth="640px"><DialogHeader><div><DialogTitle>New supporting reference</DialogTitle><DialogDescription>Create a reusable citation record.</DialogDescription></div></DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void createReference(event)}>
          <label className="text-xs font-semibold text-muted-foreground">Reference type<select className="input-premium mt-1 h-10 w-full" value={referenceForm.referenceType} onChange={(event) => setReferenceForm((value) => ({ ...value, referenceType: event.target.value }))}>{["textbook", "journal_article", "guideline", "society_document", "website", "other", "unknown"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select></label>
          <div><FieldLabel htmlFor="reference-title">Title</FieldLabel><Input id="reference-title" required value={referenceForm.title} onChange={(event) => setReferenceForm((value) => ({ ...value, title: event.target.value }))} /></div>
          <div><FieldLabel htmlFor="reference-organization">Organization</FieldLabel><Input id="reference-organization" value={referenceForm.organization} onChange={(event) => setReferenceForm((value) => ({ ...value, organization: event.target.value }))} /></div>
          <div><FieldLabel htmlFor="reference-authors">Authors (comma separated)</FieldLabel><Input id="reference-authors" value={referenceForm.authors} onChange={(event) => setReferenceForm((value) => ({ ...value, authors: event.target.value }))} /></div>
          <div><FieldLabel htmlFor="reference-year">Year</FieldLabel><Input id="reference-year" type="number" min="1000" max="9999" value={referenceForm.year} onChange={(event) => setReferenceForm((value) => ({ ...value, year: event.target.value }))} /></div>
          <div className="sm:col-span-2"><FieldLabel htmlFor="reference-citation">Citation text</FieldLabel><Textarea id="reference-citation" value={referenceForm.citationText} onChange={(event) => setReferenceForm((value) => ({ ...value, citationText: event.target.value }))} /></div>
          <DialogFooter className="sm:col-span-2"><Button type="button" variant="secondary" onClick={() => setNewReferenceOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>Create reference</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>

      <Dialog open={newCaseOpen} onClose={() => setNewCaseOpen(false)}><DialogContent maxWidth="640px"><DialogHeader><div><DialogTitle>New Teaching case</DialogTitle><DialogDescription>Use de-identified educational material only. This does not connect to patient or PACS records.</DialogDescription></div></DialogHeader>
        <form className="space-y-3" onSubmit={(event) => void createCase(event)}>
          <div><FieldLabel htmlFor="case-external-id">Case external ID</FieldLabel><Input id="case-external-id" required value={caseForm.externalId} onChange={(event) => setCaseForm((value) => ({ ...value, externalId: event.target.value.toUpperCase() }))} /></div>
          <div><FieldLabel htmlFor="case-specialty">Specialty</FieldLabel><select id="case-specialty" className="input-premium h-10 w-full" value={caseForm.specialtyCode} onChange={(event) => setCaseForm((value) => ({ ...value, specialtyCode: event.target.value }))}>{catalog.data.specialties.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div>
          <div><FieldLabel htmlFor="case-title">Title</FieldLabel><Input id="case-title" value={caseForm.title} onChange={(event) => setCaseForm((value) => ({ ...value, title: event.target.value }))} /></div>
          <div><FieldLabel htmlFor="case-history">Educational case history</FieldLabel><Textarea id="case-history" value={caseForm.clinicalHistory} onChange={(event) => setCaseForm((value) => ({ ...value, clinicalHistory: event.target.value }))} rows={4} /></div>
          <DialogFooter><Button type="button" variant="secondary" onClick={() => setNewCaseOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>Create Teaching case</Button></DialogFooter>
        </form>
      </DialogContent></Dialog>
    </section>
  );
}

function AssetPreviews({ assets, failed, setFailed }: { assets: TeachingQuestionRevision["assets"]; failed: number[]; setFailed: React.Dispatch<React.SetStateAction<number[]>> }) {
  if (assets.length === 0) return null;
  return <div className="mt-3 grid gap-3 sm:grid-cols-2">{assets.map((asset) => (
    <figure key={asset.id} className="overflow-hidden rounded-xl border bg-background" style={{ borderColor: "var(--border)" }}>
      {failed.includes(asset.id) ? <div role="alert" className="grid min-h-40 place-items-center bg-muted p-4 text-center text-sm text-destructive">Image could not be loaded from Teaching storage.</div> : <a href={teachingAssetUrl(asset.id)} target="_blank" rel="noreferrer" aria-label={`Open larger image: ${asset.originalFilename}`}><img src={teachingAssetUrl(asset.id)} alt={asset.altText} loading="lazy" onError={() => setFailed((ids) => ids.includes(asset.id) ? ids : [...ids, asset.id])} className="max-h-[28rem] w-full object-contain" /></a>}
      <figcaption className="space-y-1 p-3 text-xs"><p className="break-all font-medium text-foreground">{asset.originalFilename}</p><p className="text-muted-foreground">{asset.mimeType} · {(asset.sizeBytes / 1024).toFixed(0)} KB</p><p className="text-muted-foreground">Alt text: {asset.altText || "Not provided"}</p></figcaption>
    </figure>
  ))}</div>;
}
