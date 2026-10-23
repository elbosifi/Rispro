export const PROTOCOL_DICTATION_FIELDS = {
  freeTextProtocol: "Free-text protocol",
  protocolNotes: "Patient-specific instructions",
  contrastNotes: "Contrast/preparation instructions",
};
export type ProtocolDictationField = keyof typeof PROTOCOL_DICTATION_FIELDS;
export type ProtocolDictationTarget = { field: ProtocolDictationField; appointmentId: number; selection: { start: number; end: number; value: string } | null };
