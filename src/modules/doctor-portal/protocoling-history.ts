import type { OrthancStudyDetails } from "../../services/authoritative-orthanc-service.js";
import type { ProtocolingPatientHistoryItem } from "./protocoling-types.js";

export type RisproHistoryRow = Omit<ProtocolingPatientHistoryItem, "orthancStudyId" | "source" | "modalities"> & { modalityCode: string | null };
const clean = (value: string | null | undefined) => value?.trim() || null;
const modalities = (...values: Array<string | null | undefined>) => [...new Set(values.flatMap((value) => (value || "").split("\\").map((entry) => entry.trim().toUpperCase() === "MR" ? "MRI" : entry.trim().toUpperCase()).filter(Boolean)))];
const studyDate = (value: string | null) => value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : clean(value);

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
  return items.sort((a, b) => `${b.date || ""}\u0000${b.time || ""}\u0000${b.accessionNumber || ""}\u0000${b.orthancStudyId || ""}`.localeCompare(`${a.date || ""}\u0000${a.time || ""}\u0000${a.accessionNumber || ""}\u0000${a.orthancStudyId || ""}`));
}
