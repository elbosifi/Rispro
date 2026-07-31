import { useState } from "react";
import { AlertTriangle, Check, Copy } from "lucide-react";
import { formatDateLy, formatDateTimeLy } from "@/lib/date-format";
import { t } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import { Badge, Button } from "@/components/shared";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import type { PatientDirectorySummary } from "@/types/api";
import { formatPatientIdentifierRows, formatPatientSex } from "@/components/patients/patient-summary-formatters";
function CopyValueButton({ value, label }: { value: string | null | undefined; label: string }) {
  const { language } = useLanguage();
  const [copied, setCopied] = useState(false);
  const text = String(value ?? "").trim();
  if (!text) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      pushToast({ type: "success", title: t(language, "patients.directory.action.copied"), message: label });
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      pushToast({ type: "error", title: t(language, "patients.directory.action.copyFailed"), message: label });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="ms-1 inline-flex min-h-7 min-w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      aria-label={`${t(language, "patients.directory.action.copy")} ${label}`}
      title={`${t(language, "patients.directory.action.copy")} ${label}`}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

function Value({ value, dir = "auto", copyLabel }: { value: string | number | null | undefined; dir?: "auto" | "ltr"; copyLabel?: string }) {
  const text = value === null || value === undefined || String(value).trim() === "" ? "—" : String(value);
  return (
    <span dir={dir} className="inline-flex max-w-full items-center break-words text-end text-[13px] font-medium text-foreground">
      <span className={dir === "ltr" ? "break-all" : ""}>{text}</span>
      {copyLabel ? <CopyValueButton value={text === "—" ? null : text} label={copyLabel} /> : null}
    </span>
  );
}

function WarningBadge({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><AlertTriangle size={10} aria-hidden="true" />{label}</span>;
}

function DefinitionRows({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return <dl className="space-y-2">{rows.map((row) => <div key={row.label} className="flex min-w-0 items-start justify-between gap-3"><dt className="shrink-0 text-[11px] font-medium text-muted-foreground">{row.label}</dt><dd className="min-w-0 text-end">{row.value}</dd></div>)}</dl>;
}

type PatientSummaryContentProps = {
  summary: PatientDirectorySummary;
  variant: "embedded" | "drawer";
  canAuthorizeNoShow?: boolean;
  authorizeNoShowPending?: boolean;
  onAuthorizeNoShow?: () => void;
};

export function PatientSummaryContent({
  summary,
  variant,
  canAuthorizeNoShow = false,
  authorizeNoShowPending = false,
  onAuthorizeNoShow,
}: PatientSummaryContentProps) {
  const { language } = useLanguage();
  const identifiers = formatPatientIdentifierRows(summary, language);
  const demographics = summary.demographics;
  const contact = summary.contact;
  const estimated = demographics.demographicsEstimated || summary.warnings.incompleteData;
  const warnings = [
    summary.warnings.missingPhone ? t(language, "patients.directory.warning.missingPhone") : null,
    summary.warnings.missingDob ? t(language, "patients.directory.warning.missingDob") : null,
    summary.warnings.missingSex ? t(language, "patients.directory.warning.missingSex") : null,
    summary.warnings.missingName ? t(language, "patients.directory.warning.missingName") : null,
    summary.warnings.incompleteData ? t(language, "patients.directory.warning.incomplete") : null,
    summary.warnings.possibleDuplicate ? t(language, "patients.directory.warning.possibleDuplicate") : null,
  ].filter((label): label is string => Boolean(label));
  const noShowRows = [
    { label: t(language, "patients.noShowRestriction.count"), value: <Value value={summary.noShow.noShowCount} dir="ltr" /> },
    { label: t(language, "patients.noShowRestriction.currentlyRestricted"), value: <Badge variant={summary.noShow.bookingRestricted ? "error" : "success"} size="sm">{summary.noShow.bookingRestricted ? t(language, "patients.boolean.yes") : t(language, "patients.boolean.no")}</Badge> },
    { label: t(language, "patients.noShowRestriction.lastNoShow"), value: <Value value={summary.noShow.lastNoShowAppointment ? `${summary.noShow.lastNoShowAppointment.date} ${summary.noShow.lastNoShowAppointment.modalityName}` : null} /> },
    { label: t(language, "patients.noShowRestriction.lastAuthorization"), value: <Value value={summary.noShow.lastAuthorizationDate ? `${formatDateTimeLy(summary.noShow.lastAuthorizationDate)} - ${summary.noShow.lastAuthorizationUser?.fullName || summary.noShow.lastAuthorizationUser?.username || "—"}` : null} /> },
  ];

  return (
    <div className="space-y-4">
      <section aria-labelledby={`${variant}-patient-identity-heading`}>
        <h3 id={`${variant}-patient-identity-heading`} className="sr-only">{t(language, "patients.directory.drawer.demographics")}</h3>
        <div className="border-b border-border/70 pb-3">
          <p className="text-lg font-semibold leading-7 text-foreground">{demographics.arabicFullName || "—"}</p>
          <p className="text-sm font-medium leading-6 text-muted-foreground">{demographics.englishFullName || "—"}</p>
        </div>
        <div className="mt-3">
          <DefinitionRows rows={[
            { label: t(language, "patients.mrn"), value: <Value value={demographics.mrn} dir="ltr" copyLabel={t(language, "patients.mrn")} /> },
            { label: t(language, "patients.age"), value: <Value value={`${demographics.ageYears} ${t(language, "patients.age.years")} · ${formatPatientSex(language, demographics.sex)}${estimated ? ` · ${t(language, "patients.demographics.estimated")}` : ""}`} /> },
            { label: t(language, "patients.phone"), value: <Value value={contact.phone1} dir="ltr" copyLabel={t(language, "patients.phone")} /> },
            { label: t(language, "patients.directory.drawer.category"), value: <PatientCategoryBadge category={summary.category} showWhenUnset /> },
          ]} />
        </div>
      </section>

      <section aria-labelledby={`${variant}-patient-identifiers-heading`}>
        <h3 id={`${variant}-patient-identifiers-heading`} className="mb-2 text-xs font-semibold text-foreground">{t(language, "patients.directory.drawer.identifiers")}</h3>
        <div className="space-y-2">
          {identifiers.length ? identifiers.map((identifier) => <div key={identifier.id} className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{identifier.typeLabel}{identifier.isPrimary ? ` · ${t(language, "patients.identifier.primary")}` : ""}</span><Value value={identifier.value} dir="ltr" copyLabel={identifier.typeLabel} /></div>) : <Value value={null} />}
        </div>
      </section>

      <section aria-labelledby={`${variant}-patient-contact-heading`}>
        <h3 id={`${variant}-patient-contact-heading`} className="mb-2 text-xs font-semibold text-foreground">{t(language, "patients.directory.drawer.contact")}</h3>
        <DefinitionRows rows={[
          { label: t(language, "patients.phone") + " 2", value: <Value value={contact.phone2} dir="ltr" copyLabel={contact.phone2 ? `${t(language, "patients.phone")} 2` : undefined} /> },
          { label: t(language, "patients.address"), value: <Value value={contact.address} /> },
        ]} />
      </section>

      <details open={variant === "drawer"} className="border-t border-border/70 pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{t(language, "patients.demographics.more")}</summary>
        <div className="mt-3"><DefinitionRows rows={[
          { label: t(language, "patients.dateOfBirth"), value: <Value value={formatDateLy(demographics.dateOfBirth)} dir="ltr" /> },
          { label: t(language, "patients.directory.drawer.registeredAt"), value: <Value value={formatDateTimeLy(summary.registration.createdAt)} dir="ltr" /> },
          { label: t(language, "patients.directory.drawer.registeredBy"), value: <Value value={summary.registration.createdByName || summary.registration.createdByUsername || (summary.registration.createdByUserId ? `#${summary.registration.createdByUserId}` : null)} /> },
          { label: t(language, "patients.internalId"), value: <Value value={demographics.id} dir="ltr" copyLabel={t(language, "patients.internalId")} /> },
          { label: t(language, "patients.demographics.estimated"), value: <Value value={estimated ? t(language, "patients.boolean.yes") : t(language, "patients.boolean.no")} /> },
        ]} /></div>
      </details>

      {summary.noShow.bookingRestricted || variant === "drawer" ? <details open={variant === "drawer" && summary.noShow.bookingRestricted} className="border-t border-border/70 pt-3"><summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">{t(language, "patients.noShowRestriction.title")}</summary><div className="mt-3 space-y-2"><DefinitionRows rows={noShowRows} />{summary.noShow.lastAuthorizationReason ? <div className="rounded-lg bg-muted/20 p-2 text-xs"><p className="text-muted-foreground">{t(language, "patients.noShowRestriction.lastAuthorizationReason")}</p><p className="mt-1">{summary.noShow.lastAuthorizationReason}</p></div> : null}{summary.noShow.bookingRestricted && canAuthorizeNoShow && onAuthorizeNoShow ? <Button size="sm" variant="outline" onClick={onAuthorizeNoShow} disabled={authorizeNoShowPending}>{t(language, "patients.noShowRestriction.authorize")}</Button> : null}</div></details> : null}

      {warnings.length > 0 ? <section aria-labelledby={`${variant}-patient-warnings-heading`}><h3 id={`${variant}-patient-warnings-heading`} className="mb-2 text-xs font-semibold text-foreground">{t(language, "patients.directory.drawer.warnings")}</h3><div className="flex flex-wrap gap-2">{warnings.map((warning) => <WarningBadge key={warning} label={warning} />)}</div></section> : null}
    </div>
  );
}
