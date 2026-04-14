import { useMemo } from "react";
import { useV2Availability } from "../api";
import { mapAvailabilityRow } from "./availability-row-mapper";
export type { AvailabilityRowStatus, AvailabilityRowViewModel } from "./availability-row-mapper";

interface UseAppointmentAvailabilityArgs {
  patientId: number | null;
  modalityId: number | null;
  examTypeId: number | null;
  caseCategory: "oncology" | "non_oncology";
  useSpecialQuota: boolean;
  specialReasonCode: string | null;
  days?: number;
}

export function useAppointmentAvailability(args: UseAppointmentAvailabilityArgs) {
  const enabled = args.patientId != null && args.modalityId != null && args.examTypeId != null;

  const query = useV2Availability(
    enabled
      ? {
          modalityId: args.modalityId as number,
          days: args.days ?? 14,
          offset: 0,
          examTypeId: args.examTypeId,
          caseCategory: args.caseCategory,
          useSpecialQuota: args.useSpecialQuota,
          specialReasonCode: args.specialReasonCode,
          includeOverrideCandidates: true,
        }
      : undefined
  );

  const rows = useMemo(() => {
    if (!enabled) return [];
    return (query.data?.items ?? []).map(mapAvailabilityRow);
  }, [enabled, query.data?.items]);

  return {
    enabled,
    rows,
    rawItems: query.data?.items ?? [],
    isLoading: enabled ? query.isLoading : false,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}
