export function formatV2AccessionNumber(bookingId: number | string): string {
  const id = Number(bookingId);
  if (!Number.isInteger(id) || id < 0) {
    throw new Error("bookingId must be a non-negative integer.");
  }
  return `V2-${String(id).padStart(6, "0")}`;
}
