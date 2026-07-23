export function formatV2AccessionNumber(bookingId: number | string): string {
  const id = Number(bookingId);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("bookingId must be a non-negative integer.");
  }
  return `V2-${String(id).padStart(6, "0")}`;
}

const V2_ACCESSION = /^V2-\d{6,}$/i;

export function normalizeV2AccessionNumber(candidate: string): string | null {
  const normalized = candidate.replace(/\s+/g, "").toUpperCase();
  return V2_ACCESSION.test(normalized) ? normalized : null;
}
