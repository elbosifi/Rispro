import { useState, type ReactNode } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Textarea,
} from "@/components/shared";
import { ApiError } from "@/lib/api-client";
import { todayIsoDateLy } from "@/lib/date-format";
import { chooseLocalized, t } from "@/lib/i18n";
import {
  useCreateV2DayExamMixQuota,
  useCreateV2DayExamRestriction,
  useCreateV2DayModalityBlock,
  useRemoveV2DayManagementRule,
  useV2DayManagementContext,
} from "@/v2/appointments/api";
import type {
  DayManagementContextDto,
  DayManagementExamTypeDto,
  DayManagementRemovableRuleFamily,
  DayManagementRuleType,
} from "@/v2/appointments/types";

interface ManageDayDialogProps {
  open: boolean;
  onClose: () => void;
  language: "ar" | "en";
  modalityId: number | null;
  modalityLabel: string;
  date: string;
  dateLabel: string;
}

type Action = DayManagementRuleType | null;
type Scope = keyof typeof scopeKey;
type RemoveTarget = {
  family: DayManagementRemovableRuleFamily;
  ruleId: number;
  title: string;
  scope: string;
} | null;
type ConfirmationState =
  | { kind: "create"; action: Exclude<Action, null> }
  | { kind: "remove" }
  | null;
type InteractionWarning = { title?: string; description: string };

const scopeKey = {
  specific_date: "calendar.manageDaySpecificDate",
  date_range: "calendar.manageDayDateRange",
  weekly_recurrence: "calendar.manageDayWeeklyRecurrence",
  yearly_recurrence: "calendar.manageDayYearlyRecurrence",
} as const;
const familyTitleKey = {
  block_modality: "calendar.manageDayModalityBlock",
  restrict_exam_types: "calendar.manageDayExamRestriction",
  set_exam_mix_quota: "calendar.manageDayExamMixQuota",
} as const;

function examTypeName(language: "ar" | "en", item: DayManagementExamTypeDto) {
  return (
    chooseLocalized(language, item.nameAr, item.nameEn) ||
    item.name ||
    t(language, "common.na")
  );
}

function examTypeNames(language: "ar" | "en", items: DayManagementExamTypeDto[]) {
  return items.map((item) => examTypeName(language, item)).join(", ");
}

function capability(language: "ar" | "en", type: DayManagementRuleType) {
  const keys = {
    block_modality: [
      "calendar.manageDayBlockModality",
      "calendar.manageDayBlockModalityHelp",
    ],
    restrict_exam_types: [
      "calendar.manageDayRestrictExamTypes",
      "calendar.manageDayRestrictExamTypesHelp",
    ],
    set_exam_mix_quota: [
      "calendar.manageDaySetExamMixQuota",
      "calendar.manageDaySetExamMixQuotaHelp",
    ],
  } as const;

  return { title: t(language, keys[type][0]), help: t(language, keys[type][1]) };
}

function semanticRuleTitle(
  language: "ar" | "en",
  family: DayManagementRemovableRuleFamily,
  title: string | null,
  specificDate: string | null,
) {
  const generatedTitle = specificDate
    ? {
        block_modality: `Day block - ${specificDate}`,
        restrict_exam_types: `Day exam restriction - ${specificDate}`,
        set_exam_mix_quota: `Day exam-mix quota - ${specificDate}`,
      }[family]
    : null;

  return title && title !== generatedTitle
    ? title
    : t(language, familyTitleKey[family]);
}

function buildInteractionWarnings({
  language,
  action,
  isOverridable,
  effectMode,
  examTypeIds,
  context,
}: {
  language: "ar" | "en";
  action: DayManagementRuleType;
  isOverridable: boolean;
  effectMode: "hard_restriction" | "restriction_overridable";
  examTypeIds: number[];
  context: DayManagementContextDto;
}): InteractionWarning[] {
  const warnings: InteractionWarning[] = [];
  const hasHardInheritedModalityBlock = context.effectiveRules.modalityBlocks.some(
    (rule) => rule.ruleType !== "specific_date" && !rule.isOverridable,
  );

  if (hasHardInheritedModalityBlock && action === "block_modality") {
    warnings.push(
      isOverridable
        ? {
            title: t(language, "calendar.manageDayInheritedHardBlockTitle"),
            description: t(
              language,
              "calendar.manageDayInheritedHardBlockOverrideWarning",
            ),
          }
        : {
            description: t(
              language,
              "calendar.manageDayInheritedHardBlockRedundantWarning",
            ),
          },
    );
  }

  if (
    hasHardInheritedModalityBlock &&
    (action === "restrict_exam_types" || action === "set_exam_mix_quota")
  ) {
    warnings.push({
      description: t(
        language,
        "calendar.manageDayInheritedBlockStillBlocksWarning",
      ),
    });
  }

  const selectedExamIds = new Set(examTypeIds);
  if (action === "restrict_exam_types") {
    const inheritedHardRestrictions = context.effectiveRules.examTypeRestrictions.filter(
      (rule) =>
        rule.ruleType !== "specific_date" &&
        rule.effectMode === "hard_restriction",
    );
    const overlappingExamTypes = context.examTypeOptions.filter((exam) =>
      selectedExamIds.has(exam.id) &&
      inheritedHardRestrictions.some((rule) =>
        rule.examTypes.some((ruleExam) => ruleExam.id === exam.id),
      ),
    );
    const overlappingExamNames = examTypeNames(language, overlappingExamTypes);

    if (overlappingExamNames) {
      warnings.push(
        effectMode === "restriction_overridable"
          ? {
              title: t(language, "calendar.manageDayInheritedHardExamTitle"),
              description: t(
                language,
                "calendar.manageDayInheritedHardExamOverridableWarning",
                { exams: overlappingExamNames },
              ),
            }
          : {
              description: t(
                language,
                "calendar.manageDayInheritedHardExamRedundantWarning",
                { exams: overlappingExamNames },
              ),
            },
      );
    }
  }

  if (action === "set_exam_mix_quota") {
    const inheritedQuotas = context.effectiveRules.examMixQuotas.filter(
      (rule) => rule.ruleType !== "specific_date",
    );
    const overlappingExamTypes = context.examTypeOptions.filter((exam) =>
      selectedExamIds.has(exam.id) &&
      inheritedQuotas.some((rule) =>
        rule.examTypes.some((ruleExam) => ruleExam.id === exam.id),
      ),
    );
    const overlappingExamNames = examTypeNames(language, overlappingExamTypes);

    if (overlappingExamNames) {
      warnings.push({
        title: t(language, "calendar.manageDayInheritedQuotaTitle"),
        description: t(language, "calendar.manageDayInheritedQuotaWarning", {
          exams: overlappingExamNames,
        }),
      });
    }
  }

  return warnings;
}

export function ManageDayDialog(props: ManageDayDialogProps) {
  const { open, date, modalityId } = props;
  return <ManageDayDialogContent key={`${open}-${date}-${modalityId ?? "none"}`} {...props} />;
}

function ManageDayDialogContent({
  open,
  onClose,
  language,
  modalityId,
  modalityLabel,
  date,
  dateLabel,
}: ManageDayDialogProps) {
  const contextQuery = useV2DayManagementContext(
    open && modalityId != null
      ? { modalityId, date, policySetKey: "default" }
      : undefined,
  );
  const block = useCreateV2DayModalityBlock();
  const restriction = useCreateV2DayExamRestriction();
  const quota = useCreateV2DayExamMixQuota();
  const remove = useRemoveV2DayManagementRule();
  const context = contextQuery.data;

  const [action, setAction] = useState<Action>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget>(null);
  const [confirmation, setConfirmation] =
    useState<ConfirmationState>(null);
  const [reason, setReason] = useState("");
  const [examTypeIds, setExamTypeIds] = useState<number[]>([]);
  const [examSearch, setExamSearch] = useState("");
  const [isOverridable, setIsOverridable] = useState(false);
  const [effectMode, setEffectMode] = useState<
    "hard_restriction" | "restriction_overridable"
  >("hard_restriction");
  const [dailyLimit, setDailyLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const hasDraft = context?.policy.draft != null;
  const published = context?.policy.published;
  const isPastDate = date < todayIsoDateLy();
  const mutationPending =
    block.isPending || restriction.isPending || quota.isPending || remove.isPending;
  const contextRefreshing = contextQuery.isFetching && !contextQuery.isLoading;
  const writeUnavailable =
    hasDraft ||
    !published ||
    isPastDate ||
    context?.modality.isActive === false;
  const interactionLocked =
    mutationPending || contextRefreshing || writeUnavailable;
  const interactionWarnings =
    context && action && confirmation?.kind !== "remove"
      ? buildInteractionWarnings({
          language,
          action,
          isOverridable,
          effectMode,
          examTypeIds,
          context,
        })
      : [];

  const resetEditorState = () => {
    setAction(null);
    setRemoveTarget(null);
    setConfirmation(null);
    setReason("");
    setExamTypeIds([]);
    setExamSearch("");
    setIsOverridable(false);
    setEffectMode("hard_restriction");
    setDailyLimit("");
    setError(null);
  };

  const resetAllInteractionState = () => {
    resetEditorState();
    setFeedback(null);
  };

  const handleClose = () => {
    if (mutationPending) return;
    resetAllInteractionState();
    onClose();
  };

  const handleMutationError = async (caught: unknown) => {
    const codes = caught instanceof ApiError ? caught.reasonCodes : [];
    const errorMessage = codes.includes("action_pin_cancelled")
      ? t(language, "calendar.manageDayActionPinCancelled")
      : codes.includes("day_management_context_stale")
        ? t(language, "calendar.manageDayStaleContext")
      : codes.includes("day_management_draft_conflict")
        ? t(language, "calendar.manageDayDraftConflictError")
        : codes.includes("day_management_rule_scope_conflict")
          ? t(language, "calendar.manageDayRuleScopeConflictError")
          : codes.includes("day_management_rule_already_exists")
            ? t(language, "calendar.manageDayRuleAlreadyExistsError")
            : codes.includes("day_management_audit_required")
              ? t(language, "calendar.manageDayAuditRequiredError")
              : codes.includes("day_management_past_date")
                ? t(language, "calendar.manageDayPastDateError")
                : codes.includes("day_management_invalid_daily_limit")
                  ? t(language, "calendar.manageDayInvalidDailyLimitError")
                  : t(language, "calendar.manageDayMutationError");

    setError(errorMessage);
    if (
      codes.includes("day_management_context_stale") ||
      codes.includes("day_management_draft_conflict")
    ) {
      await contextQuery.refetch();
    }
  };

  const base = () =>
    published && modalityId != null
      ? {
          policySetKey: "default",
          modalityId,
          date,
          expectedPublishedVersionId: published.id,
          reason,
        }
      : null;

  const quotaValidationMessage = () => {
    const capacity = context?.modality.dailyCapacity;
    return typeof capacity === "number" &&
      Number.isFinite(capacity) &&
      capacity > 0
      ? t(language, "calendar.manageDayQuotaValidationWithCapacity", {
          capacity,
        })
      : t(language, "calendar.manageDayQuotaValidation");
  };

  const validateChange = (
    nextConfirmation: Exclude<ConfirmationState, null>,
  ) => {
    if (isPastDate) {
      setError(t(language, "calendar.manageDayPastDateError"));
      return null;
    }
    if (context?.modality.isActive === false) {
      setError(t(language, "calendar.manageDayInactiveModalityError"));
      return null;
    }

    const payload = base();
    if (!payload) {
      setError(t(language, "calendar.manageDayNoPublishedPolicy"));
      return null;
    }
    if (hasDraft) {
      setError(t(language, "calendar.manageDayDraftConflictError"));
      return null;
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3 || trimmedReason.length > 500) {
      setError(t(language, "calendar.manageDayReasonValidation"));
      return null;
    }
    if (nextConfirmation.kind === "remove") {
      return removeTarget ? { payload } : null;
    }
    if (
      (nextConfirmation.action === "restrict_exam_types" ||
        nextConfirmation.action === "set_exam_mix_quota") &&
      !examTypeIds.length
    ) {
      setError(t(language, "calendar.manageDayExamTypesRequired"));
      return null;
    }
    if (nextConfirmation.action !== "set_exam_mix_quota") {
      return { payload };
    }

    const trimmedLimit = dailyLimit.trim();
    const parsedLimit = Number(trimmedLimit);
    const capacity = context?.modality.dailyCapacity;
    if (
      !trimmedLimit ||
      !Number.isFinite(parsedLimit) ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      (typeof capacity === "number" &&
        Number.isFinite(capacity) &&
        capacity > 0 &&
        parsedLimit > capacity)
    ) {
      setError(quotaValidationMessage());
      return null;
    }
    return { payload, dailyLimit: parsedLimit };
  };

  const submit = () => {
    if (interactionLocked || !action) return;
    const nextConfirmation: Exclude<ConfirmationState, null> = {
      kind: "create",
      action,
    };
    if (!validateChange(nextConfirmation)) return;
    setError(null);
    setConfirmation(nextConfirmation);
  };

  const submitRemoval = () => {
    if (interactionLocked) return;
    const nextConfirmation: Exclude<ConfirmationState, null> = {
      kind: "remove",
    };
    if (!validateChange(nextConfirmation)) return;
    setError(null);
    setConfirmation(nextConfirmation);
  };

  const publishConfirmedChange = async () => {
    if (!confirmation || interactionLocked) return;
    const validated = validateChange(confirmation);
    if (!validated) return;
    setError(null);

    try {
      if (confirmation.kind === "remove") {
        if (!removeTarget) return;
        await remove.mutateAsync({
          family: removeTarget.family,
          ruleId: removeTarget.ruleId,
          input: validated.payload,
        });
        setFeedback(t(language, "calendar.manageDayRemovalSuccess"));
      } else if (confirmation.action === "block_modality") {
        await block.mutateAsync({ ...validated.payload, isOverridable });
        setFeedback(t(language, "calendar.manageDayMutationSuccess"));
      } else if (confirmation.action === "restrict_exam_types") {
        await restriction.mutateAsync({
          ...validated.payload,
          examTypeIds,
          effectMode,
        });
        setFeedback(t(language, "calendar.manageDayMutationSuccess"));
      } else {
        await quota.mutateAsync({
          ...validated.payload,
          examTypeIds,
          dailyLimit: validated.dailyLimit!,
        });
        setFeedback(t(language, "calendar.manageDayMutationSuccess"));
      }
      resetEditorState();
    } catch (caught) {
      await handleMutationError(caught);
    }
  };

  const cancelEditor = () => {
    if (mutationPending) return;
    resetEditorState();
  };

  const openAction = (next: Action) => {
    if (interactionLocked || action || removeTarget || confirmation) return;
    resetAllInteractionState();
    setAction(next);
  };

  const openRemoval = (
    family: DayManagementRemovableRuleFamily,
    ruleId: number,
    title: string,
    scope: string,
  ) => {
    if (interactionLocked || action || removeTarget || confirmation) return;
    resetAllInteractionState();
    setRemoveTarget({ family, ruleId, title, scope });
  };

  const toggle = (id: number) =>
    setExamTypeIds((ids) =>
      ids.includes(id)
        ? ids.filter((value) => value !== id)
        : [...ids, id],
    );

  const removeControl = (
    family: DayManagementRemovableRuleFamily,
    rule: {
      id: number;
      ruleType: Scope;
      specificDate: string | null;
      title: string | null;
    },
  ) =>
    rule.ruleType === "specific_date" ? (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={interactionLocked || action != null || confirmation != null}
        onClick={() =>
          openRemoval(
            family,
            rule.id,
            semanticRuleTitle(language, family, rule.title, rule.specificDate),
            t(language, scopeKey[rule.ruleType]),
          )
        }
      >
        {t(language, "calendar.manageDayRemoveRule")}
      </Button>
    ) : undefined;

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogContent
        maxWidth="920px"
        dir={language === "ar" ? "rtl" : "ltr"}
        className="text-start"
      >
        <DialogHeader
          showClose={!mutationPending}
          closeLabel={t(language, "common.dismiss")}
        >
          <div>
            <DialogTitle>{t(language, "calendar.manageDay")}</DialogTitle>
            <DialogDescription>
              {dateLabel} · {modalityLabel}
            </DialogDescription>
          </div>
        </DialogHeader>

        {context ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {published ? (
              <Badge variant="live">
                <span dir="ltr">
                  {t(language, "calendar.manageDayPublishedVersion", {
                    version: published.versionNo,
                  })}
                </span>
              </Badge>
            ) : (
              <Badge variant="neutral">
                {t(language, "calendar.manageDayNoPublishedPolicy")}
              </Badge>
            )}
            {context.policy.draft ? (
              <Badge variant="draft">
                <span dir="ltr">
                  {t(language, "calendar.manageDayDraftVersion", {
                    version: context.policy.draft.versionNo,
                  })}
                </span>
              </Badge>
            ) : null}
          </div>
        ) : null}

        {contextQuery.isLoading ? (
          <p className="py-4 text-sm text-muted-foreground">
            {t(language, "common.loading")}
          </p>
        ) : null}
        {contextQuery.isError ? (
          <Alert variant="error" role="alert">
            <AlertDescription>
              {t(language, "calendar.manageDayLoadError")}
            </AlertDescription>
            {!context ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={contextQuery.isFetching}
                onClick={() => {
                  void contextQuery.refetch();
                }}
              >
                {t(language, "common.tryAgain")}
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {feedback ? (
          <Alert variant="success" role="status">
            <AlertTitle>{feedback}</AlertTitle>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="error" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {mutationPending ? (
          <Alert variant="info">
            <AlertDescription>
              {t(language, "calendar.manageDayPublishing")}
            </AlertDescription>
          </Alert>
        ) : null}
        {isPastDate ? (
          <Alert variant="warning">
            <AlertTitle>
              {t(language, "calendar.manageDayHistoricalTitle")}
            </AlertTitle>
            <AlertDescription>
              {t(language, "calendar.manageDayHistoricalDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        {context?.modality.isActive === false ? (
          <Alert variant="warning">
            <AlertTitle>
              {t(language, "calendar.manageDayInactiveModalityTitle")}
            </AlertTitle>
            <AlertDescription>
              {t(language, "calendar.manageDayInactiveModalityDescription")}
            </AlertDescription>
          </Alert>
        ) : null}
        {contextRefreshing && !mutationPending ? (
          <Alert variant="info">
            <AlertDescription>
              {t(language, "calendar.manageDayRefreshing")}
            </AlertDescription>
          </Alert>
        ) : null}

        {context ? (
          <div className="mt-5 space-y-6">
            <section className="space-y-3">
              <Card variant="compact">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric
                    label={t(language, "calendar.manageDayDailyCapacity")}
                    value={
                      context.modality.dailyCapacity ??
                      t(language, "common.na")
                    }
                  />
                  <Metric
                    label={t(language, "calendar.manageDayActiveBookings")}
                    value={context.bookingSummary.bookedTotal}
                  />
                  <Metric
                    label={t(language, "calendar.oncologyLabel")}
                    value={context.bookingSummary.oncologyBooked}
                  />
                  <Metric
                    label={t(language, "calendar.nonOncologyLabel")}
                    value={context.bookingSummary.nonOncologyBooked}
                  />
                </div>
              </Card>
              <Alert
                variant={
                  context.bookingSummary.bookedTotal > 0 ? "warning" : "info"
                }
              >
                <AlertDescription>
                  {t(language, "calendar.manageDayExistingBookingsNotice")}
                </AlertDescription>
              </Alert>
              {context.policy.draft ? (
                <Alert variant="warning">
                  <AlertTitle>
                    {t(language, "calendar.manageDayDraftWarningTitle")}
                  </AlertTitle>
                  <AlertDescription>
                    {t(language, "calendar.manageDayDraftWarningDescription", {
                      version: context.policy.draft.versionNo,
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
            </section>

            <section className="space-y-3">
              <h4 className="text-base font-semibold text-foreground">
                {t(language, "calendar.manageDayRulesAffecting")}
              </h4>
              {context.effectiveRules.modalityBlocks.length +
                context.effectiveRules.examTypeRestrictions.length +
                context.effectiveRules.examMixQuotas.length ===
              0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(language, "calendar.manageDayNoEffectiveRules")}
                </p>
              ) : (
                <div className="space-y-2">
                  {context.effectiveRules.modalityBlocks.map((rule) => (
                    <Rule
                      key={`b${rule.id}`}
                      language={language}
                      title={semanticRuleTitle(
                        language,
                        "block_modality",
                        rule.title,
                        rule.specificDate,
                      )}
                      scope={t(language, scopeKey[rule.ruleType])}
                      inherited={rule.ruleType !== "specific_date"}
                      badges={
                        <>
                          <Badge variant="blocked" size="sm">
                            {t(language, "calendar.manageDayBlocked")}
                          </Badge>
                          <Badge
                            variant={
                              rule.isOverridable
                                ? "requires_override"
                                : "blocked"
                            }
                            size="sm"
                          >
                            {t(
                              language,
                              rule.isOverridable
                                ? "calendar.manageDaySupervisorOverride"
                                : "calendar.manageDayHardBlock",
                            )}
                          </Badge>
                        </>
                      }
                      notes={rule.notes}
                      action={removeControl("block_modality", rule)}
                    />
                  ))}
                  {context.effectiveRules.examTypeRestrictions.map((rule) => (
                    <Rule
                      key={`r${rule.id}`}
                      language={language}
                      title={semanticRuleTitle(
                        language,
                        "restrict_exam_types",
                        rule.title,
                        rule.specificDate,
                      )}
                      scope={t(language, scopeKey[rule.ruleType])}
                      inherited={rule.ruleType !== "specific_date"}
                      badges={
                        <Badge
                          variant={
                            rule.effectMode === "restriction_overridable"
                              ? "requires_override"
                              : "blocked"
                          }
                          size="sm"
                        >
                          {t(
                            language,
                            rule.effectMode === "restriction_overridable"
                              ? "calendar.manageDayOverridableRestrictionOption"
                              : "calendar.manageDayHardRestrictionOption",
                          )}
                        </Badge>
                      }
                      details={examTypeNames(language, rule.examTypes)}
                      notes={rule.notes}
                      action={removeControl("restrict_exam_types", rule)}
                    />
                  ))}
                  {context.effectiveRules.examMixQuotas.map((rule) => (
                    <Rule
                      key={`q${rule.id}`}
                      language={language}
                      title={semanticRuleTitle(
                        language,
                        "set_exam_mix_quota",
                        rule.title,
                        rule.specificDate,
                      )}
                      scope={t(language, scopeKey[rule.ruleType])}
                      inherited={rule.ruleType !== "specific_date"}
                      badges={
                        <Badge variant="restricted" size="sm">
                          {t(language, "calendar.manageDayExamMixQuota")}
                        </Badge>
                      }
                      details={
                        <>
                          {t(language, "calendar.manageDayDailyLimit")}: {" "}
                          <span dir="ltr">{rule.dailyLimit}</span> ·{" "}
                          {examTypeNames(language, rule.examTypes)}
                        </>
                      }
                      action={removeControl("set_exam_mix_quota", rule)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div>
                <h4 className="text-base font-semibold text-foreground">
                  {t(language, "calendar.manageDayGlobalPolicy")}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {t(language, "calendar.manageDayGlobalPolicyReadOnly")}
                </p>
              </div>
              {context.globalConstraints.categoryDailyLimits.length +
                context.globalConstraints.specialQuotas.length ===
                0 &&
              !context.globalConstraints.closedWeekday ? (
                <p className="text-sm text-muted-foreground">
                  {t(language, "calendar.manageDayNoGlobalConstraints")}
                </p>
              ) : (
                <div className="space-y-2">
                  {context.globalConstraints.categoryDailyLimits.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
                    >
                      <strong>
                        {`${t(
                          language,
                          rule.caseCategory === "oncology"
                            ? "calendar.oncologyLabel"
                            : "calendar.nonOncologyLabel",
                        )} · ${t(
                          language,
                          "calendar.manageDayDailyLimit",
                        )}`}
                      </strong>
                      <span className="text-sm" dir="ltr">
                        {rule.dailyLimit}
                      </span>
                    </div>
                  ))}
                  {context.globalConstraints.specialQuotas.map((rule) => (
                    <Rule
                      key={rule.id}
                      language={language}
                      title={
                        rule.title ||
                        t(language, "calendar.manageDaySpecialQuotaFallback")
                      }
                      badges={
                        <Badge variant="restricted" size="sm">
                          {t(language, "calendar.manageDaySpecialQuotaFallback")}
                        </Badge>
                      }
                      details={
                        <>
                          {t(language, "calendar.manageDayExtraSlots")}: {" "}
                          <span dir="ltr">{rule.dailyExtraSlots}</span>
                          {rule.examTypes.length
                            ? ` · ${examTypeNames(language, rule.examTypes)}`
                            : ""}
                        </>
                      }
                    />
                  ))}
                  {context.globalConstraints.closedWeekday ? (
                    <Alert variant="warning">
                      <AlertDescription>
                        {t(language, "calendar.manageDayClosedWeekday", {
                          weekday: context.globalConstraints.closedWeekday,
                        })}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
              )}
            </section>

            {!action && !removeTarget && !confirmation ? (
              <section className="space-y-3">
                <h4 className="text-base font-semibold text-foreground">
                  {t(language, "calendar.manageDayDayRuleTypes")}
                </h4>
                <Card className="divide-y divide-border">
                  {context.supportedDayRuleTypes.map((type) => {
                    const item = capability(language, type);
                    return (
                      <div
                        key={type}
                        className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <h5 className="font-medium text-foreground">
                            {item.title}
                          </h5>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {item.help}
                          </p>
                        </div>
                        <Button
                          type="button"
                          aria-label={item.title}
                          disabled={interactionLocked}
                          onClick={() => openAction(type)}
                        >
                          {item.title}
                        </Button>
                      </div>
                    );
                  })}
                </Card>
              </section>
            ) : null}

            {confirmation ? (
              <Review
                language={language}
                confirmation={confirmation}
                context={context}
                modalityLabel={modalityLabel}
                dateLabel={dateLabel}
                reason={reason}
                examTypeIds={examTypeIds}
                isOverridable={isOverridable}
                effectMode={effectMode}
                dailyLimit={dailyLimit}
                removeTarget={removeTarget}
                interactionWarnings={interactionWarnings}
                mutationPending={mutationPending}
                interactionLocked={interactionLocked}
                onBack={() => {
                  if (!mutationPending) setConfirmation(null);
                }}
                onPublish={publishConfirmedChange}
              />
            ) : (
              <>
                {action ? (
                  <Form
                    action={action}
                    language={language}
                    context={context}
                    modalityLabel={modalityLabel}
                    dateLabel={dateLabel}
                    reason={reason}
                    setReason={setReason}
                    examTypeIds={examTypeIds}
                    setExamTypeIds={setExamTypeIds}
                    toggle={toggle}
                    examSearch={examSearch}
                    setExamSearch={setExamSearch}
                    isOverridable={isOverridable}
                    setIsOverridable={setIsOverridable}
                    effectMode={effectMode}
                    setEffectMode={setEffectMode}
                    dailyLimit={dailyLimit}
                    setDailyLimit={setDailyLimit}
                    pending={mutationPending}
                    interactionLocked={interactionLocked}
                    interactionWarnings={interactionWarnings}
                    onCancel={cancelEditor}
                    onSubmit={submit}
                  />
                ) : null}
                {removeTarget ? (
                  <Card className="space-y-4">
                    <div>
                      <h4 className="text-base font-semibold text-foreground">
                        {t(language, "calendar.manageDayReviewRemoveRule")}
                      </h4>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {removeTarget.title}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {dateLabel} · {removeTarget.scope}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(language, "calendar.manageDayRemoveRuleHelp")}
                      </p>
                    </div>
                    <Reason
                      language={language}
                      value={reason}
                      onChange={setReason}
                      disabled={mutationPending}
                    />
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={mutationPending}
                        onClick={cancelEditor}
                      >
                        {t(language, "common.cancel")}
                      </Button>
                      <Button
                        type="button"
                        disabled={interactionLocked}
                        onClick={submitRemoval}
                      >
                        {t(language, "calendar.manageDayReviewRemovalStep")}
                      </Button>
                    </DialogFooter>
                  </Card>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  action,
  language,
  context,
  modalityLabel,
  dateLabel,
  reason,
  setReason,
  examTypeIds,
  setExamTypeIds,
  toggle,
  examSearch,
  setExamSearch,
  isOverridable,
  setIsOverridable,
  effectMode,
  setEffectMode,
  dailyLimit,
  setDailyLimit,
  pending,
  interactionLocked,
  interactionWarnings,
  onCancel,
  onSubmit,
}: {
  action: Exclude<Action, null>;
  language: "ar" | "en";
  context: DayManagementContextDto;
  modalityLabel: string;
  dateLabel: string;
  reason: string;
  setReason: (value: string) => void;
  examTypeIds: number[];
  setExamTypeIds: (ids: number[]) => void;
  toggle: (id: number) => void;
  examSearch: string;
  setExamSearch: (value: string) => void;
  isOverridable: boolean;
  setIsOverridable: (value: boolean) => void;
  effectMode: "hard_restriction" | "restriction_overridable";
  setEffectMode: (
    value: "hard_restriction" | "restriction_overridable",
  ) => void;
  dailyLimit: string;
  setDailyLimit: (value: string) => void;
  pending: boolean;
  interactionLocked: boolean;
  interactionWarnings: InteractionWarning[];
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const capacity = context.modality.dailyCapacity;
  const searchTerm = examSearch.trim().toLowerCase();
  const filteredExamTypes = context.examTypeOptions.filter((exam) => {
    const displayedName =
      chooseLocalized(language, exam.nameAr, exam.nameEn) ||
      exam.name ||
      t(language, "common.na");
    return !searchTerm || displayedName.toLowerCase().includes(searchTerm);
  });

  return (
    <Card className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">
          {capability(language, action).title}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {capability(language, action).help}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {modalityLabel} · {dateLabel}
        </p>
      </div>

      {action === "block_modality" ? (
        <label className="flex items-center gap-2">
          <Checkbox
            checked={isOverridable}
            disabled={pending}
            onChange={(event) => setIsOverridable(event.target.checked)}
          />
          <span>{t(language, "calendar.manageDayAllowSupervisorOverride")}</span>
        </label>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">
              {t(language, "calendar.manageDaySelectExamTypes")}
            </legend>
            <div className="space-y-1">
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="manage-day-exam-search"
              >
                {t(language, "calendar.manageDaySearchExamTypes")}
              </label>
              <Input
                id="manage-day-exam-search"
                placeholder={t(
                  language,
                  "calendar.manageDaySearchExamTypesPlaceholder",
                )}
                value={examSearch}
                disabled={pending}
                onChange={(event) => setExamSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {t(language, "calendar.manageDaySelectedExamCount", {
                  count: examTypeIds.length,
                })}
              </p>
              {examTypeIds.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setExamTypeIds([])}
                >
                  {t(language, "calendar.manageDayClearSelection")}
                </Button>
              ) : null}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
              {filteredExamTypes.length > 0 ? (
                filteredExamTypes.map((exam) => (
                  <label
                    key={exam.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2"
                  >
                    <Checkbox
                      checked={examTypeIds.includes(exam.id)}
                      disabled={pending}
                      onChange={() => toggle(exam.id)}
                    />
                    <span>
                      {chooseLocalized(language, exam.nameAr, exam.nameEn) ||
                        exam.name}
                    </span>
                  </label>
                ))
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">
                  {t(language, "calendar.manageDayNoExamSearchResults")}
                </p>
              )}
            </div>
          </fieldset>
          {action === "restrict_exam_types" ? (
            <div className="space-y-2">
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="manage-day-restriction-mode"
              >
                {t(language, "calendar.manageDayRestrictionMode")}
              </label>
              <select
                id="manage-day-restriction-mode"
                className="input-premium"
                disabled={pending}
                value={effectMode}
                onChange={(event) =>
                  setEffectMode(
                    event.target.value as
                      | "hard_restriction"
                      | "restriction_overridable",
                  )
                }
              >
                <option value="hard_restriction">
                  {t(language, "calendar.manageDayHardRestrictionOption")}
                </option>
                <option value="restriction_overridable">
                  {t(language, "calendar.manageDayOverridableRestrictionOption")}
                </option>
              </select>
              <p className="text-sm text-muted-foreground">
                {t(
                  language,
                  effectMode === "hard_restriction"
                    ? "calendar.manageDayHardRestrictionHelp"
                    : "calendar.manageDayOverridableRestrictionHelp",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="manage-day-quota-limit"
              >
                {t(language, "calendar.manageDayQuotaLimit")}
              </label>
              <Input
                id="manage-day-quota-limit"
                type="number"
                disabled={pending}
                min={1}
                max={capacity && capacity > 0 ? capacity : undefined}
                value={dailyLimit}
                onChange={(event) => setDailyLimit(event.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                {t(language, "calendar.manageDayQuotaHelp")}
              </p>
              {capacity && capacity > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t(language, "calendar.manageDayModalityCapacity", {
                    capacity,
                  })}
                </p>
              ) : null}
            </div>
          )}
        </>
      )}

      <InteractionWarnings warnings={interactionWarnings} />
      <Reason
        language={language}
        value={reason}
        onChange={setReason}
        disabled={pending}
      />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onCancel}
        >
          {t(language, "common.cancel")}
        </Button>
        <Button
          type="button"
          disabled={interactionLocked}
          onClick={onSubmit}
        >
          {t(language, "calendar.manageDayReviewChangeStep")}
        </Button>
      </DialogFooter>
    </Card>
  );
}

function Review({
  language,
  confirmation,
  context,
  modalityLabel,
  dateLabel,
  reason,
  examTypeIds,
  isOverridable,
  effectMode,
  dailyLimit,
  removeTarget,
  interactionWarnings,
  mutationPending,
  interactionLocked,
  onBack,
  onPublish,
}: {
  language: "ar" | "en";
  confirmation: Exclude<ConfirmationState, null>;
  context: DayManagementContextDto;
  modalityLabel: string;
  dateLabel: string;
  reason: string;
  examTypeIds: number[];
  isOverridable: boolean;
  effectMode: "hard_restriction" | "restriction_overridable";
  dailyLimit: string;
  removeTarget: RemoveTarget;
  interactionWarnings: InteractionWarning[];
  mutationPending: boolean;
  interactionLocked: boolean;
  onBack: () => void;
  onPublish: () => void;
}) {
  const selectedExamTypes =
    examTypeNames(
      language,
      context.examTypeOptions.filter((exam) => examTypeIds.includes(exam.id)),
    ) || t(language, "common.na");
  const change =
    confirmation.kind === "remove"
      ? t(language, "calendar.manageDayReviewRemoveRule")
      : capability(language, confirmation.action).title;

  return (
    <Card className="space-y-4">
      <div>
        <h4 className="text-base font-semibold text-foreground">
          {t(language, "calendar.manageDayReviewTitle")}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(language, "calendar.manageDayReviewDescription")}
        </p>
      </div>
      <Alert variant="warning">
        <AlertDescription>
          {t(language, "calendar.manageDayImmediateEffect")}
        </AlertDescription>
      </Alert>
      <p className="text-sm text-muted-foreground">
        {t(language, "calendar.manageDayExistingBookingsUnaffected")}
      </p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <ReviewField
          label={t(language, "calendar.manageDayReviewChange")}
          value={change}
        />
        <ReviewField
          label={t(language, "calendar.manageDayReviewModality")}
          value={modalityLabel}
        />
        <ReviewField
          label={t(language, "calendar.manageDayReviewDate")}
          value={dateLabel}
        />
        <ReviewField
          label={t(language, "calendar.manageDayReviewActiveBookings")}
          value={context.bookingSummary.bookedTotal}
        />
        <ReviewField
          label={t(language, "calendar.manageDayReviewOncology")}
          value={context.bookingSummary.oncologyBooked}
        />
        <ReviewField
          label={t(language, "calendar.manageDayReviewNonOncology")}
          value={context.bookingSummary.nonOncologyBooked}
        />
        <ReviewField
          label={t(language, "calendar.manageDayReviewReason")}
          value={reason.trim()}
        />
        {confirmation.kind === "remove" ? (
          <ReviewField
            label={t(language, "calendar.manageDayReviewRule")}
            value={removeTarget?.title || t(language, "common.na")}
          />
        ) : confirmation.action === "block_modality" ? (
          <ReviewField
            label={t(language, "calendar.manageDayReviewSupervisorOverride")}
            value={t(
              language,
              isOverridable
                ? "calendar.manageDayOverrideAllowed"
                : "calendar.manageDayOverrideNotAllowed",
            )}
          />
        ) : (
          <>
            <ReviewField
              label={t(language, "calendar.manageDayReviewExamTypes")}
              value={selectedExamTypes}
            />
            {confirmation.action === "restrict_exam_types" ? (
              <ReviewField
                label={t(language, "calendar.manageDayReviewRestrictionMode")}
                value={t(
                  language,
                  effectMode === "hard_restriction"
                    ? "calendar.manageDayHardRestrictionOption"
                    : "calendar.manageDayOverridableRestrictionOption",
                )}
              />
            ) : (
              <ReviewField
                label={t(language, "calendar.manageDayReviewDailyLimit")}
                value={Number(dailyLimit.trim())}
              />
            )}
          </>
        )}
      </dl>
      <InteractionWarnings warnings={interactionWarnings} />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          disabled={mutationPending}
          onClick={onBack}
        >
          {t(language, "calendar.manageDayBackToEdit")}
        </Button>
        <Button
          type="button"
          variant={confirmation.kind === "remove" ? "destructive" : "primary"}
          disabled={interactionLocked}
          onClick={onPublish}
        >
          {t(
            language,
            confirmation.kind === "remove"
              ? "calendar.manageDayRemoveAndPublish"
              : "calendar.manageDayPublishChange",
          )}
        </Button>
      </DialogFooter>
    </Card>
  );
}

function ReviewField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium text-foreground">{value}</dd>
    </div>
  );
}

function InteractionWarnings({ warnings }: { warnings: InteractionWarning[] }) {
  if (!warnings.length) return null;

  return (
    <div className="space-y-2">
      {warnings.map((warning, index) => (
        <Alert key={`${warning.description}-${index}`} variant="warning">
          {warning.title ? <AlertTitle>{warning.title}</AlertTitle> : null}
          <AlertDescription>{warning.description}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function Reason({
  language,
  value,
  onChange,
  disabled = false,
}: {
  language: "ar" | "en";
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label
        className="block text-sm font-medium text-foreground"
        htmlFor="manage-day-reason"
      >
        {t(language, "calendar.manageDayReason")}
      </label>
      <Textarea
        id="manage-day-reason"
        required
        disabled={disabled}
        value={value}
        placeholder={t(language, "calendar.manageDayReasonPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md bg-muted/60 p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className="mt-1 text-xl font-semibold tabular-nums text-foreground"
        dir="ltr"
      >
        {value}
      </p>
    </div>
  );
}

function Rule({
  language,
  title,
  scope,
  inherited = false,
  badges,
  details,
  notes,
  action,
}: {
  language: "ar" | "en";
  title: string;
  scope?: string;
  inherited?: boolean;
  badges?: ReactNode;
  details?: ReactNode;
  notes?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-foreground">{title}</strong>
            {badges}
          </div>
          {scope || inherited ? (
            <div className="flex flex-wrap items-center gap-2">
              {scope ? (
                <Badge variant="neutral" size="sm">
                  {scope}
                </Badge>
              ) : null}
              {inherited ? (
                <Badge variant="neutral" size="sm">
                  {t(language, "calendar.manageDayInheritedRule")}
                </Badge>
              ) : null}
            </div>
          ) : null}
          {details ? (
            <p className="text-sm text-muted-foreground">{details}</p>
          ) : null}
          {inherited ? (
            <p className="text-sm text-muted-foreground">
              {t(language, "calendar.manageDayManagedInSchedulingAdmin")}
            </p>
          ) : null}
          {notes ? (
            <p className="text-sm text-muted-foreground">{notes}</p>
          ) : null}
        </div>
        {action}
      </div>
    </div>
  );
}
