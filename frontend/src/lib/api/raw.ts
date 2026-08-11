export type RawRecord = Record<string, unknown>;

export function rawString(value: unknown): string | null {
  return value == null ? null : String(value);
}

export function rawNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}

export function rawBool(value: unknown): boolean {
  return Boolean(value);
}

export function rawArray(value: unknown): RawRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is RawRecord => Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
}
