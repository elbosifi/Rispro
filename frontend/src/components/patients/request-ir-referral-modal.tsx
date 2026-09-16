import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/shared";
import { createIrReferral, fetchAssignableIrDoctors } from "@/lib/api/ir-referrals";
import { getDoctorDisplayName } from "@/lib/user-display-name";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { pushToast } from "@/lib/toast";
import type { Patient } from "@/types/api";

export function RequestIrReferralModal({ patient, onClose, onCreated }: { patient: Patient; onClose: () => void; onCreated: (id: number) => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [procedure, setProcedure] = useState("");
  const [indication, setIndication] = useState("");
  const [doctorId, setDoctorId] = useState<number | null>(null);
  const [notify, setNotify] = useState(true);
  const doctors = useQuery({ queryKey: ["ir-referral-doctors"], queryFn: fetchAssignableIrDoctors });
  const create = useMutation({
    mutationFn: () => createIrReferral({ patientId: patient.id, requestedProcedure: procedure.trim(), clinicalIndication: indication.trim() || null, assignedDoctorId: doctorId!, notifyAssignedDoctor: notify }),
    meta: { suppressGlobalToast: true },
    onSuccess: (referral) => {
      void queryClient.invalidateQueries({ queryKey: ["ir-referrals"] });
      pushToast({ type: "success", title: t(language, "irReferral.createdTitle"), message: t(language, "irReferral.createdMessage") });
      onCreated(referral.id);
    },
    onError: (error) => pushToast({ type: "error", title: t(language, "irReferral.createFailedTitle"), message: error instanceof Error ? error.message : t(language, "irReferral.createFailedMessage") }),
  });
  const name = patient.englishFullName || patient.arabicFullName || patient.mrn || t(language, "reviewRequests.patientFallback", { id: patient.id });

  return (
    <Dialog open onClose={onClose}>
      <DialogContent maxWidth="576px" className="!p-0" aria-labelledby="request-ir-title">
        <DialogHeader className="border-b p-4 !mb-0" closeLabel={t(language, "irReferral.closeCreate")}>
          <DialogTitle id="request-ir-title" className="!text-lg !font-semibold">{t(language, "irReferral.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 p-4">
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-sm"><strong>{name}</strong>{patient.mrn ? <span className="ms-2 text-muted-foreground">{patient.mrn}</span> : null}</div>
          <label className="grid gap-1 text-sm"><span className="font-medium">{t(language, "irReferral.requestedProcedure")}</span><textarea value={procedure} onChange={(event) => setProcedure(event.target.value)} className="min-h-20 rounded-md border border-border bg-background px-3 py-2" /></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">{t(language, "irReferral.clinicalIndication")}</span><textarea value={indication} onChange={(event) => setIndication(event.target.value)} className="min-h-20 rounded-md border border-border bg-background px-3 py-2" /></label>
          <label className="grid gap-1 text-sm"><span className="font-medium">{t(language, "irReferral.assignDoctor")}</span><select aria-label={t(language, "irReferral.assignDoctor")} value={doctorId ?? ""} onChange={(event) => setDoctorId(event.target.value ? Number(event.target.value) : null)} className="h-10 rounded-md border border-border bg-background px-3"><option value="">{t(language, "irReferral.selectDoctor")}</option>{(doctors.data ?? []).map((doctor) => <option key={doctor.id} value={doctor.id}>{getDoctorDisplayName(doctor, language)}</option>)}</select></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(event) => setNotify(event.target.checked)} /><span>{t(language, "irReferral.notifyAssignedDoctor")}</span></label>
        </div>
        <DialogFooter className="border-t p-4 !mt-0"><Button type="button" variant="secondary" onClick={onClose}>{t(language, "common.cancel")}</Button><Button type="button" disabled={!procedure.trim() || !doctorId || create.isPending} onClick={() => create.mutate()}>{t(language, "irReferral.createTitle")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
