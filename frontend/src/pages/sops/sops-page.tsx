import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  CirclePlus,
  Download,
  Eye,
  FileClock,
  FileDown,
  FileSpreadsheet,
  Pencil,
  Printer,
  ShieldCheck,
} from "lucide-react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Textarea,
} from "@/components/shared";
import {
  archiveSop,
  createSop,
  createSopRevision,
  downloadSopJson,
  downloadSopPdf,
  downloadSopXlsx,
  fetchSop,
  fetchSopMeta,
  fetchSops,
  navigateSopPrintWindow,
  openSopPrintWindow,
  publishSopVersion,
  updateSopDraft,
  type SopDocument,
  type SopSectionDefinition,
  type SopSummary,
  type SopVersion,
  type SopXlsxConfirmResult,
  type SopJsonConfirmResult,
} from "@/lib/api/sops";
import { SopReadOnlyDocument, SopStructuredEditor } from "./sop-editor";
import { createEmptySopDocument } from "./sop-document";
import { SopXlsxImportDialog } from "./sop-xlsx-import-dialog";
import { SopJsonImportDialog } from "./sop-json-import-dialog";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import {
  proceedWithUnsavedNavigation,
  registerUnsavedNavigationGuard,
} from "@/lib/unsaved-navigation-guard";

const FALLBACK_SECTIONS: SopSectionDefinition[] = [
  { key: "purpose", title: "Purpose", required: true },
  { key: "scope", title: "Scope", required: true },
  { key: "responsibilities", title: "Responsibilities", required: true },
  { key: "definitions", title: "Definitions / Abbreviations", required: false },
  { key: "safety", title: "Safety / Precautions", required: false },
  { key: "procedure", title: "Procedure", required: true },
  { key: "documentation", title: "Documentation / Records", required: false },
  { key: "references", title: "References", required: false },
];
const FALLBACK_CATEGORIES = [
  "General",
  "CT",
  "MRI",
  "Ultrasound",
  "Mammography",
  "X-Ray",
  "Interventional Radiology",
  "Patient Safety",
  "PACS / IT",
  "Reception / Registration",
  "Administrative",
];
const isManagement = (role?: string) =>
  role === "supervisor" || role === "super_admin";
const dateLabel = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "—";
const dateTimeLabel = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const statusVariant = (status: string) =>
  status === "published"
    ? ("success" as const)
    : status === "draft"
      ? ("draft" as const)
      : status === "archived"
        ? ("legacy" as const)
        : ("neutral" as const);
const versionStatusLabel = (version: SopVersion, current: string | null) =>
  version.version === current
    ? "Current"
    : version.status === "superseded"
      ? "Superseded"
      : "Draft";

function editorNodeText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? record.text : "";
  const children = Array.isArray(record.content)
    ? record.content.map(editorNodeText).join(" ")
    : "";
  return `${ownText} ${children}`.trim();
}

function draftSignature(input: {
  title: string;
  category: string;
  version: string;
  effectiveDate: string;
  changeSummary: string;
  document: SopDocument;
}): string {
  return JSON.stringify(input);
}

function pdfActionError(value: unknown, translate: (key: "sops.pdfRendererBusy" | "sops.unableGeneratePdf") => string): string {
  const message = value instanceof Error ? value.message : "";
  return message.toLowerCase().includes("busy") ? translate("sops.pdfRendererBusy") : message || translate("sops.unableGeneratePdf");
}

function publishValidationError(input: {
  title: string;
  category: string;
  version: string;
  effectiveDate: string;
  document: SopDocument;
}): string | null {
  if (!input.title.trim()) return "Title is required before publishing.";
  if (!input.category) return "Category is required before publishing.";
  if (!input.version.trim()) return "Version is required before publishing.";
  if (!input.effectiveDate) return "Effective date is required before publishing.";
  const missing = input.document.sections.find(
    (section) => section.required && !editorNodeText(section.content).trim(),
  );
  return missing
    ? `${missing.title} must contain meaningful content before publishing.`
    : null;
}

function PageShell({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  return (
    <div
      className="mx-auto flex w-full max-w-[1400px] flex-col gap-4"
      dir={language === "ar" ? "rtl" : "ltr"}
    >
      {children}
    </div>
  );
}

function LibraryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language } = useLanguage();
  const management = isManagement(user?.role);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("published");
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const meta = useQuery({
    queryKey: ["sops", "meta"],
    queryFn: fetchSopMeta,
    staleTime: Infinity,
  });
  const list = useQuery({
    queryKey: ["sops", "list", search, category, status, management],
    queryFn: () =>
      fetchSops({
        search,
        category,
        status: management ? status : "published",
      }),
  });
  const categories = meta.data?.categories ?? FALLBACK_CATEGORIES;
  return (
    <PageShell>
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" aria-hidden="true" />
            <h1 className="text-xl font-semibold sm:text-2xl">SOP Library</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Controlled radiology procedures, safety instructions, and
            operational standards.
          </p>
        </div>
        {management ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => setJsonImportOpen(true)}><Download className="h-4 w-4" />Import SOP</Button><Button type="button" onClick={() => navigate("/sops/new")}><CirclePlus className="h-4 w-4" />New SOP</Button></div> : null}
      </header>
      <section
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
        aria-labelledby="sop-filter-heading"
      >
        <h2 id="sop-filter-heading" className="text-sm font-semibold">
          Find an SOP
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)]">
          <label className="grid gap-1 text-sm font-medium">
            Search
            <Input
              aria-label="Search SOPs"
              className="h-10"
              placeholder="Code or title"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Category
            <select
              aria-label="Category"
              className="input-premium h-10"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Status
            <select
              aria-label="Status"
              className="input-premium h-10"
              value={management ? status : "published"}
              disabled={!management}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="published">Published</option>
              {management ? (
                <>
                  <option value="">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </>
              ) : null}
            </select>
          </label>
        </div>
      </section>
      <section
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        aria-labelledby="sop-register-heading"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 id="sop-register-heading" className="font-semibold">
            Available SOPs
          </h2>
          {list.data ? (
            <Badge variant="neutral" size="sm">
              {list.data.sops.length}
            </Badge>
          ) : null}
        </div>
        {list.isLoading ? (
          <LoadingState message="Loading SOP Library…" />
        ) : list.isError ? (
          <div className="grid justify-items-center gap-2 p-6">
            <ErrorState message="Unable to load the SOP Library." />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void list.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : !list.data?.sops.length ? (
          <EmptyState
            message={
              management
                ? "No SOPs match the selected filters."
                : "No published SOPs are available."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-start text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">Code</th>
                  <th className="p-3 text-start">Title</th>
                  <th className="p-3 text-start">Category</th>
                  <th className="p-3 text-start">Version</th>
                  <th className="p-3 text-start">Status</th>
                  <th className="p-3 text-start">Effective date</th>
                  <th className="p-3 text-start">Last updated</th>
                  <th className="p-3 text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.data.sops.map((sop) => (
                  <LibraryRow
                    key={sop.id}
                    sop={sop}
                    management={management}
                    onOpen={() =>
                      navigate(
                        `/sops/${sop.id}?version=${encodeURIComponent((management ? sop.draftVersion ?? sop.currentVersion : sop.currentVersion) ?? "")}`,
                      )
                    }
                    language={language}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {management ? <SopJsonImportDialog open={jsonImportOpen} mode="create" onClose={() => setJsonImportOpen(false)} onConfirmed={(result) => { setJsonImportOpen(false); navigate(`/sops/${result.sop.id}?version=${encodeURIComponent(result.version.version)}`); }} /> : null}
    </PageShell>
  );
}

function LibraryRow({
  sop,
  management,
  onOpen,
  language,
}: {
  sop: SopSummary;
  management: boolean;
  onOpen: () => void;
  language: string;
}) {
  const version = management ? sop.draftVersion ?? sop.currentVersion : sop.currentVersion;
  return (
    <tr className="border-t border-border align-middle hover:bg-muted/20">
      <td className="p-3">
        <span
          dir="ltr"
          className="font-mono-data text-xs [unicode-bidi:isolate]"
        >
          {sop.code}
        </span>
      </td>
      <td className="max-w-[20rem] p-3 font-semibold">{sop.title}</td>
      <td className="p-3 text-muted-foreground">{sop.category}</td>
      <td className="p-3" dir="ltr">
        {version ?? "—"}
      </td>
      <td className="p-3">
        <Badge variant={statusVariant(sop.status)} size="sm">
          {sop.status}
        </Badge>
      </td>
      <td className="p-3 text-muted-foreground">
        {dateLabel(sop.currentEffectiveDate)}
      </td>
      <td className="p-3 text-muted-foreground">
        {dateTimeLabel(sop.updatedAt)}
      </td>
      <td className="p-3 text-end">
        <Button type="button" size="sm" variant="secondary" onClick={onOpen}>
          <Eye className="h-4 w-4" />
          {language === "ar" ? "فتح" : "Open"}
        </Button>
        {management && sop.status === "draft" ? (
          <span className="ms-2 inline-flex items-center text-xs text-amber-700">
            <Pencil className="me-1 h-3.5 w-3.5" />
            Edit
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function MetadataFields({
  title,
  setTitle,
  code,
  setCode,
  category,
  setCategory,
  version,
  setVersion,
  effectiveDate,
  setEffectiveDate,
  changeSummary,
  setChangeSummary,
  categories,
  codeReadOnly = false,
  titleReadOnly = false,
  categoryReadOnly = false,
}: {
  title: string;
  setTitle: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  version: string;
  setVersion: (value: string) => void;
  effectiveDate: string;
  setEffectiveDate: (value: string) => void;
  changeSummary: string;
  setChangeSummary: (value: string) => void;
  categories: string[];
  codeReadOnly?: boolean;
  titleReadOnly?: boolean;
  categoryReadOnly?: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium md:col-span-2">
        Title
        <Input
          aria-label="Title"
          value={title}
          readOnly={titleReadOnly}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        SOP Code
        <Input
          aria-label="SOP Code"
          dir="ltr"
          value={code}
          readOnly={codeReadOnly}
          onChange={(event) => setCode(event.target.value)}
          placeholder="RAD-MRI-001"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Category
        <select
          aria-label="Category"
          className="input-premium h-10"
          value={category}
          disabled={categoryReadOnly}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Version
        <Input
          aria-label="Version"
          dir="ltr"
          value={version}
          readOnly={codeReadOnly}
          onChange={(event) => setVersion(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Effective date
        <Input
          aria-label="Effective date"
          type="date"
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium md:col-span-2">
        Change summary
        <Textarea
          aria-label="Change summary"
          className="min-h-20"
          value={changeSummary}
          onChange={(event) => setChangeSummary(event.target.value)}
          placeholder="Summarize this version"
        />
      </label>
    </div>
  );
}

function EditorForm({
  existingSop,
  existingVersion,
  meta,
  onSaved,
  onCancel,
  onPublish = () => undefined,
  publishing = false,
}: {
  existingSop?: SopSummary;
  existingVersion?: SopVersion;
  meta: { categories: string[]; sections: SopSectionDefinition[] };
  onSaved: (sopId: number, version: string) => void;
  onCancel: () => void;
  onPublish?: (version: string) => Promise<void> | void;
  publishing?: boolean;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(existingSop?.title ?? "");
  const [code, setCode] = useState(existingSop?.code ?? "");
  const [category, setCategory] = useState(
    existingSop?.category ?? meta.categories[0] ?? "General",
  );
  const [version, setVersion] = useState(existingVersion?.version ?? "1.0");
  const [effectiveDate, setEffectiveDate] = useState(
    existingVersion?.effectiveDate ?? "",
  );
  const [changeSummary, setChangeSummary] = useState(
    existingVersion?.changeSummary ?? "Initial SOP version",
  );
  const [document, setDocument] = useState<SopDocument>(
    () => existingVersion?.contentJson ?? createEmptySopDocument(meta.sections),
  );
  const [savedSignature, setSavedSignature] = useState(() =>
    draftSignature({
      title: existingSop?.title ?? "",
      category: existingSop?.category ?? meta.categories[0] ?? "General",
      version: existingVersion?.version ?? "1.0",
      effectiveDate: existingVersion?.effectiveDate ?? "",
      changeSummary: existingVersion?.changeSummary ?? "Initial SOP version",
      document: existingVersion?.contentJson ?? createEmptySopDocument(meta.sections),
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const isExisting = Boolean(existingSop && existingVersion);
  const metadataReadOnly = Boolean(existingSop?.currentVersion);
  const [publishOpen, setPublishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [publishBusy, setPublishBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const { t } = useLanguage();
  const publishInFlight = useRef(false);
  const currentSignature = draftSignature({
    title,
    category,
    version,
    effectiveDate,
    changeSummary,
    document,
  });
  const dirty = currentSignature !== savedSignature;
  const requestLeave = useCallback(
    (proceed: () => void) => {
      if (!dirty) {
        proceed();
        return;
      }
      setPendingNavigation(() => proceed);
      setDiscardOpen(true);
    },
    [dirty],
  );

  useEffect(() => {
    if (!dirty) return;
    return registerUnsavedNavigationGuard(requestLeave);
  }, [dirty, requestLeave]);
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      isExisting
        ? updateSopDraft(existingSop!.id, version, {
            title,
            category,
            effectiveDate,
            changeSummary,
            contentJson: document,
          })
        : createSop({
            title,
            code,
            category,
            version,
            effectiveDate,
            changeSummary,
            contentJson: document,
          }),
    onSuccess: async (result) => {
      setError(null);
      setSavedSignature(currentSignature);
      await queryClient.invalidateQueries({ queryKey: ["sops"] });
      onSaved(result.sop.id, result.version.version);
    },
    onError: (value) =>
      setError(
        value instanceof Error
          ? value.message
          : "Unable to save the SOP draft.",
      ),
  });
  const publishCurrentDraft = async () => {
    if (publishInFlight.current || !isExisting) return;
    const validationError = publishValidationError({
      title,
      category,
      version,
      effectiveDate,
      document,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    publishInFlight.current = true;
    setPublishBusy(true);
    setError(null);
    try {
      const saved = await save.mutateAsync();
      await onPublish(saved.version.version);
      setPublishOpen(false);
    } catch (value) {
      setError(
        value instanceof Error
          ? value.message
          : "Unable to save and publish the SOP.",
      );
    } finally {
      publishInFlight.current = false;
      setPublishBusy(false);
    }
  };
  const exportCurrentDraft = async () => {
    if (!isExisting || exportBusy || save.isPending || publishBusy || publishing) return;
    setExportBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = dirty ? await save.mutateAsync() : null;
      await downloadSopXlsx(saved?.sop.id ?? existingSop!.id, saved?.version.version ?? version);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to export the SOP workbook.");
    } finally {
      setExportBusy(false);
    }
  };
  const exportCurrentJson = async () => {
    if (!isExisting || exportBusy || save.isPending || publishBusy || publishing) return;
    setExportBusy(true); setError(null); setSuccess(null);
    try { const saved = dirty ? await save.mutateAsync() : null; await downloadSopJson(saved?.sop.id ?? existingSop!.id, saved?.version.version ?? version); }
    catch (value) { setError(value instanceof Error ? value.message : "Unable to export the SOP JSON."); }
    finally { setExportBusy(false); }
  };
  const printCurrentDraft = async () => {
    if (!isExisting || printBusy || pdfBusy || save.isPending || publishBusy || publishing) return;
    const printWindow = openSopPrintWindow();
    if (!printWindow) {
      setError(t("sops.unableOpenPrint"));
      return;
    }
    setPrintBusy(true);
    setError(null);
    try {
      const saved = dirty ? await save.mutateAsync() : null;
      navigateSopPrintWindow(printWindow, saved?.sop.id ?? existingSop!.id, saved?.version.version ?? version, () => {
        printWindow.focus();
        printWindow.print();
      });
    } catch (value) {
      printWindow.close();
      setError(value instanceof Error ? value.message : t("sops.unableOpenPrint"));
    } finally {
      setPrintBusy(false);
    }
  };
  const downloadCurrentPdf = async () => {
    if (!isExisting || printBusy || pdfBusy || save.isPending || publishBusy || publishing) return;
    setPdfBusy(true);
    setError(null);
    try {
      const saved = dirty ? await save.mutateAsync() : null;
      await downloadSopPdf(saved?.sop.id ?? existingSop!.id, saved?.version.version ?? version);
    } catch (value) {
      setError(pdfActionError(value, t));
    } finally {
      setPdfBusy(false);
    }
  };
  const handleImported = async (result: SopXlsxConfirmResult | SopJsonConfirmResult) => {
    setTitle(result.sop.title);
    setCode(result.sop.code);
    setCategory(result.sop.category);
    setVersion(result.version.version);
    setEffectiveDate(result.version.effectiveDate ?? "");
    setChangeSummary(result.version.changeSummary);
    setDocument(result.version.contentJson);
    setSavedSignature(draftSignature({
      title: result.sop.title,
      category: result.sop.category,
      version: result.version.version,
      effectiveDate: result.version.effectiveDate ?? "",
      changeSummary: result.version.changeSummary,
      document: result.version.contentJson,
    }));
    setImportOpen(false);
    setJsonImportOpen(false);
    setError(null);
    const importLabel = "importType" in result.summary ? "JSON changes" : "Excel changes";
    setSuccess(`${importLabel} imported into draft v${result.version.version}. ${result.summary.changedSectionKeys.length} section${result.summary.changedSectionKeys.length === 1 ? "" : "s"} changed.`);
    await queryClient.invalidateQueries({ queryKey: ["sops", "detail", result.sop.id] });
    await queryClient.invalidateQueries({ queryKey: ["sops"] });
  };
  const canSave =
    title.trim() &&
    code.trim() &&
    category &&
    version.trim() &&
    !save.isPending &&
    !publishBusy &&
    !publishing;
  return (
    <PageShell>
      <header className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-accent" aria-hidden="true" />
            <h1 className="text-xl font-semibold sm:text-2xl">
              {isExisting
                ? `Edit draft · ${existingSop!.code}`
                : "Create new SOP"}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the fixed eight-section template. Required sections cannot be
            removed.
          </p>
        </div>
        <Badge variant="draft">Draft</Badge>
      </header>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <MetadataFields
          title={title}
          setTitle={setTitle}
          code={code}
          setCode={setCode}
          category={category}
          setCategory={setCategory}
          version={version}
          setVersion={setVersion}
          effectiveDate={effectiveDate}
          setEffectiveDate={setEffectiveDate}
          changeSummary={changeSummary}
          setChangeSummary={setChangeSummary}
          categories={meta.categories}
          codeReadOnly={Boolean(existingSop)}
          titleReadOnly={metadataReadOnly}
          categoryReadOnly={metadataReadOnly}
        />
      </section>
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Structured SOP editor</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Arabic and English paragraphs can use independent direction
              controls.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            Stored as structured JSON
          </span>
        </div>
        <SopStructuredEditor value={document} editable onChange={setDocument} />
      </section>
      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-2 z-10 flex flex-wrap justify-end gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        <Button
          type="button"
          variant="secondary"
          onClick={() => requestLeave(onCancel)}
          disabled={save.isPending || publishing || publishBusy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={!canSave}
        >
          {save.isPending ? "Saving…" : "Save Draft"}
        </Button>
        {isExisting ? (
          <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void exportCurrentDraft()}
            disabled={save.isPending || exportBusy || printBusy || pdfBusy || publishBusy || publishing}
          >
              <Download className="h-4 w-4" />
              {exportBusy ? "Exporting…" : "Export Excel"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportCurrentJson()} disabled={save.isPending || exportBusy || printBusy || pdfBusy || publishBusy || publishing}><Download className="h-4 w-4" />{exportBusy ? "Exporting…" : "Export JSON"}</Button>
            <Button type="button" variant="secondary" onClick={() => void printCurrentDraft()} disabled={save.isPending || exportBusy || printBusy || pdfBusy || publishBusy || publishing}>
              <Printer className="h-4 w-4" />
              {printBusy ? t("sops.preparingPrint") : t("sops.print")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void downloadCurrentPdf()} disabled={save.isPending || exportBusy || printBusy || pdfBusy || publishBusy || publishing}>
              <FileDown className="h-4 w-4" />
              {pdfBusy ? t("sops.preparingPdf") : t("sops.downloadPdf")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => { setError(null); setSuccess(null); setImportOpen(true); }}
              disabled={dirty || save.isPending || exportBusy || publishBusy || publishing}
              title={dirty ? "Save the current RISpro draft before importing Excel." : undefined}
            >
              <FileSpreadsheet className="h-4 w-4" />
              Import Excel
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setError(null); setSuccess(null); setJsonImportOpen(true); }} disabled={dirty || save.isPending || exportBusy || publishBusy || publishing} title={dirty ? "Save the current RISpro draft before importing JSON." : undefined}><Download className="h-4 w-4" />Import JSON</Button>
          </>
        ) : null}
        {isExisting ? (
          <Button
            type="button"
            onClick={() => {
              setError(null);
              setPublishOpen(true);
            }}
            disabled={save.isPending || publishing || publishBusy}
          >
            {publishing ? "Publishing…" : "Publish SOP"}
          </Button>
        ) : null}
      </div>
      {isExisting && dirty ? <p className="text-end text-xs text-amber-700">Save the current RISpro draft before importing Excel.</p> : null}
      {success ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p> : null}
      {isExisting ? <SopXlsxImportDialog open={importOpen} sopId={existingSop!.id} version={version} sopCode={existingSop!.code} onClose={() => setImportOpen(false)} onConfirmed={(result) => void handleImported(result)} /> : null}
      {isExisting ? <SopJsonImportDialog open={jsonImportOpen} mode="draft_update" sopId={existingSop!.id} version={version} onClose={() => setJsonImportOpen(false)} onConfirmed={(result) => void handleImported(result)} /> : null}
      <Dialog
        open={publishOpen}
        onClose={() => {
          if (!publishing && !publishBusy && !save.isPending) setPublishOpen(false);
        }}
      >
        <DialogContent maxWidth="520px">
          <DialogHeader>
            <DialogTitle>
              Publish {title || "this SOP"} v{version}?
            </DialogTitle>
            <DialogDescription>
              This version will become the active SOP. Published versions cannot
              be edited directly.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPublishOpen(false)}
              disabled={publishing || publishBusy || save.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void publishCurrentDraft()}
              disabled={publishing || publishBusy || save.isPending}
            >
              {publishing ? "Publishing…" : "Publish SOP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={discardOpen}
        onClose={() => {
          if (!publishBusy && !save.isPending) setDiscardOpen(false);
        }}
      >
        <DialogContent maxWidth="460px">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>SOP edits have not been saved.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Keep editing or discard the changes made in this SOP editor.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDiscardOpen(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const proceed = pendingNavigation;
                setPendingNavigation(null);
                setDiscardOpen(false);
                if (proceed) proceedWithUnsavedNavigation(proceed);
              }}
            >
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function VersionHistory({
  versions,
  currentVersion,
  onOpen,
}: {
  versions: SopVersion[];
  currentVersion: string | null;
  onOpen: (version: string) => void;
}) {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      aria-labelledby="sop-history-heading"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FileClock className="h-4 w-4 text-accent" />
        <h2 id="sop-history-heading" className="font-semibold">
          Version history
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-start">Version</th>
              <th className="p-3 text-start">Published / effective</th>
              <th className="p-3 text-start">Change summary</th>
              <th className="p-3 text-start">Author / publisher</th>
              <th className="p-3 text-start">Status</th>
              <th className="p-3 text-end">View</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-t border-border">
                <td className="p-3 font-mono-data" dir="ltr">
                  {version.version}
                </td>
                <td className="p-3 text-muted-foreground">
                  {dateLabel(version.effectiveDate ?? version.publishedAt)}
                </td>
                <td className="max-w-[22rem] p-3">
                  {version.changeSummary || "—"}
                </td>
                <td className="p-3">
                  {version.publishedByName ??
                    version.createdByName ??
                    version.createdByUsername ??
                    "—"}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {dateTimeLabel(version.publishedAt ?? version.createdAt)}
                  </span>
                </td>
                <td className="p-3">
                  <Badge
                    variant={
                      versionStatusLabel(version, currentVersion) === "Current"
                        ? "success"
                        : version.status === "draft"
                          ? "draft"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {versionStatusLabel(version, currentVersion)}
                  </Badge>
                </td>
                <td className="p-3 text-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpen(version.version)}
                  >
                    <Eye className="h-4 w-4" />
                    Open
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetailPage({ id }: { id: number }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const management = isManagement(user?.role);
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["sops", "detail", id],
    queryFn: () => fetchSop(id),
  });
  const data = detail.data;
  const selectedVersionId = searchParams.get("version");
  const selectedVersion = useMemo(
    () =>
      data?.versions.find((version) => version.version === selectedVersionId) ??
        (management
          ? data?.versions.find(
              (version) => version.version === data.sop.draftVersion,
            )
          : undefined) ??
      data?.versions.find(
        (version) => version.version === data.sop.currentVersion,
      ) ??
      data?.versions[0],
    [data, management, selectedVersionId],
  );
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionVersion, setRevisionVersion] = useState("1.1");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { t } = useLanguage();
  // The detail query arrives asynchronously; seed the next revision field when it does.
  useEffect(() => {
    if (!data) return;
    const numbers = data.versions
      .map((version) => Number(version.version))
      .filter(Number.isFinite);
    const next = (Math.max(...numbers, 1) + 0.1).toFixed(1);
    // This state mirrors asynchronously loaded version data for the revision dialog.
    setRevisionVersion(next);
  }, [data]);
  const revision = useMutation({
    mutationFn: () =>
      createSopRevision(id, {
        version: revisionVersion,
        changeSummary: revisionSummary,
        effectiveDate: revisionDate || undefined,
      }),
    onSuccess: async (result) => {
      setRevisionOpen(false);
      setRevisionSummary("");
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["sops"] });
      setSearchParams({ version: result.version.version });
    },
    onError: (value) =>
      setActionError(
        value instanceof Error
          ? value.message
          : "Unable to create the revision.",
      ),
  });
  const publish = useMutation({
    mutationFn: (version: string) => publishSopVersion(id, version),
    onSuccess: async () => {
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["sops"] });
      await detail.refetch();
    },
    onError: (value) =>
      setActionError(
        value instanceof Error ? value.message : "Unable to publish the SOP.",
      ),
  });
  const archive = useMutation({
    mutationFn: () => archiveSop(id),
    onSuccess: async () => {
      setArchiveOpen(false);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["sops"] });
      navigate("/sops");
    },
    onError: (value) =>
      setActionError(
        value instanceof Error ? value.message : "Unable to archive the SOP.",
      ),
  });
  const exportSelectedVersion = async () => {
    if (!selectedVersion || exportBusy) return;
    setExportBusy(true);
    setActionError(null);
    try {
      await downloadSopXlsx(id, selectedVersion.version);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : "Unable to export the SOP workbook.");
    } finally {
      setExportBusy(false);
    }
  };
  const exportSelectedVersionJson = async () => {
    if (!selectedVersion || exportBusy) return;
    setExportBusy(true);
    setActionError(null);
    try {
      await downloadSopJson(id, selectedVersion.version);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : "Unable to export the SOP JSON.");
    } finally {
      setExportBusy(false);
    }
  };
  const printSelectedVersion = () => {
    if (!selectedVersion || printBusy || pdfBusy) return;
    const printWindow = openSopPrintWindow();
    if (!printWindow) {
      setActionError(t("sops.unableOpenPrint"));
      return;
    }
    setPrintBusy(true);
    setActionError(null);
    try {
      navigateSopPrintWindow(printWindow, id, selectedVersion.version, () => {
        printWindow.focus();
        printWindow.print();
      });
    } catch (value) {
      printWindow.close();
      setActionError(value instanceof Error ? value.message : t("sops.unableOpenPrint"));
    } finally {
      setPrintBusy(false);
    }
  };
  const downloadSelectedPdf = async () => {
    if (!selectedVersion || printBusy || pdfBusy) return;
    setPdfBusy(true);
    setActionError(null);
    try {
      await downloadSopPdf(id, selectedVersion.version);
    } catch (value) {
      setActionError(pdfActionError(value, t));
    } finally {
      setPdfBusy(false);
    }
  };
  if (detail.isLoading)
    return (
      <PageShell>
        <LoadingState message="Loading SOP…" />
      </PageShell>
    );
  if (detail.isError || !data || !selectedVersion)
    return (
      <PageShell>
        <ErrorState message="Unable to load this SOP." />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void detail.refetch()}
        >
          Retry
        </Button>
      </PageShell>
    );
  const editing =
    management &&
    selectedVersion.status === "draft" &&
    data.sop.status !== "archived";
  const meta = { categories: FALLBACK_CATEGORIES, sections: FALLBACK_SECTIONS };
  return editing ? (
    <EditorForm
      existingSop={data.sop}
      existingVersion={selectedVersion}
      meta={meta}
      onSaved={(sopId, version) => {
        setSearchParams({ version });
        void queryClient.invalidateQueries({
          queryKey: ["sops", "detail", sopId],
        });
      }}
      onPublish={(version) => publish.mutateAsync(version).then(() => undefined)}
      publishing={publish.isPending}
      onCancel={() =>
        navigate(
          data.sop.currentVersion
            ? `/sops/${id}?version=${encodeURIComponent(data.sop.currentVersion)}`
            : "/sops",
        )
      }
    />
  ) : (
    <PageShell>
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
            <h1 className="text-xl font-semibold sm:text-2xl">
              {data.sop.title}
            </h1>
            <Badge variant={statusVariant(data.sop.status)}>
              {data.sop.status}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span dir="ltr" className="font-mono-data">
              {data.sop.code}
            </span>
            <span>{data.sop.category}</span>
            <span dir="ltr">Version {selectedVersion.version}</span>
            <span>Effective {dateLabel(selectedVersion.effectiveDate)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={printSelectedVersion} disabled={printBusy || pdfBusy}>
            <Printer className="h-4 w-4" />
            {printBusy ? t("sops.preparingPrint") : t("sops.print")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void downloadSelectedPdf()} disabled={printBusy || pdfBusy}>
            <FileDown className="h-4 w-4" />
            {pdfBusy ? t("sops.preparingPdf") : t("sops.downloadPdf")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void exportSelectedVersion()} disabled={exportBusy}>
            <Download className="h-4 w-4" />
            {exportBusy ? "Exporting…" : "Export Excel"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void exportSelectedVersionJson()} disabled={exportBusy}>
            <Download className="h-4 w-4" />
            {exportBusy ? "Exporting…" : "Export JSON"}
          </Button>
          {management && data.sop.status === "published" ? (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setRevisionOpen(true)}
              >
                <Pencil className="h-4 w-4" />
                Create New Revision
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => setArchiveOpen(true)}
              >
                <Archive className="h-4 w-4" />
                Archive SOP
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/sops")}
          >
            Back to Library
          </Button>
        </div>
      </header>
      {management && data.sop.status === "published" && !data.sop.draftVersion ? <p className="text-sm text-muted-foreground">Create a new revision before importing Excel changes.</p> : null}
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">
              {selectedVersion.status === "superseded"
                ? "Read-only historical version"
                : "Published SOP"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Published {dateTimeLabel(selectedVersion.publishedAt)} by{" "}
              {selectedVersion.publishedByName ?? "—"}
            </p>
          </div>
          <Badge
            variant={
              selectedVersion.status === "published" ? "success" : "neutral"
            }
          >
            {versionStatusLabel(selectedVersion, data.sop.currentVersion)}
          </Badge>
        </div>
        <SopReadOnlyDocument value={selectedVersion.contentJson} />
      </Card>
      <VersionHistory
        versions={data.versions}
        currentVersion={data.sop.currentVersion}
        onOpen={(version) => setSearchParams({ version })}
      />
      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {actionError}
        </p>
      ) : null}
      <Dialog
        open={revisionOpen}
        onClose={() => {
          if (!revision.isPending) setRevisionOpen(false);
        }}
      >
        <DialogContent maxWidth="520px">
          <DialogHeader>
            <DialogTitle>Create a new SOP revision</DialogTitle>
            <DialogDescription>
              The current published version stays unchanged until the new draft
              is published.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium">
              New version
              <Input
                aria-label="New version"
                dir="ltr"
                value={revisionVersion}
                onChange={(event) => setRevisionVersion(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Effective date
              <Input
                aria-label="Effective date"
                type="date"
                value={revisionDate}
                onChange={(event) => setRevisionDate(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              Change summary
              <Textarea
                aria-label="Change summary"
                className="min-h-24"
                value={revisionSummary}
                onChange={(event) => setRevisionSummary(event.target.value)}
              />
            </label>
            {revision.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {revision.error instanceof Error
                  ? revision.error.message
                  : "Unable to create the revision."}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRevisionOpen(false)}
              disabled={revision.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => revision.mutate()}
              disabled={
                !revisionVersion.trim() ||
                !revisionSummary.trim() ||
                revision.isPending
              }
            >
              {revision.isPending ? "Creating…" : "Create draft revision"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={archiveOpen}
        onClose={() => {
          if (!archive.isPending) setArchiveOpen(false);
        }}
      >
        <DialogContent maxWidth="520px">
          <DialogHeader>
            <DialogTitle>Archive this SOP? </DialogTitle>
            <DialogDescription>
              All published versions will be preserved. The SOP will leave the
              active library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setArchiveOpen(false)}
              disabled={archive.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
            >
              {archive.isPending ? "Archiving…" : "Archive SOP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function NewSopPage() {
  const navigate = useNavigate();
  const meta = useQuery({
    queryKey: ["sops", "meta"],
    queryFn: fetchSopMeta,
    staleTime: Infinity,
  });
  const categories = meta.data?.categories ?? FALLBACK_CATEGORIES;
  const sections = meta.data?.sections ?? FALLBACK_SECTIONS;
  return (
    <EditorForm
      meta={{ categories, sections }}
      onSaved={(id, version) =>
        navigate(`/sops/${id}?version=${encodeURIComponent(version)}`)
      }
      onCancel={() => navigate("/sops")}
    />
  );
}

export default function SopsPage() {
  const { id } = useParams();
  const location = useLocation();
  if (location.pathname.endsWith("/new")) return <NewSopPage />;
  if (id) return <DetailPage id={Number(id)} />;
  return <LibraryPage />;
}
