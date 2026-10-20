import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  LoadingState,
} from "@/components/shared";
import { createDoctorRosterWeek, fetchDoctorRosterWeek } from "@/lib/api-hooks";
import type { DoctorRosterWeek } from "@/types/api";
import { useLanguage } from "@/providers/language-provider";
import {
  addRosterDays,
  nextRosterRange,
  preferredRosterSource,
  previewRosterDate,
} from "./roster-board-utils";

export function RosterCreateDialog({
  weeks,
  onClose,
  onCreated,
}: {
  weeks: DoctorRosterWeek[];
  onClose: () => void;
  onCreated: (start: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [range, setRange] = useState(nextRosterRange);
  const [step, setStep] = useState<"dates" | "source">("dates");
  const [mode, setMode] = useState<"last" | "saved" | "blank">("blank");
  const [sourceId, setSourceId] = useState("");
  const [structureOnly, setStructureOnly] = useState(false);
  const suitable = weeks.filter((week) => week.weekStartDate !== range.start);
  const lastStart = addRosterDays(range.start, -7);
  const lastWeek = suitable.find((week) => week.weekStartDate === lastStart);
  const selected =
    mode === "last"
      ? lastWeek
      : suitable.find(
          (week) =>
            String(week.id) ===
            (sourceId ||
              String(
                (
                  preferredRosterSource(weeks, range.start) ??
                  suitable.find((week) => week.status === "published") ??
                  suitable[0]
                )?.id ?? "",
              )),
        );
  const source = useQuery({
    queryKey: ["doctor", "roster", "source", selected?.id],
    queryFn: () => fetchDoctorRosterWeek(selected!.weekStartDate),
    enabled: step === "source" && mode !== "blank" && Boolean(selected),
  });
  const create = useMutation({
    mutationFn: () =>
      createDoctorRosterWeek({
        weekStartDate: range.start,
        weekEndDate: range.end,
        sourceRosterWeekId: mode === "blank" ? undefined : Number(selected!.id),
        structureOnly,
      }),
    onSuccess: async () => {
      await onCreated(range.start);
      onClose();
    },
  });
  const valid = Boolean(range.start && range.end && range.end >= range.start);
  const alreadyExists = weeks.some(
    (week) => week.weekStartDate === range.start,
  );
  const preview = (source.data?.assignments ?? [])
    .filter((row) => row.status === "active")
    .map((row) => ({
      ...row,
      targetDate:
        row.date >= selected!.weekStartDate && row.date <= selected!.weekEndDate
          ? previewRosterDate(
              row.date,
              selected!.weekStartDate,
              range.start,
              range.end,
            )
          : null,
    }));
  return (
    <Dialog
      open
      onClose={() => {
        if (!create.isPending) onClose();
      }}
    >
      <DialogContent maxWidth="560px" aria-labelledby="roster-create-title">
        <DialogHeader closeLabel={t("roster.close")}>
          <DialogTitle id="roster-create-title">
            {t("roster.create")}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "dates") setStep("source");
            else create.mutate();
          }}
          className="space-y-4"
        >
          {step === "dates" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {t("roster.datesHelp")}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  {t("roster.start")}
                  <Input
                    required
                    type="date"
                    value={range.start}
                    onChange={(event) =>
                      setRange((current) => ({
                        ...current,
                        start: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="text-sm">
                  {t("roster.end")}
                  <Input
                    required
                    type="date"
                    min={range.start}
                    value={range.end}
                    onChange={(event) =>
                      setRange((current) => ({
                        ...current,
                        end: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              {alreadyExists && <p role="alert">{t("roster.exists")}</p>}
            </>
          ) : (
            <>
              <p className="text-sm font-medium" dir="ltr">
                {range.start} – {range.end}
              </p>
              <fieldset className="space-y-3">
                <legend className="mb-3 font-semibold">
                  {t("roster.startExisting")}
                </legend>
                {(["last", "saved", "blank"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 rounded-lg border p-3"
                    style={{
                      borderColor:
                        mode === value ? "var(--accent)" : "var(--border)",
                    }}
                  >
                    <input
                      type="radio"
                      name="source-mode"
                      checked={mode === value}
                      onChange={() => setMode(value)}
                      disabled={value === "last" && !lastWeek}
                    />
                    {t(`roster.source.${value}`)}
                  </label>
                ))}
              </fieldset>
              {!lastWeek && (
                <p className="text-xs text-muted-foreground">
                  {t("roster.noLastWeek")}
                </p>
              )}
              {mode === "saved" && (
                <label className="block text-sm">
                  {t("roster.savedSource")}
                  <select
                    aria-label={t("roster.savedSource")}
                    className="input-premium mt-1 w-full"
                    value={selected?.id ?? ""}
                    onChange={(event) => setSourceId(event.target.value)}
                  >
                    <option value="" disabled>
                      {t("roster.chooseSource")}
                    </option>
                    {suitable.map((week) => (
                      <option key={week.id} value={week.id}>
                        {week.weekStartDate} – {week.weekEndDate} ·{" "}
                        {t(`roster.status.${week.status}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {mode !== "blank" && (
                <>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={structureOnly}
                      onChange={(event) =>
                        setStructureOnly(event.target.checked)
                      }
                    />
                    {t("roster.structureOnly")}
                  </label>
                  {source.isLoading ? (
                    <LoadingState message={t("roster.loading")} />
                  ) : source.isError ? (
                    <p role="alert">
                      {t("roster.loadError")}{" "}
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => source.refetch()}
                      >
                        {t("roster.retry")}
                      </Button>
                    </p>
                  ) : (
                    selected && (
                      <div
                        className="max-h-48 overflow-y-auto rounded-lg border p-3 text-sm"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <p className="font-semibold">
                          {t("roster.preview", {
                            copied: preview.filter((row) => row.targetDate)
                              .length,
                            excluded: preview.filter((row) => !row.targetDate)
                              .length,
                          })}
                        </p>
                        {preview.map((row) => (
                          <p key={row.id} className="mt-2 break-words">
                            {row.teamName} · {row.date} →{" "}
                            {row.targetDate ?? t("roster.excluded")}
                            {!structureOnly && row.targetDate
                              ? ` · ${t("roster.doctorCount", { count: row.members.length })}`
                              : ""}
                          </p>
                        ))}
                      </div>
                    )
                  )}
                </>
              )}
            </>
          )}
          {create.isError && (
            <p role="alert" className="text-sm" style={{ color: "var(--red)" }}>
              {t("roster.createError")}
            </p>
          )}
          <DialogFooter
            style={{
              position: "sticky",
              bottom: 0,
              background: "var(--background)",
              paddingTop: 12,
            }}
          >
            <Button
              type="button"
              variant="secondary"
              disabled={create.isPending}
              onClick={() => (step === "source" ? setStep("dates") : onClose())}
            >
              {t(step === "source" ? "roster.back" : "roster.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                !valid ||
                alreadyExists ||
                create.isPending ||
                (step === "source" &&
                  mode !== "blank" &&
                  (!selected || !source.isSuccess))
              }
            >
              {t(
                create.isPending
                  ? "roster.saving"
                  : step === "dates"
                    ? "roster.continue"
                    : "roster.createDraft",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
