import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import RequestScansPage from "@/pages/request-scans/request-scans-page";
import { fetchAppointmentLookups } from "@/lib/api-hooks";
import { chooseLocalized } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { AppointmentLookups } from "@/types/api";
import { ErrorState, LoadingState } from "@/components/shared";
import { api } from "@/lib/api-client";

export default function DocumentIngestionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language } = useLanguage();
  const modalityId = Number(searchParams.get("modalityId"));
  const lookups = useQuery<AppointmentLookups>({ queryKey: ["lookups"], queryFn: fetchAppointmentLookups, staleTime: 300_000 });
  const orthanc = useQuery<{ state: "connected" | "disabled" | "unavailable" }>({ queryKey: ["authoritative-orthanc", "status"], queryFn: () => api("/integrations/authoritative-orthanc/status"), retry: false, staleTime: 30_000 });
  if (lookups.isLoading) return <LoadingState />;
  const modality = Number.isSafeInteger(modalityId) && modalityId > 0
    ? lookups.data?.modalities.find((item) => item.id === modalityId && item.isActive)
    : null;
  if (!modality) return <ErrorState message={chooseLocalized(language, "اختر جهازاً صالحاً من قائمة عمل الأجهزة.", "Select a valid modality from the Modality Worklist.")} />;
  const name = chooseLocalized(language, modality.nameAr, modality.nameEn) || modality.code || `Modality ${modality.id}`;
  return <RequestScansPage modality={{ id: modality.id, code: modality.code || name, name, orthancState: orthanc.data?.state || "unavailable", onBack: () => navigate(`/modality?modalityId=${modality.id}`) }} />;
}
