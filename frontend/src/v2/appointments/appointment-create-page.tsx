import { createV2Booking, evaluateV2Scheduling, fetchV2AppointmentPatientRisk, useV2Lookups, useV2SpecialReasonCodes, useV2Priorities } from "./api";
import { CreateAppointmentTab } from "./components/CreateAppointmentTab";
import { useAuth } from "@/providers/auth-provider";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchComplementaryRecallBookingContext, fetchDoctorMe, fetchPatientById } from "@/lib/api-hooks";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import type { SelectedPatient } from "./hooks/useCreateAppointmentForm";

export function AppointmentCreatePage() {
  const [searchParams] = useSearchParams();
  const urlPatientId = searchParams.get("patientId");
  const recallRequestIdParam = searchParams.get("recallRequestId");
  const recallMode = recallRequestIdParam !== null;
  const recallRequestId = Number(recallRequestIdParam);
  const hasValidRecallRequestId = Number.isInteger(recallRequestId) && recallRequestId > 0;
  const { user } = useAuth();
  const { language } = useLanguage();
  const lookups = useV2Lookups();
  const specialReasons = useV2SpecialReasonCodes();
  const priorities = useV2Priorities();
  const doctorMeQuery = useQuery({
    queryKey: ["doctor-me", "appointment-create"],
    queryFn: fetchDoctorMe,
    enabled: Boolean(user),
    staleTime: 60_000,
  });
  const recallContextQuery = useQuery({ queryKey: ["complementary-recall", "booking-context", recallRequestId], queryFn: () => fetchComplementaryRecallBookingContext(recallRequestId), enabled: recallMode && hasValidRecallRequestId, staleTime: 60_000 });
  const parsedPatientId = recallMode ? (recallContextQuery.data?.patientId ?? null) : (urlPatientId ? Number(urlPatientId) : null);
  const hasValidPatientId = Number.isInteger(parsedPatientId) && (parsedPatientId as number) > 0;

  const preloadPatientQuery = useQuery({
    queryKey: ["patient-by-id", parsedPatientId],
    queryFn: () => Promise.all([fetchPatientById(parsedPatientId as number), fetchV2AppointmentPatientRisk(parsedPatientId as number)]),
    enabled: hasValidPatientId,
    staleTime: 1000 * 60 * 5
  });

  const initialSelectedPatient: SelectedPatient | null = preloadPatientQuery.data
    ? {
        id: preloadPatientQuery.data[0].id,
        arabicFullName: preloadPatientQuery.data[0].arabicFullName,
        englishFullName: preloadPatientQuery.data[0].englishFullName,
        category: preloadPatientQuery.data[0].category,
        identifierType: preloadPatientQuery.data[0].identifierType,
        identifierValue: preloadPatientQuery.data[1].maskedPrimaryIdentifier,
        nationalId: null,
        mrn: preloadPatientQuery.data[0].mrn,
        sex: preloadPatientQuery.data[0].sex,
        ageYears: preloadPatientQuery.data[0].ageYears,
        demographicsEstimated: preloadPatientQuery.data[0].demographicsEstimated,
        estimatedDateOfBirth: preloadPatientQuery.data[1].estimatedDateOfBirth,
        identityRisk: preloadPatientQuery.data[1].identityRisk,
        similarPatientCount: preloadPatientQuery.data[1].similarPatientCount,
        availableVerificationMethods: preloadPatientQuery.data[1].availableVerificationMethods,
        patientIdentitySelectionSource: "url_preselect"
      }
    : null;

  if (recallMode) {
    if (!hasValidRecallRequestId) {
      return <div style={{ padding: "24px 16px", color: "#dc2626" }}>Invalid complementary recall request ID.</div>;
    }

    if (recallContextQuery.isLoading || (recallContextQuery.isSuccess && preloadPatientQuery.isLoading)) {
      return <div style={{ padding: "24px 16px" }}>Loading complementary recall context…</div>;
    }

    if (recallContextQuery.isError || preloadPatientQuery.isError || !recallContextQuery.data || !initialSelectedPatient) {
      const error = recallContextQuery.error ?? preloadPatientQuery.error;
      return <div style={{ padding: "24px 16px", color: "#dc2626" }}>Unable to load the complementary recall booking context. {(error as Error | undefined)?.message ?? "Please return to Recall Requests and try again."}</div>;
    }
  }

  if (lookups.isLoading) {
    return <div style={{ padding: "24px 16px" }}>{t(language, "appointments.create.loadingLookups")}</div>;
  }

  if (lookups.isError) {
    return <div style={{ padding: "24px 16px", color: "#dc2626" }}>{t(language, "appointments.create.failedLoadLookups")}: {(lookups.error as Error)?.message}</div>;
  }

  if (priorities.isLoading) {
    return <div style={{ padding: "24px 16px" }}>{t(language, "appointments.create.loadingPriorities")}</div>;
  }

  if (priorities.isError) {
    return (
      <div style={{ padding: "24px 16px", color: "#dc2626" }}>
        {t(language, "appointments.create.failedLoadPriorities")}: {(priorities.error as Error)?.message}
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 12px" }}>
      <CreateAppointmentTab
        patientLookups={{}}
        modalityOptions={lookups.data?.modalities ?? []}
        examTypeOptions={[]}
        specialReasonOptions={specialReasons.data ?? []}
        priorityOptions={priorities.data ?? []}
        schedulingEngineEnabled
        canUseNonStandardCapacityModes={user?.role === "supervisor" || user?.role === "super_admin"}
        currentUserRole={user?.role}
        doctorModuleCapabilities={doctorMeQuery.data?.moduleCapabilities ?? []}
        initialSelectedPatient={initialSelectedPatient}
        complementaryRecallContext={recallContextQuery.data ? { id: recallContextQuery.data.id, modalityId: recallContextQuery.data.modalityId, examTypeId: recallContextQuery.data.examTypeId, originalAccession: recallContextQuery.data.originalAccession, originalExam: recallContextQuery.data.originalExam, receptionInstruction: recallContextQuery.data.receptionInstruction } : null}
        onCreateAppointment={createV2Booking}
        onEvaluateAvailability={evaluateV2Scheduling}
      />
    </div>
  );
}
