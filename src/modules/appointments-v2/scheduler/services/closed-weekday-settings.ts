import type { PoolClient } from "pg";

export type ClosedWeekday = "friday" | "saturday";

function normalizeSettingToggle(value: unknown, fallbackEnabled: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "enabled" || normalized === "true" || normalized === "1") return true;
  if (normalized === "disabled" || normalized === "false" || normalized === "0") return false;
  return fallbackEnabled;
}

export function weekdayNameFromIsoDate(isoDate: string): ClosedWeekday | "other" {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  if (day === 5) return "friday";
  if (day === 6) return "saturday";
  return "other";
}

export async function loadClosedWeekdays(client: PoolClient): Promise<ClosedWeekday[]> {
  const { rows } = await client.query<{ setting_key: string; setting_value: unknown }>(
    `
      select setting_key, setting_value
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key in (
          'allow_friday_appointments',
          'allow_saturday_appointments'
        )
    `
  );

  const valuesByKey = rows.reduce<Record<string, unknown>>((accumulator, row) => {
    const raw = row.setting_value;
    const nestedValue =
      raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
        ? (raw as Record<string, unknown>).value
        : raw;
    accumulator[row.setting_key] = nestedValue;
    return accumulator;
  }, {});

  const disabled: ClosedWeekday[] = [];
  if (!normalizeSettingToggle(valuesByKey.allow_friday_appointments, true)) disabled.push("friday");
  if (!normalizeSettingToggle(valuesByKey.allow_saturday_appointments, true)) disabled.push("saturday");
  return disabled;
}

