import type { ReactNode } from "react";
import { Badge, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shared";
import { chooseLocalized, t } from "@/lib/i18n";
import { useV2DayManagementContext } from "@/v2/appointments/api";
import type { DayManagementExamTypeDto, DayManagementRuleType } from "@/v2/appointments/types";

interface ManageDayDialogProps {
  open: boolean;
  onClose: () => void;
  language: "ar" | "en";
  modalityId: number | null;
  modalityLabel: string;
  date: string;
  dateLabel: string;
}

function examTypeNames(language: "ar" | "en", examTypes: DayManagementExamTypeDto[]): string {
  return examTypes
    .map((examType) => chooseLocalized(language, examType.nameAr, examType.nameEn) || examType.name || String(examType.id))
    .join(", ");
}

function ruleScope(language: "ar" | "en", ruleType: "specific_date" | "date_range" | "weekly_recurrence" | "yearly_recurrence") {
  const key = {
    specific_date: "calendar.manageDaySpecificDate",
    date_range: "calendar.manageDayDateRange",
    weekly_recurrence: "calendar.manageDayWeeklyRecurrence",
    yearly_recurrence: "calendar.manageDayYearlyRecurrence",
  } as const;
  return t(language, key[ruleType]);
}

function capability(language: "ar" | "en", type: DayManagementRuleType) {
  const copy = {
    block_modality: ["calendar.manageDayBlockModality", "calendar.manageDayBlockModalityHelp"],
    restrict_exam_types: ["calendar.manageDayRestrictExamTypes", "calendar.manageDayRestrictExamTypesHelp"],
    set_exam_mix_quota: ["calendar.manageDaySetExamMixQuota", "calendar.manageDaySetExamMixQuotaHelp"],
  } as const;
  return { title: t(language, copy[type][0]), help: t(language, copy[type][1]) };
}

export function ManageDayDialog({ open, onClose, language, modalityId, modalityLabel, date, dateLabel }: ManageDayDialogProps) {
  const contextQuery = useV2DayManagementContext(
    open && modalityId != null ? { modalityId, date, policySetKey: "default" } : undefined
  );
  const context = contextQuery.data;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent maxWidth="920px" className="text-left">
        <DialogHeader closeLabel={t(language, "common.dismiss")}>
          <div>
            <DialogTitle>{t(language, "calendar.manageDay")}</DialogTitle>
            <DialogDescription>{t(language, "calendar.manageDayDescription", { date: dateLabel, modality: modalityLabel })}</DialogDescription>
          </div>
        </DialogHeader>

        {contextQuery.isLoading ? <p className="py-4 text-sm text-muted-foreground">{t(language, "common.loading")}</p> : null}
        {contextQuery.isError ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">{t(language, "calendar.manageDayLoadError")}</p> : null}

        {context ? <div className="space-y-6">
          <section aria-labelledby="manage-day-summary">
            <h4 id="manage-day-summary" className="text-sm font-semibold">{t(language, "calendar.manageDaySummary")}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryItem label={t(language, "calendar.capacitySummary", { capacity: context.modality.dailyCapacity ?? t(language, "common.na"), booked: context.bookingSummary.bookedTotal })} value={context.modality.dailyCapacity ?? t(language, "common.na")} />
              <SummaryItem label={t(language, "calendar.manageDayActiveBookings")} value={context.bookingSummary.bookedTotal} />
              <SummaryItem label={t(language, "calendar.oncologyLabel")} value={context.bookingSummary.oncologyBooked} />
              <SummaryItem label={t(language, "calendar.nonOncologyLabel")} value={context.bookingSummary.nonOncologyBooked} />
            </div>
            {context.bookingSummary.bookedTotal > 0 ? <p className="mt-3 rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">{t(language, "calendar.manageDayExistingBookingsNotice")}</p> : null}
          </section>

          <section aria-labelledby="manage-day-policy">
            <h4 id="manage-day-policy" className="text-sm font-semibold">{t(language, "calendar.manageDayPolicyStatus")}</h4>
            <div className="mt-2 space-y-2 text-sm">
              {context.policy.published ? <p>{t(language, "calendar.manageDayPublishedVersion", { version: context.policy.published.versionNo })}</p> : <p>{t(language, "calendar.manageDayNoPublishedPolicy")}</p>}
              {context.policy.draft ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-900 dark:text-amber-100">{t(language, "calendar.manageDayDraftWarning", { version: context.policy.draft.versionNo })}</p> : null}
            </div>
          </section>

          <section aria-labelledby="manage-day-rules">
            <h4 id="manage-day-rules" className="text-sm font-semibold">{t(language, "calendar.manageDayRulesAffecting")}</h4>
            {context.effectiveRules.modalityBlocks.length + context.effectiveRules.examTypeRestrictions.length + context.effectiveRules.examMixQuotas.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t(language, "calendar.manageDayNoEffectiveRules")}</p> : <div className="mt-2 space-y-2">
              {context.effectiveRules.modalityBlocks.map((rule) => <RuleRow key={`block-${rule.id}`} title={rule.title || t(language, "calendar.manageDayModalityBlock")} scope={ruleScope(language, rule.ruleType)} badge={<Badge variant={rule.isOverridable ? "warning" : "error"} size="sm">{t(language, rule.isOverridable ? "calendar.manageDayOverridable" : "calendar.manageDayHardBlock")}</Badge>} notes={rule.notes} />)}
              {context.effectiveRules.examTypeRestrictions.map((rule) => <RuleRow key={`restriction-${rule.id}`} title={rule.title || t(language, "calendar.manageDayExamRestriction")} scope={ruleScope(language, rule.ruleType)} badge={<Badge variant={rule.effectMode === "restriction_overridable" ? "warning" : "error"} size="sm">{t(language, rule.effectMode === "restriction_overridable" ? "calendar.manageDayOverridable" : "calendar.manageDayHardRestriction")}</Badge>} details={examTypeNames(language, rule.examTypes)} notes={rule.notes} />)}
              {context.effectiveRules.examMixQuotas.map((rule) => <RuleRow key={`quota-${rule.id}`} title={rule.title || t(language, "calendar.manageDayExamMixQuota")} scope={ruleScope(language, rule.ruleType)} details={`${t(language, "calendar.manageDayDailyLimit")}: ${rule.dailyLimit} · ${examTypeNames(language, rule.examTypes)}`} />)}
            </div>}
          </section>

          <section aria-labelledby="manage-day-global">
            <h4 id="manage-day-global" className="text-sm font-semibold">{t(language, "calendar.manageDayGlobalPolicy")}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{t(language, "calendar.manageDayGlobalPolicyHelp")}</p>
            {context.globalConstraints.categoryDailyLimits.length + context.globalConstraints.specialQuotas.length === 0 && !context.globalConstraints.closedWeekday ? <p className="mt-2 text-sm text-muted-foreground">{t(language, "calendar.manageDayNoGlobalConstraints")}</p> : <div className="mt-2 space-y-2 text-sm">
              {context.globalConstraints.categoryDailyLimits.map((rule) => <p key={`category-${rule.id}`}><span className={rule.caseCategory === "oncology" ? "text-rose-700" : "text-sky-700"}>{t(language, rule.caseCategory === "oncology" ? "calendar.oncologyLabel" : "calendar.nonOncologyLabel")}</span>: {rule.dailyLimit}</p>)}
              {context.globalConstraints.specialQuotas.map((rule) => <RuleRow key={`special-${rule.id}`} title={rule.title || rule.logicalKey} details={`${t(language, "calendar.manageDayExtraSlots")}: ${rule.dailyExtraSlots} · ${examTypeNames(language, rule.examTypes)}`} />)}
              {context.globalConstraints.closedWeekday ? <p className="rounded-md bg-muted p-3">{t(language, "calendar.manageDayClosedWeekday", { weekday: context.globalConstraints.closedWeekday })}</p> : null}
            </div>}
          </section>

          <section aria-labelledby="manage-day-types">
            <h4 id="manage-day-types" className="text-sm font-semibold">{t(language, "calendar.manageDayDayRuleTypes")}</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {context.supportedDayRuleTypes.map((type) => {
                const item = capability(language, type);
                return <div key={type} className="rounded-md border border-border p-3"><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.help}</p></div>;
              })}
            </div>
          </section>
        </div> : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>;
}

function RuleRow({ title, scope, badge, details, notes }: { title: string; scope?: string; badge?: ReactNode; details?: string; notes?: string | null }) {
  return <div className="rounded-md border border-border p-3"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{title}</p>{badge}</div>{scope ? <p className="mt-1 text-xs text-muted-foreground">{scope}</p> : null}{details ? <p className="mt-1 text-sm">{details}</p> : null}{notes ? <p className="mt-1 text-sm text-muted-foreground">{notes}</p> : null}</div>;
}
