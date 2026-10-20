import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  CirclePlus,
  Download,
  Eye,
  FileClock,
  FileDown,
  FileSpreadsheet,
  Pencil,
  Printer,
  ShieldCheck,
  UserCheck,
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
  downloadSopJsonExample,
  downloadSopPdf,
  downloadSopXlsx,
  fetchSop,
  fetchSopMeta,
  fetchSops,
  navigateSopPrintWindow,
  openSopPrintWindow,
  publishSopVersion,
  reviewSopNoChanges,
  updateSopDraft,
  updateSopOwner,
  type SopDocument,
  type SopSectionDefinition,
  type SopSummary,
  type SopUserOption,
  type SopVersion,
  type SopXlsxConfirmResult,
  type SopJsonConfirmResult,
} from "@/lib/api/sops";
import { SopReadOnlyDocument, SopStructuredEditor } from "./sop-editor";
import { localizeSopSectionTitle } from "./sop-section-utils";
import { createEmptySopDocument } from "./sop-document";
import { SopXlsxImportDialog } from "./sop-xlsx-import-dialog";
import { SopJsonImportDialog } from "./sop-json-import-dialog";
import SopJsonExamplePage from "./sop-json-example-page";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { t as translate, type Language, type TranslationKey } from "@/lib/i18n";
import {
  proceedWithUnsavedNavigation,
  registerUnsavedNavigationGuard,
} from "@/lib/unsaved-navigation-guard";
import { todayIsoDateLy } from "@/lib/date-format";

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
const FALLBACK_CATEGORY_KEYS: Partial<Record<string, TranslationKey>> = {
  General: "sops.category.general",
  Ultrasound: "sops.category.ultrasound",
  Mammography: "sops.category.mammography",
  "X-Ray": "sops.category.xray",
  "Interventional Radiology": "sops.category.interventionalRadiology",
  "Patient Safety": "sops.category.patientSafety",
  "PACS / IT": "sops.category.pacsIt",
  "Reception / Registration": "sops.category.receptionRegistration",
  Administrative: "sops.category.administrative",
};
const isManagement = (role?: string) =>
  role === "supervisor" || role === "super_admin";
function parseIsoDateOnly(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function daysBetweenDates(fromIso: string, toIso: string): number | null {
  const fromParts = parseIsoDateOnly(fromIso);
  const toParts = parseIsoDateOnly(toIso);
  if (!fromParts || !toParts) return null;
  const fromUtc = Date.UTC(fromParts[0], fromParts[1] - 1, fromParts[2]);
  const toUtc = Date.UTC(toParts[0], toParts[1] - 1, toParts[2]);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000));
}

type ReviewStatusKind = "normal" | "due_soon" | "overdue" | "missing";

function getReviewStatus(
  nextReviewDate: string | null | undefined,
  todayIso = todayIsoDateLy(),
): ReviewStatusKind {
  if (!nextReviewDate) return "missing";
  const diffDays = daysBetweenDates(todayIso, nextReviewDate);
  if (diffDays === null) return "missing";
  if (diffDays < 0) return "overdue";
  if (diffDays <= 90) return "due_soon";
  return "normal";
}

function suggestNextMinorVersion(currentVersion: string | null | undefined): string {
  if (!currentVersion || !/^\d+\.\d+$/.test(currentVersion.trim())) return "1.1";
  const [majorStr, minorStr] = currentVersion.trim().split(".");
  const major = parseInt(majorStr!, 10);
  const minor = parseInt(minorStr!, 10);
  if (Number.isNaN(major) || Number.isNaN(minor)) return "1.1";
  return `${major}.${minor + 1}`;
}

const dateLabel = (value: string | null | undefined, language: Language = "en") => {
  if (!value) return "—";
  const parts = parseIsoDateOnly(value);
  if (parts) {
    const utcDate = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    return new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-LY", { dateStyle: "medium", timeZone: "UTC", calendar: "gregory" }).format(utcDate);
  }
  return value;
};
const dateTimeLabel = (value: string | null | undefined, language: Language = "en") =>
  value
    ? new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-LY", {
        dateStyle: "medium",
        timeStyle: "short",
        calendar: "gregory",
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
const versionStatusLabel = (
  version: SopVersion,
  current: string | null,
  t: (key: TranslationKey) => string,
) =>
  version.version === current
    ? t("sops.versionStatus.current")
    : version.status === "superseded"
      ? t("sops.versionStatus.superseded")
      : t("sops.status.draft");

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
  nextReviewDate?: string | null;
  ownerUserId?: number | null;
  changeSummary: string;
  document: SopDocument;
}): string {
  return JSON.stringify({
    title: input.title.trim(),
    category: input.category.trim(),
    version: input.version.trim(),
    effectiveDate: input.effectiveDate.trim(),
    nextReviewDate: (input.nextReviewDate ?? "").trim(),
    ownerUserId: input.ownerUserId ?? null,
    changeSummary: input.changeSummary.trim(),
    document: input.document,
  });
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
  ownerUserId: number | null;
  document: SopDocument;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}): string | null {
  if (!input.title.trim()) return input.t("sops.editor.validation.titleRequired");
  if (!input.category) return input.t("sops.editor.validation.categoryRequired");
  if (!input.version.trim()) return input.t("sops.editor.validation.versionRequired");
  if (!input.ownerUserId) return input.t("sops.editor.validation.ownerRequired");
  if (!input.effectiveDate) return input.t("sops.editor.validation.effectiveDateRequired");
  const missing = input.document.sections.find(
    (section) => section.required && !editorNodeText(section.content).trim(),
  );
  if (!missing) return null;
  return input.t("sops.editor.validation.sectionRequired", {
    section: localizeSopSectionTitle(missing.key, missing.title, input.t),
  });
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
  const t = (key: TranslationKey) => translate(language, key);
  const management = isManagement(user?.role);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("published");
  const [reviewStatusFilter, setReviewStatusFilter] = useState<"all" | "due_soon" | "overdue">("all");
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonExampleBusy, setJsonExampleBusy] = useState(false);
  const [jsonExampleError, setJsonExampleError] = useState<string | null>(null);
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
  const displayedSops = useMemo(() => {
    let items = list.data?.sops ?? [];
    if (management && reviewStatusFilter !== "all") {
      items = items.filter((sop) => {
        if (sop.status !== "published") return false;
        return getReviewStatus(sop.currentNextReviewDate) === reviewStatusFilter;
      });
    }
    return items;
  }, [list.data?.sops, management, reviewStatusFilter]);
  const categories = meta.data?.categories ?? FALLBACK_CATEGORIES;
  const downloadJsonExample = async () => {
    setJsonExampleBusy(true);
    setJsonExampleError(null);
    try { await downloadSopJsonExample(); }
    catch (value) { setJsonExampleError(value instanceof Error ? value.message : t("sops.library.downloadExampleError")); }
    finally { setJsonExampleBusy(false); }
  };
  return (
    <PageShell>
      <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-accent" aria-hidden="true" />
            <h1 className="text-xl font-semibold sm:text-2xl">{t("sops.library.title")}</h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            {t("sops.library.description")}
          </p>
        </div>
        {management ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" onClick={() => setJsonImportOpen(true)}><Download className="h-4 w-4" />{t("sops.library.import")}</Button><Button type="button" variant="secondary" onClick={() => void downloadJsonExample()} disabled={jsonExampleBusy}><Download className="h-4 w-4" />{jsonExampleBusy ? t("sops.library.downloading") : t("sops.library.downloadExample")}</Button><Button type="button" variant="secondary" onClick={() => navigate("/sops/json-example")}><Pencil className="h-4 w-4" />{t("sops.library.editExample")}</Button><Button type="button" onClick={() => navigate("/sops/new")}><CirclePlus className="h-4 w-4" />{t("sops.library.new")}</Button></div> : null}
      </header>
      {jsonExampleError ? <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">{jsonExampleError}</div> : null}
      <section
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
        aria-labelledby="sop-filter-heading"
      >
        <h2 id="sop-filter-heading" className="text-sm font-semibold">
          {t("sops.library.find")}
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm font-medium">
            {t("common.search")}
            <Input
              aria-label={t("sops.library.searchLabel")}
              className="h-10"
              placeholder={t("sops.library.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t("sops.library.category")}
            <select
              aria-label={t("sops.library.category")}
              className="input-premium h-10"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">{t("sops.library.allCategories")}</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {FALLBACK_CATEGORY_KEYS[item] ? t(FALLBACK_CATEGORY_KEYS[item]!) : item}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t("sops.library.status")}
            <select
              aria-label={t("sops.library.status")}
              className="input-premium h-10"
              value={management ? status : "published"}
              disabled={!management}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="published">{t("sops.status.published")}</option>
              {management ? (
                <>
                  <option value="">{t("sops.library.allStatuses")}</option>
                  <option value="draft">{t("sops.status.draft")}</option>
                  <option value="archived">{t("sops.status.archived")}</option>
                </>
              ) : null}
            </select>
          </label>
          {management ? (
            <label className="grid gap-1 text-sm font-medium">
              {t("sops.library.reviewStatus")}
              <select
                aria-label={t("sops.library.reviewStatus")}
                className="input-premium h-10"
                value={reviewStatusFilter}
                onChange={(event) =>
                  setReviewStatusFilter(
                    event.target.value as "all" | "due_soon" | "overdue",
                  )
                }
              >
                <option value="all">{t("sops.library.allReviewStatuses")}</option>
                <option value="due_soon">{t("sops.library.dueSoon")}</option>
                <option value="overdue">{t("sops.library.overdue")}</option>
              </select>
            </label>
          ) : null}
        </div>
      </section>
      <section
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
        aria-labelledby="sop-register-heading"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <h2 id="sop-register-heading" className="font-semibold">
            {t("sops.library.available")}
          </h2>
          {list.data ? (
            <Badge variant="neutral" size="sm">
              {displayedSops.length}
            </Badge>
          ) : null}
        </div>
        {list.isLoading ? (
          <LoadingState message={t("sops.library.loading")} />
        ) : list.isError ? (
          <div className="grid justify-items-center gap-2 p-6">
            <ErrorState message={t("sops.library.loadError")} />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void list.refetch()}
            >
              {t("common.tryAgain")}
            </Button>
          </div>
        ) : !displayedSops.length ? (
          <EmptyState
            message={
              management
                ? t("sops.library.noMatches")
                : t("sops.library.nonePublished")
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[840px] text-start text-sm">
              <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{t("sops.library.code")}</th>
                  <th className="p-3 text-start">{t("sops.library.documentTitle")}</th>
                  <th className="p-3 text-start">{t("sops.library.category")}</th>
                  {management ? <th className="p-3 text-start">{t("sops.library.owner")}</th> : null}
                  <th className="p-3 text-start">{t("sops.library.version")}</th>
                  <th className="p-3 text-start">{t("sops.library.status")}</th>
                  <th className="p-3 text-start">{t("sops.library.effectiveDate")}</th>
                  {management ? (
                    <th className="p-3 text-start">{t("sops.library.reviewDue")}</th>
                  ) : (
                    <th className="p-3 text-start">{t("sops.library.lastUpdated")}</th>
                  )}
                  <th className="p-3 text-end">{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {displayedSops.map((sop) => (
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
  language: Language;
}) {
  const t = (key: TranslationKey) => translate(language, key);
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
      {management ? (
        <td className="p-3 text-muted-foreground">{sop.ownerName ?? "—"}</td>
      ) : null}
      <td className="p-3" dir="ltr">
        {version ?? "—"}
      </td>
      <td className="p-3">
        <Badge variant={statusVariant(sop.status)} size="sm">
          {t(`sops.status.${sop.status}` as TranslationKey)}
        </Badge>
      </td>
      <td className="p-3 text-muted-foreground">
        {dateLabel(sop.currentEffectiveDate, language)}
      </td>
      {management ? (
        <td className="p-3">
          {sop.status === "published" && sop.currentNextReviewDate ? (
            (() => {
              const revStatus = getReviewStatus(sop.currentNextReviewDate);
              if (revStatus === "overdue") {
                return (
                  <div className="flex flex-col gap-1 items-start">
                    <span className="text-sm font-medium text-red-600 dark:text-red-400">
                      {dateLabel(sop.currentNextReviewDate, language)}
                    </span>
                    <Badge variant="error" size="sm">
                      {t("sops.library.overdue")}
                    </Badge>
                  </div>
                );
              }
              if (revStatus === "due_soon") {
                return (
                  <div className="flex flex-col gap-1 items-start">
                    <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                      {dateLabel(sop.currentNextReviewDate, language)}
                    </span>
                    <Badge variant="warning" size="sm">
                      {t("sops.library.dueSoon")}
                    </Badge>
                  </div>
                );
              }
              return (
                <span className="text-muted-foreground">
                  {dateLabel(sop.currentNextReviewDate, language)}
                </span>
              );
            })()
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
      ) : (
        <td className="p-3 text-muted-foreground">
          {dateTimeLabel(sop.updatedAt, language)}
        </td>
      )}
      <td className="p-3 text-end">
        <Button type="button" size="sm" variant="secondary" onClick={onOpen}>
          <Eye className="h-4 w-4" />
          {t("sops.library.open")}
        </Button>
        {management && sop.status === "draft" ? (
          <span className="ms-2 inline-flex items-center text-xs text-amber-700">
            <Pencil className="me-1 h-3.5 w-3.5" />
            {t("sops.library.edit")}
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
  nextReviewDate,
  setNextReviewDate,
  ownerUserId,
  setOwnerUserId,
  users,
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
  nextReviewDate: string;
  setNextReviewDate: (value: string) => void;
  ownerUserId: number | null;
  setOwnerUserId: (value: number | null) => void;
  users?: SopUserOption[];
  changeSummary: string;
  setChangeSummary: (value: string) => void;
  categories: string[];
  codeReadOnly?: boolean;
  titleReadOnly?: boolean;
  categoryReadOnly?: boolean;
}) {
  const { language } = useLanguage();
  const t = (key: TranslationKey) => translate(language, key);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium md:col-span-2">
        {t("sops.editor.titleField")}
        <Input
          aria-label={t("sops.editor.titleField")}
          value={title}
          readOnly={titleReadOnly}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t("sops.editor.codeField")}
        <Input
          aria-label={t("sops.editor.codeField")}
          dir="ltr"
          value={code}
          readOnly={codeReadOnly}
          onChange={(event) => setCode(event.target.value)}
          placeholder="RAD-MRI-001"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t("sops.library.category")}
        <select
          aria-label={t("sops.library.category")}
          className="input-premium h-10"
          value={category}
          disabled={categoryReadOnly}
          onChange={(event) => setCategory(event.target.value)}
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {FALLBACK_CATEGORY_KEYS[item] ? t(FALLBACK_CATEGORY_KEYS[item]!) : item}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t("sops.editor.ownerField")}
        <select
          aria-label={t("sops.editor.ownerField")}
          className="input-premium h-10"
          value={ownerUserId ?? ""}
          onChange={(event) =>
            setOwnerUserId(event.target.value ? Number(event.target.value) : null)
          }
        >
          <option value="">{t("sops.editor.selectOwner")}</option>
          {users?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t("sops.editor.versionField")}
        <Input
          aria-label={t("sops.editor.versionField")}
          dir="ltr"
          value={version}
          readOnly={codeReadOnly}
          onChange={(event) => setVersion(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t("sops.editor.effectiveDate")}
        <Input
          aria-label={t("sops.editor.effectiveDate")}
          type="date"
          value={effectiveDate}
          onChange={(event) => setEffectiveDate(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t("sops.editor.nextReviewDate")}
        <Input
          aria-label={t("sops.editor.nextReviewDate")}
          type="date"
          value={nextReviewDate}
          onChange={(event) => setNextReviewDate(event.target.value)}
        />
      </label>
      <label className="grid gap-1 text-sm font-medium md:col-span-2">
        {t("sops.editor.changeSummary")}
        <Textarea
          aria-label={t("sops.editor.changeSummary")}
          className="min-h-20"
          value={changeSummary}
          onChange={(event) => setChangeSummary(event.target.value)}
          placeholder={t("sops.editor.changeSummaryPlaceholder")}
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
  meta: { categories: string[]; sections: SopSectionDefinition[]; users?: SopUserOption[] };
  onSaved: (sopId: number, version: string) => void;
  onCancel: () => void;
  onPublish?: (version: string) => Promise<void> | void;
  publishing?: boolean;
}) {
  const queryClient = useQueryClient();
  const { t } = useLanguage();
  const [title, setTitle] = useState(existingSop?.title ?? "");
  const [code, setCode] = useState(existingSop?.code ?? "");
  const [category, setCategory] = useState(
    existingSop?.category ?? meta.categories[0] ?? "General",
  );
  const [ownerUserId, setOwnerUserId] = useState<number | null>(existingSop?.ownerUserId ?? null);
  const [version, setVersion] = useState(existingVersion?.version ?? "1.0");
  const [effectiveDate, setEffectiveDate] = useState(
    existingVersion?.effectiveDate ?? "",
  );
  const [nextReviewDate, setNextReviewDate] = useState(
    existingVersion?.nextReviewDate ?? "",
  );
  const [changeSummary, setChangeSummary] = useState(
    existingVersion?.changeSummary ?? t("sops.editor.initialSummary"),
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
      nextReviewDate: existingVersion?.nextReviewDate ?? "",
      ownerUserId: existingSop?.ownerUserId ?? null,
      changeSummary: existingVersion?.changeSummary ?? t("sops.editor.initialSummary"),
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
  const publishInFlight = useRef(false);
  const currentSignature = draftSignature({
    title,
    category,
    version,
    effectiveDate,
    nextReviewDate,
    ownerUserId,
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
            nextReviewDate: nextReviewDate || null,
            ownerUserId,
            changeSummary,
            contentJson: document,
          })
        : createSop({
            title,
            code,
            category,
            version,
            effectiveDate,
            nextReviewDate: nextReviewDate || null,
            ownerUserId,
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
              : t("sops.editor.saveError"),
          ),
  });
  const publishCurrentDraft = async () => {
    if (publishInFlight.current || !isExisting) return;
    const validationError = publishValidationError({
      title,
      category,
      version,
      effectiveDate,
      ownerUserId,
      document,
      t,
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
          : t("sops.editor.publishError"),
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
      setError(value instanceof Error ? value.message : t("sops.editor.exportExcelError"));
    } finally {
      setExportBusy(false);
    }
  };
  const exportCurrentJson = async () => {
    if (!isExisting || exportBusy || save.isPending || publishBusy || publishing) return;
    setExportBusy(true); setError(null); setSuccess(null);
    try { const saved = dirty ? await save.mutateAsync() : null; await downloadSopJson(saved?.sop.id ?? existingSop!.id, saved?.version.version ?? version); }
    catch (value) { setError(value instanceof Error ? value.message : t("sops.editor.exportJsonError")); }
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
    setNextReviewDate(result.version.nextReviewDate ?? "");
    setOwnerUserId(result.sop.ownerUserId ?? null);
    setChangeSummary(result.version.changeSummary);
    setDocument(result.version.contentJson);
    setSavedSignature(draftSignature({
      title: result.sop.title,
      category: result.sop.category,
      version: result.version.version,
      effectiveDate: result.version.effectiveDate ?? "",
      nextReviewDate: result.version.nextReviewDate ?? "",
      ownerUserId: result.sop.ownerUserId ?? null,
      changeSummary: result.version.changeSummary,
      document: result.version.contentJson,
    }));
    setImportOpen(false);
    setJsonImportOpen(false);
    setError(null);
    const importLabel = "importType" in result.summary ? t("sops.editor.jsonChanges") : t("sops.editor.excelChanges");
    setSuccess(t("sops.editor.importSuccess", { source: importLabel, version: result.version.version, count: result.summary.changedSectionKeys.length }));
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
                ? t("sops.editor.editDraft", { code: existingSop!.code })
                : t("sops.editor.createNew")}
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("sops.editor.templateHint")}
          </p>
        </div>
        <Badge variant="draft">{t("sops.status.draft")}</Badge>
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
          nextReviewDate={nextReviewDate}
          setNextReviewDate={setNextReviewDate}
          ownerUserId={ownerUserId}
          setOwnerUserId={setOwnerUserId}
          users={meta.users}
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
            <h2 className="font-semibold">{t("sops.editor.structuredTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("sops.editor.directionHint")}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {t("sops.editor.structuredJson")}
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
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          disabled={!canSave}
        >
          {save.isPending ? t("sops.editor.saving") : t("sops.editor.saveDraft")}
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
              {exportBusy ? t("sops.editor.exporting") : t("sops.editor.exportExcel")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => void exportCurrentJson()} disabled={save.isPending || exportBusy || printBusy || pdfBusy || publishBusy || publishing}><Download className="h-4 w-4" />{exportBusy ? t("sops.editor.exporting") : t("sops.editor.exportJson")}</Button>
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
              title={dirty ? t("sops.editor.saveBeforeImportExcel") : undefined}
            >
              <FileSpreadsheet className="h-4 w-4" />
              {t("sops.editor.importExcel")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => { setError(null); setSuccess(null); setJsonImportOpen(true); }} disabled={dirty || save.isPending || exportBusy || publishBusy || publishing} title={dirty ? t("sops.editor.saveBeforeImportJson") : undefined}><Download className="h-4 w-4" />{t("sops.editor.importJson")}</Button>
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
            {publishing ? t("sops.editor.publishing") : t("sops.editor.publish")}
          </Button>
        ) : null}
      </div>
      {isExisting && dirty ? <p className="text-end text-xs text-amber-700">{t("sops.editor.saveBeforeImportExcel")}</p> : null}
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
              {t("sops.editor.publishConfirm", { title: title || t("sops.editor.thisSop"), version })}
            </DialogTitle>
            <DialogDescription>
              {t("sops.editor.publishDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPublishOpen(false)}
              disabled={publishing || publishBusy || save.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => void publishCurrentDraft()}
              disabled={publishing || publishBusy || save.isPending}
            >
              {publishing ? t("sops.editor.publishing") : t("sops.editor.publish")}
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
            <DialogTitle>{t("sops.editor.discardTitle")}</DialogTitle>
            <DialogDescription>{t("sops.editor.discardDescription")}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            {t("sops.editor.discardPrompt")}
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDiscardOpen(false)}
            >
              {t("sops.editor.keepEditing")}
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
              {t("sops.editor.discardChanges")}
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
  const { language, t } = useLanguage();
  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      aria-labelledby="sop-history-heading"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FileClock className="h-4 w-4 text-accent" />
        <h2 id="sop-history-heading" className="font-semibold">
          {t("sops.detail.versionHistory")}
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-muted/20 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-start">{t("sops.editor.versionField")}</th>
              <th className="p-3 text-start">{t("sops.detail.publishedEffective")}</th>
              <th className="p-3 text-start">{t("sops.editor.changeSummary")}</th>
              <th className="p-3 text-start">{t("sops.detail.authorPublisher")}</th>
              <th className="p-3 text-start">{t("sops.library.status")}</th>
              <th className="p-3 text-end">{t("sops.detail.view")}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-t border-border">
                <td className="p-3 font-mono-data" dir="ltr">
                  {version.version}
                </td>
                <td className="p-3 text-muted-foreground">
                  {dateLabel(version.effectiveDate ?? version.publishedAt, language)}
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
                    {dateTimeLabel(version.publishedAt ?? version.createdAt, language)}
                  </span>
                </td>
                <td className="p-3">
                  <Badge
                    variant={
                      version.version === currentVersion
                        ? "success"
                        : version.status === "draft"
                          ? "draft"
                          : "neutral"
                    }
                    size="sm"
                  >
                    {versionStatusLabel(version, currentVersion, t)}
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
                    {t("sops.detail.open")}
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
      data?.versions.find(
        (version) => version.version === data.sop.currentVersion,
      ) ??
      (management
        ? data?.versions.find(
            (version) => version.version === data.sop.draftVersion,
          )
        : undefined) ??
      data?.versions[0],
    [data, management, selectedVersionId],
  );
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionVersion, setRevisionVersion] = useState("1.1");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [revisionDate, setRevisionDate] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<number | null>(null);
  const [reviewNoChangesOpen, setReviewNoChangesOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { language, t } = useLanguage();

  const metaQuery = useQuery({
    queryKey: ["sops", "meta"],
    queryFn: fetchSopMeta,
    staleTime: Infinity,
  });
  const categories = metaQuery.data?.categories ?? FALLBACK_CATEGORIES;
  const sections = metaQuery.data?.sections ?? FALLBACK_SECTIONS;
  const users = metaQuery.data?.users;
  const meta = { categories, sections, users };

  // The detail query arrives asynchronously; seed the next revision field when it does.
  useEffect(() => {
    if (!data) return;
    setRevisionVersion(suggestNextMinorVersion(data.sop.currentVersion ?? selectedVersion?.version));
  }, [data, selectedVersion]);
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
          : t("sops.detail.revisionError"),
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
        value instanceof Error ? value.message : t("sops.detail.publishError"),
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
        value instanceof Error ? value.message : t("sops.detail.archiveError"),
      ),
  });
  const changeOwner = useMutation({
    mutationFn: (newOwnerUserId: number | null) =>
      updateSopOwner(id, { ownerUserId: newOwnerUserId }),
    onSuccess: async () => {
      setOwnerOpen(false);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["sops"] });
      await detail.refetch();
    },
    onError: (value) =>
      setActionError(
        value instanceof Error ? value.message : t("sops.detail.ownerError"),
      ),
  });
  const reviewNoChanges = useMutation({
    mutationFn: () => reviewSopNoChanges(id, selectedVersion!.version),
    onSuccess: async () => {
      setReviewNoChangesOpen(false);
      setActionError(null);
      await queryClient.invalidateQueries({ queryKey: ["sops"] });
      await detail.refetch();
    },
    onError: (value) =>
      setActionError(
        value instanceof Error ? value.message : t("sops.detail.reviewError"),
      ),
  });
  const exportSelectedVersion = async () => {
    if (!selectedVersion || exportBusy) return;
    setExportBusy(true);
    setActionError(null);
    try {
      await downloadSopXlsx(id, selectedVersion.version);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : t("sops.detail.exportExcelError"));
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
      setActionError(value instanceof Error ? value.message : t("sops.detail.exportJsonError"));
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
        <LoadingState message={t("sops.detail.loading")} />
      </PageShell>
    );
  if (detail.isError || !data || !selectedVersion)
    return (
      <PageShell>
        <ErrorState message={t("sops.detail.loadError")} />
        <Button
          type="button"
          variant="secondary"
          onClick={() => void detail.refetch()}
        >
          {t("common.tryAgain")}
        </Button>
      </PageShell>
    );
  const editing =
    management &&
    selectedVersion.status === "draft" &&
    data.sop.status !== "archived";
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
              {t(`sops.status.${data.sop.status}` as TranslationKey)}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span dir="ltr" className="font-mono-data">
              {data.sop.code}
            </span>
            <span>{data.sop.category}</span>
            <span dir="ltr">{t("sops.detail.version", { version: selectedVersion.version })}</span>
            <span>{t("sops.detail.effective", { date: dateLabel(selectedVersion.effectiveDate, language) })}</span>
            <span>{t("sops.detail.owner", { owner: data.sop.ownerName ?? "—" })}</span>
            <span>
              {t("sops.detail.nextReview", { date: selectedVersion.nextReviewDate ? dateLabel(selectedVersion.nextReviewDate, language) : "—" })}
            </span>
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
            {exportBusy ? t("sops.editor.exporting") : t("sops.editor.exportExcel")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => void exportSelectedVersionJson()} disabled={exportBusy}>
            <Download className="h-4 w-4" />
            {exportBusy ? t("sops.editor.exporting") : t("sops.editor.exportJson")}
          </Button>
          {management && data.sop.status === "published" ? (
            <>
              {selectedVersion.status === "published" ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setSelectedOwnerUserId(data.sop.ownerUserId ?? null);
                      setOwnerOpen(true);
                    }}
                  >
                    <UserCheck className="h-4 w-4" />
                    {t("sops.detail.changeOwner")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setReviewNoChangesOpen(true)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {t("sops.detail.reviewedNoChanges")}
                  </Button>
                </>
              ) : null}
              {data.sop.draftVersion ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigate(`/sops/${id}?version=${encodeURIComponent(data.sop.draftVersion!)}`)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("sops.detail.openDraftRevision")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setRevisionOpen(true)}
                >
                  <Pencil className="h-4 w-4" />
                  {t("sops.detail.createNewRevision")}
                </Button>
              )}
              <Button
                type="button"
                variant="destructive"
                onClick={() => setArchiveOpen(true)}
              >
                <Archive className="h-4 w-4" />
                {t("sops.detail.archiveSop")}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("/sops")}
          >
            {t("sops.detail.backToLibrary")}
          </Button>
        </div>
      </header>
      {management && data.sop.status === "published" && !data.sop.draftVersion ? <p className="text-sm text-muted-foreground">{t("sops.detail.createRevisionBeforeImport")}</p> : null}
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">
              {selectedVersion.status === "superseded"
                ? t("sops.detail.historicalVersion")
                : t("sops.detail.publishedSop")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("sops.detail.publishedBy", { date: dateTimeLabel(selectedVersion.publishedAt, language), publisher: selectedVersion.publishedByName ?? "—" })}
            </p>
          </div>
          <Badge
            variant={
              selectedVersion.status === "published" ? "success" : "neutral"
            }
          >
            {versionStatusLabel(selectedVersion, data.sop.currentVersion, t)}
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
            <DialogTitle>{t("sops.detail.revisionDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("sops.detail.revisionDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium">
              {t("sops.detail.newVersion")}
              <Input
                aria-label={t("sops.detail.newVersion")}
                dir="ltr"
                value={revisionVersion}
                onChange={(event) => setRevisionVersion(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t("sops.editor.effectiveDate")}
              <Input
                aria-label={t("sops.editor.effectiveDate")}
                type="date"
                value={revisionDate}
                onChange={(event) => setRevisionDate(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              {t("sops.editor.changeSummary")}
              <Textarea
                aria-label={t("sops.editor.changeSummary")}
                className="min-h-24"
                value={revisionSummary}
                onChange={(event) => setRevisionSummary(event.target.value)}
              />
            </label>
            {revision.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {revision.error instanceof Error
                  ? revision.error.message
                  : t("sops.detail.revisionError")}
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
              {t("common.cancel")}
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
              {revision.isPending ? t("sops.detail.creatingRevision") : t("sops.detail.createDraftRevision")}
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
            <DialogTitle>{t("sops.detail.archiveConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("sops.detail.archiveConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setArchiveOpen(false)}
              disabled={archive.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
            >
              {archive.isPending ? t("sops.detail.archiving") : t("sops.detail.archiveSop")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={ownerOpen}
        onClose={() => {
          if (!changeOwner.isPending) setOwnerOpen(false);
        }}
      >
        <DialogContent maxWidth="480px">
          <DialogHeader>
            <DialogTitle>{t("sops.detail.changeOwner")}</DialogTitle>
            <DialogDescription>
              {t("sops.detail.changeOwnerDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm font-medium">
              {t("sops.editor.ownerField")}
              <select
                aria-label={t("sops.detail.changeOwner")}
                className="input-premium h-10"
                value={selectedOwnerUserId ?? ""}
                onChange={(event) =>
                  setSelectedOwnerUserId(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              >
                <option value="">{t("sops.editor.selectOwner")}</option>
                {users?.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            {changeOwner.isError ? (
              <p role="alert" className="text-sm text-red-700">
                {changeOwner.error instanceof Error
                  ? changeOwner.error.message
                  : t("sops.detail.ownerError")}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOwnerOpen(false)}
              disabled={changeOwner.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => changeOwner.mutate(selectedOwnerUserId)}
              disabled={changeOwner.isPending}
            >
              {changeOwner.isPending ? t("sops.editor.saving") : t("sops.detail.saveOwner")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={reviewNoChangesOpen}
        onClose={() => {
          if (!reviewNoChanges.isPending) setReviewNoChangesOpen(false);
        }}
      >
        <DialogContent maxWidth="520px">
          <DialogHeader>
            <DialogTitle>{t("sops.detail.reviewedNoChanges")}</DialogTitle>
            <DialogDescription>
              {t("sops.detail.reviewConfirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t("sops.detail.reviewVersionUnchanged")}</p>
            <p>{t("sops.detail.reviewDateMoved")}</p>
          </div>
          {reviewNoChanges.isError ? (
            <p role="alert" className="text-sm text-red-700">
              {reviewNoChanges.error instanceof Error
                ? reviewNoChanges.error.message
                : t("sops.detail.reviewError")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReviewNoChangesOpen(false)}
              disabled={reviewNoChanges.isPending}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => reviewNoChanges.mutate()}
              disabled={reviewNoChanges.isPending}
            >
              {reviewNoChanges.isPending ? t("sops.detail.confirmingReview") : t("sops.detail.confirmReview")}
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
  const users = meta.data?.users;
  return (
    <EditorForm
      meta={{ categories, sections, users }}
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
  if (location.pathname.replace(/\/+$/, "") === "/sops/json-example") return <SopJsonExamplePage />;
  if (location.pathname.endsWith("/new")) return <NewSopPage />;
  if (id) return <DetailPage id={Number(id)} />;
  return <LibraryPage />;
}
