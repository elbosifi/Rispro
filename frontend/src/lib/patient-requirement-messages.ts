import { ApiError } from "@/lib/api-client";
import type { TranslationKey } from "@/lib/i18n";

const PHONE_REQUIRED = "patient_phone_required";
const IDENTIFIER_REQUIRED = "patient_primary_identifier_required";

function hasCode(reasonCodes: readonly string[], code: string): boolean {
  return reasonCodes.includes(code);
}

export function getPatientRequirementReasonCodes(error: unknown): string[] {
  if (error instanceof ApiError) {
    return error.reasonCodes;
  }

  const record = error as { reasonCodes?: unknown; details?: { reasonCodes?: unknown } } | null;
  if (Array.isArray(record?.reasonCodes)) {
    return record.reasonCodes.filter((code): code is string => typeof code === "string");
  }
  if (Array.isArray(record?.details?.reasonCodes)) {
    return record.details.reasonCodes.filter((code): code is string => typeof code === "string");
  }
  return [];
}

export function getPatientRequirementStaffMessageKey(reasonCodes: readonly string[]): TranslationKey | null {
  const phoneRequired = hasCode(reasonCodes, PHONE_REQUIRED);
  const identifierRequired = hasCode(reasonCodes, IDENTIFIER_REQUIRED);

  if (phoneRequired && identifierRequired) return "queue.requirements.staffPhoneAndIdentifierRequired";
  if (phoneRequired) return "queue.requirements.staffPhoneRequired";
  if (identifierRequired) return "queue.requirements.staffIdentifierRequired";
  return null;
}

export function getPatientRequirementCheckInMessageKey(reasonCodes: readonly string[]): TranslationKey | null {
  const phoneRequired = hasCode(reasonCodes, PHONE_REQUIRED);
  const identifierRequired = hasCode(reasonCodes, IDENTIFIER_REQUIRED);

  if (phoneRequired && identifierRequired) return "queue.requirements.checkInPhoneAndIdentifierRequired";
  if (phoneRequired) return "queue.requirements.checkInPhoneRequired";
  if (identifierRequired) return "queue.requirements.checkInIdentifierRequired";
  return null;
}

export function getPatientRequirementStaffMessage(error: unknown, translate: (key: TranslationKey) => string): string | null {
  const key = getPatientRequirementStaffMessageKey(getPatientRequirementReasonCodes(error));
  return key ? translate(key) : null;
}

export function getPatientRequirementCheckInMessage(error: unknown, translate: (key: TranslationKey) => string): string | null {
  const key = getPatientRequirementCheckInMessageKey(getPatientRequirementReasonCodes(error));
  return key ? translate(key) : null;
}
