function buildRadiantTagUrl(tag: string, value: string): string {
  return `radiant://?n=pstv&v=${encodeURIComponent(tag)}&v=${encodeURIComponent(`"${value}"`)}`;
}

export function buildRadiantStudyUrl(input: {
  studyInstanceUid?: string | null;
  accessionNumber?: string | null;
}): string | null {
  const studyInstanceUid = input.studyInstanceUid?.trim();
  if (studyInstanceUid) return buildRadiantTagUrl("0020000D", studyInstanceUid);

  const accessionNumber = input.accessionNumber?.trim();
  if (accessionNumber) return buildRadiantTagUrl("00080050", accessionNumber);

  return null;
}

export function buildRadiantPatientUrl(patientDicomId: string | null | undefined): string | null {
  const trimmedPatientDicomId = patientDicomId?.trim();
  if (!trimmedPatientDicomId) return null;
  return buildRadiantTagUrl("00100020", trimmedPatientDicomId);
}
