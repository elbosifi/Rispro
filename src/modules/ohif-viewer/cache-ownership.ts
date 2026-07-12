export function normalizeOrthancStudyIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))].sort();
}

/**
 * A shared Orthanc cache can contain a study with the same DICOM UID before
 * RISpro asks for C-MOVE. Only a single resource that appears after the
 * request, and was absent from the pre-retrieval snapshot, is safe to mark as
 * owned by this retrieval job.
 */
export function determineOwnedOrthancCacheStudyId(input: {
  preexistingStudyIds: unknown;
  discoveredStudyIds: unknown;
}): string | null {
  const previous = new Set(normalizeOrthancStudyIds(input.preexistingStudyIds));
  const created = normalizeOrthancStudyIds(input.discoveredStudyIds).filter((id) => !previous.has(id));
  return created.length === 1 ? created[0] : null;
}

export function canDeleteOwnedOrthancCacheStudy(input: {
  cleanupEnabled: boolean;
  cacheOwnershipProven: boolean;
  ownedOrthancStudyId: string | null;
}): boolean {
  return input.cleanupEnabled && input.cacheOwnershipProven && Boolean(String(input.ownedOrthancStudyId || "").trim());
}

export async function deleteOwnedOrthancCacheStudyIfEligible(input: {
  cleanupEnabled: boolean;
  cacheOwnershipProven: boolean;
  ownedOrthancStudyId: string | null;
  deleteExactStudy: (orthancStudyId: string) => Promise<void>;
}): Promise<boolean> {
  if (!canDeleteOwnedOrthancCacheStudy(input)) return false;
  await input.deleteExactStudy(String(input.ownedOrthancStudyId));
  return true;
}
