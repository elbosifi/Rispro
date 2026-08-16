import type { OrthancStudyDetails } from "../../services/authoritative-orthanc-service.js";
import type { ProtocolingPatientHistoryItem } from "./protocoling-types.js";

export type RisproHistoryRow = Omit<ProtocolingPatientHistoryItem, "orthancStudyId" | "source" | "modalities"> & { modalityCode: string | null };
const clean = (value: string | null | undefined) => value?.trim() || null;
const modalities = (...values: Array<string | null | undefined>) => [...new Set(values.flatMap((value) => (value || "").split("\\").map((entry) => entry.trim().toUpperCase() === "MR" ? "MRI" : entry.trim().toUpperCase()).filter(Boolean)))];
const studyDate = (value: string | null) => {
  const raw = clean(value);
  const match = raw?.match(/^\d{8}$/) ? [raw, raw!.slice(0, 4), raw!.slice(4, 6), raw!.slice(6, 8)] : raw?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? `${year}-${month}-${day}` : null;
};

export function reconcileProtocolingPatientHistory(rispro: RisproHistoryRow[], pacs: OrthancStudyDetails[], currentAccessionNumber: string | null): ProtocolingPatientHistoryItem[] {
  const current = clean(currentAccessionNumber);
  const usablePacs = pacs.filter((study) => clean(study.accessionNumber) !== current);
  const counts = new Map<string, number>();
  for (const study of usablePacs) { const accession = clean(study.accessionNumber); if (accession) counts.set(accession, (counts.get(accession) || 0) + 1); }
  const consumed = new Set<string>();
  const items: ProtocolingPatientHistoryItem[] = rispro.map((row) => {
    const accession = clean(row.accessionNumber);
    const match = accession && counts.get(accession) === 1 ? usablePacs.find((study) => clean(study.accessionNumber) === accession) : undefined;
    if (match) consumed.add(match.orthancStudyId);
    return { appointmentId: row.appointmentId, orthancStudyId: match?.orthancStudyId ?? null, accessionNumber: accession, date: row.date, time: row.time, modalities: modalities(row.modalityCode, ...(match?.modalitiesInStudy || [])), description: row.description, appointmentStatus: row.appointmentStatus, reportAvailable: row.reportAvailable, source: match ? "rispro_pacs" as const : "rispro_only" as const };
  });
  for (const study of usablePacs) if (!consumed.has(study.orthancStudyId)) items.push({ appointmentId: null, orthancStudyId: study.orthancStudyId, accessionNumber: clean(study.accessionNumber), date: studyDate(study.studyDate), time: null, modalities: modalities(...study.modalitiesInStudy), description: clean(study.studyDescription), appointmentStatus: null, reportAvailable: false, source: "pacs_only" });
  return items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.time || "").localeCompare(a.time || "") || `${a.accessionNumber || ""}\u0000${a.orthancStudyId || ""}`.localeCompare(`${b.accessionNumber || ""}\u0000${b.orthancStudyId || ""}`));
}
