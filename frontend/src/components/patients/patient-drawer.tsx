import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CalendarPlus, ChevronRight, Copy, Pencil, Printer, X } from "lucide-react";
import { authorizePatientNoShowBooking, fetchPatientDirectorySummary } from "@/lib/api-hooks";
import { printAppointmentSlipById } from "@/lib/appointment-printing";
import { formatDateTimeLy } from "@/lib/date-format";
import { t, type Language } from "@/lib/i18n";
import { pushToast } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import { useAuth } from "@/providers/auth-provider";
import { Badge, Button } from "@/components/shared";
import { PatientCategoryBadge } from "@/components/patients/patient-category-badge";
import type { PatientDirectorySummary } from "@/types/api";

function WarningBadge({ warning, label }: { warning: boolean; label: string }) {
  if (!warning) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <AlertTriangle size={10} />
      {label}
    </span>
  );
}

function formatIdentifierTypeLabel(type: string, language: Language): string {
  if (type === "national_id") return t(language, "patients.nationalId");
  if (type === "passport") return language === "ar" ? "جواز سفر" : "Passport";
  if (type === "other") return language === "ar" ? "معرف آخر" : "Other";
  return type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatIdentifierValueLabel(
  summary: Pick<PatientDirectorySummary, "identifiers">,
  language: Language
): Array<{ id: string; typeLabel: string; value: string; isPrimary: boolean }> {
  const items = summary.identifiers.items ?? [];
  if (items.length > 0) {
    return items.map((item) => ({
      id: String(item.id ?? `${item.typeCode}:${item.value}`),
      typeLabel: formatIdentifierTypeLabel(item.typeCode, language),
      value: item.value || (item.typeCode === "national_id" ? summary.identifiers.nationalId || "—" : "—"),
      isPrimary: item.isPrimary
    }));
  }

  const fallbackValue = summary.identifiers.identifierValue || summary.identifiers.nationalId;
  if (!fallbackValue) return [];

  return [
    {
      id: "primary",
      typeLabel:
        summary.identifiers.identifierType && summary.identifiers.identifierType !== "national_id"
          ? formatIdentifierTypeLabel(summary.identifiers.identifierType, language)
          : t(language, "patients.nationalId"),
      value: fallbackValue,
      isPrimary: true
    }
  ];
}

export function PatientDrawer({
  patientId,
  onClose,
}: {
  patientId: number;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isRtl = language === "ar";

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["patient-directory-summary", patientId],
    queryFn: () => fetchPatientDirectorySummary(patientId),
    staleTime: 1000 * 30,
    retry: 1,
  });
  const authorizeNoShow = useMutation({
    mutationFn: (reason: string) => authorizePatientNoShowBooking(patientId, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["patient-directory-summary", patientId] });
      pushToast({
        type: "success",
        title: language === "ar" ? "تم السماح بالحجز" : "Booking authorized",
        message: language === "ar" ? "تم رفع تقييد الحجز بعد عدم الحضور." : "No-show booking restriction cleared.",
      });
    },
    onError: (error) => {
      pushToast({
        type: "error",
        title: language === "ar" ? "تعذر السماح بالحجز" : "Authorization failed",
        message: error instanceof Error ? error.message : "Unable to authorize booking.",
      });
    },
  });

  const handleAuthorizeNoShow = () => {
    const reason = window.prompt(language === "ar" ? "سبب السماح بالحجز بعد عدم الحضور" : "Reason to authorize booking after no-show");
    if (!reason?.trim()) return;
    authorizeNoShow.mutate(reason.trim());
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} data-testid="patient-drawer-backdrop">
        <div
          className={`fixed inset-y-0 z-[80] flex w-full max-w-md items-center justify-center bg-background shadow-xl ${
            isRtl ? "left-0 border-r border-border" : "right-0 border-l border-border"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="spinner-industrial h-8 w-8" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} data-testid="patient-drawer-backdrop">
        <div
          className={`fixed inset-y-0 z-[80] flex w-full max-w-md items-center justify-center bg-background shadow-xl ${
            isRtl ? "left-0 border-r border-border" : "right-0 border-l border-border"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 text-center">
            <p className="text-red-500">Failed to load patient details</p>
            <Button variant="outline" size="sm" onClick={onClose} className="mt-2">
              Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) return null;
  const canAuthorizeNoShow =
    user?.role === "super_admin" ||
    (user?.role === "supervisor" && summary.category !== "non_oncology");
  const lastAppointmentId = summary.lastAppointment?.id ?? null;
  const registeredBy =
    summary.registration?.createdByName ||
    summary.registration?.createdByUsername ||
    (summary.registration?.createdByUserId ? `#${summary.registration.createdByUserId}` : "—");
  const identifierRows = formatIdentifierValueLabel(summary, language);
  const copyValue = async (label: string, value: string | null | undefined) => {
    const text = String(value || "").trim();
    if (!text) return;

    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      pushToast({
        type: "success",
        title: t(language, "patients.directory.action.copied"),
        message: label,
      });
    } catch {
      pushToast({
        type: "error",
        title: t(language, "patients.directory.action.copyFailed"),
        message: label,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/30" onClick={onClose} data-testid="patient-drawer-backdrop">
      <div
        className={`fixed inset-y-0 z-[80] flex w-full max-w-md flex-col overflow-hidden bg-background shadow-xl ${
          isRtl ? "left-0 border-r border-border" : "right-0 border-l border-border"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-bold">{t(language, "patients.directory.drawer.title")}</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t(language, "patients.directory.drawer.demographics")}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(language, "patients.nameAr")}</span>
                <span className="font-medium">{summary.demographics.arabicFullName}</span>
              </div>
              {summary.demographics.englishFullName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t(language, "patients.nameEn")}</span>
                  <span>{summary.demographics.englishFullName}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.mrn")}</span>
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono">{summary.demographics.mrn || "—"}</span>
                  {summary.demographics.mrn ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={t(language, "patients.directory.action.copyMrn")}
                      title={t(language, "patients.directory.action.copyMrn")}
                      onClick={() => void copyValue(t(language, "patients.mrn"), summary.demographics.mrn)}
                    >
                      <Copy size={13} />
                    </Button>
                  ) : null}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(language, "patients.sex")}</span>
                <span>{summary.demographics.sex || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(language, "patients.age")}</span>
                <span>
                  {summary.demographics.ageYears}
                  {summary.demographics.demographicsEstimated ? " (E)" : ""}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.directory.drawer.registeredAt")}</span>
                <span className="text-end">{formatDateTimeLy(summary.registration?.createdAt ?? null)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.directory.drawer.registeredBy")}</span>
                <span className="text-end">{registeredBy}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t(language, "patients.directory.drawer.identifiers")}
            </h3>
            <div className="space-y-2 text-sm">
              {identifierRows.length > 0 ? (
                identifierRows.map((identifier) => (
                  <div key={identifier.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{identifier.typeLabel}</span>
                      {identifier.isPrimary ? (
                        <Badge variant="neutral" className="text-[10px] uppercase tracking-[0.12em]">
                          {language === "ar" ? "أساسي" : "Primary"}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1 font-mono text-foreground">{identifier.value}</div>
                  </div>
                ))
              ) : (
                <div className="text-muted-foreground">—</div>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t(language, "patients.directory.drawer.contact")}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.phone")}</span>
                <span className="inline-flex items-center gap-1">
                  <span>{summary.contact.phone1 || "—"}</span>
                  {summary.contact.phone1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={t(language, "patients.directory.action.copyPhone")}
                      title={t(language, "patients.directory.action.copyPhone")}
                      onClick={() => void copyValue(t(language, "patients.phone"), summary.contact.phone1)}
                    >
                      <Copy size={13} />
                    </Button>
                  ) : null}
                </span>
              </div>
              {summary.contact.phone2 && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{t(language, "patients.phone")} 2</span>
                  <span className="inline-flex items-center gap-1">
                    <span>{summary.contact.phone2}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      aria-label={t(language, "patients.directory.action.copyPhone")}
                      title={t(language, "patients.directory.action.copyPhone")}
                      onClick={() => void copyValue(`${t(language, "patients.phone")} 2`, summary.contact.phone2)}
                    >
                      <Copy size={13} />
                    </Button>
                  </span>
                </div>
              )}
            </div>
          </section>

          {summary.category && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {t(language, "patients.directory.drawer.category")}
              </h3>
              <PatientCategoryBadge category={summary.category} />
            </section>
          )}

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t(language, "patients.noShowRestriction.title")}
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.noShowRestriction.count")}</span>
                <span>{summary.noShow.noShowCount}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.noShowRestriction.currentlyRestricted")}</span>
                <Badge variant={summary.noShow.bookingRestricted ? "error" : "success"} size="sm">
                  {summary.noShow.bookingRestricted ? (language === "ar" ? "نعم" : "Yes") : (language === "ar" ? "لا" : "No")}
                </Badge>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.noShowRestriction.lastNoShow")}</span>
                <span className="text-end">
                  {summary.noShow.lastNoShowAppointment
                    ? `${summary.noShow.lastNoShowAppointment.date} ${summary.noShow.lastNoShowAppointment.modalityName}`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{t(language, "patients.noShowRestriction.lastAuthorization")}</span>
                <span className="text-end">
                  {summary.noShow.lastAuthorizationDate
                    ? `${formatDateTimeLy(summary.noShow.lastAuthorizationDate)} - ${summary.noShow.lastAuthorizationUser?.fullName || summary.noShow.lastAuthorizationUser?.username || "—"}`
                    : "—"}
                </span>
              </div>
              {summary.noShow.lastAuthorizationReason && (
                <div className="rounded-lg border border-border bg-muted/20 p-2">
                  <div className="text-muted-foreground">{t(language, "patients.noShowRestriction.lastAuthorizationReason")}</div>
                  <div>{summary.noShow.lastAuthorizationReason}</div>
                </div>
              )}
              {summary.noShow.bookingRestricted && canAuthorizeNoShow && (
                <Button size="sm" variant="outline" onClick={handleAuthorizeNoShow} disabled={authorizeNoShow.isPending}>
                  {t(language, "patients.noShowRestriction.authorize")}
                </Button>
              )}
              {summary.noShow.bookingRestricted && summary.category === "non_oncology" && user?.role === "supervisor" && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                  {t(language, "patients.noShowRestriction.superAdminOnlyNonOncology")}
                </div>
              )}
            </div>
          </section>

          {(summary.warnings.missingPhone ||
            summary.warnings.missingDob ||
            summary.warnings.missingSex ||
            summary.warnings.missingName ||
            summary.warnings.incompleteData ||
            summary.warnings.possibleDuplicate) && (
            <section>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                {t(language, "patients.directory.drawer.warnings")}
              </h3>
              <div className="flex flex-wrap gap-2">
                <WarningBadge warning={summary.warnings.missingPhone} label={t(language, "patients.directory.warning.missingPhone")} />
                <WarningBadge warning={summary.warnings.missingDob} label={t(language, "patients.directory.warning.missingDob")} />
                <WarningBadge warning={summary.warnings.missingSex} label={t(language, "patients.directory.warning.missingSex")} />
                <WarningBadge warning={summary.warnings.missingName} label={t(language, "patients.directory.warning.missingName")} />
                <WarningBadge warning={summary.warnings.incompleteData} label={t(language, "patients.directory.warning.incomplete")} />
                <WarningBadge warning={summary.warnings.possibleDuplicate} label={t(language, "patients.directory.warning.possibleDuplicate")} />
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              {t(language, "patients.directory.drawer.recentAppointments")}
            </h3>
            {summary.recentAppointments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(language, "patients.directory.noAppointments")}</p>
            ) : (
              <div className="space-y-2">
                {summary.recentAppointments.slice(0, 5).map((appt) => (
                  <button
                    key={appt.id}
                    type="button"
                    onClick={() => navigate(`/registrations?appointmentId=${appt.id}&patientId=${patientId}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 text-start transition-colors hover:border-accent/30 hover:bg-accent/5 focus:outline-none focus:ring-2 focus:ring-accent/30"
                    aria-label={`${appt.date} ${appt.modalityName} ${t(language, "patients.directory.action.manageRegistration")}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{appt.date}</div>
                      <div className="text-xs text-muted-foreground">{appt.modalityName}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant={appt.status === "completed" ? "success" : appt.status === "cancelled" ? "error" : "neutral"}
                        size="sm"
                      >
                        {appt.status}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
                        {t(language, "patients.directory.action.manageRegistration")}
                        <ChevronRight size={14} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="border-t border-border p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.15em] text-muted-foreground">
            {t(language, "patients.directory.drawer.quickActions")}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/edit`)}>
              <Pencil size={14} />
              {t(language, "patients.directory.action.edit")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate(`/appointments?patientId=${patientId}`)}>
              <CalendarPlus size={14} />
              {t(language, "patients.directory.action.createAppointment")}
            </Button>
            {lastAppointmentId != null && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/registrations?appointmentId=${lastAppointmentId}&patientId=${patientId}`)}
                >
                  <ChevronRight size={14} />
                  {t(language, "patients.directory.action.manageRegistration")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void printAppointmentSlipById(lastAppointmentId, language)}
                >
                  <Printer size={14} />
                  {t(language, "patients.directory.action.print")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
