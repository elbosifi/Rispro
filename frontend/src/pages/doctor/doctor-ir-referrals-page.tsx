import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/shared";
import { fetchMyIrReferralWorklist } from "@/lib/api/ir-referrals";
import { irReferralStatusLabel, irReferralStatusVariant } from "@/lib/ir-referral-display";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";

export function DoctorIrReferralsPage() {
  const { language } = useLanguage();
  const query = useQuery({ queryKey: ["doctor", "ir-referrals", "worklist"], queryFn: fetchMyIrReferralWorklist, refetchInterval: 30_000 });
  if (query.isLoading) return <p className="p-4 text-sm text-muted-foreground">{t(language, "irReferral.worklistLoading")}</p>;
  if (query.error) return <p className="p-4 text-sm text-red-600">{query.error instanceof Error ? query.error.message : t(language, "irReferral.worklistLoadError")}</p>;
  return <section className="space-y-5 p-4 lg:p-6" dir={language === "ar" ? "rtl" : "ltr"}><header><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">RISpro</p><h1 className="mt-1 text-2xl font-semibold">{t(language, "irReferral.worklistTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">{t(language, "irReferral.worklistSubtitle")}</p></header><div className="grid gap-3">{(query.data ?? []).map((item) => <article key={item.id} className="rounded-xl border border-border bg-card p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><Badge variant="info">{t(language, "reviewRequests.irConsultation")}</Badge><h2 className="mt-3 font-semibold">{item.patientEnglishName || item.patientArabicName || item.patientMrn || t(language, "reviewRequests.patientFallback", { id: item.patientId })}</h2><p className="mt-1 text-sm text-muted-foreground">{item.patientMrn || t(language, "reviewRequests.mrnUnavailable")} · {item.requestedProcedure}</p></div><Badge variant={irReferralStatusVariant(item.status)}>{irReferralStatusLabel(language, item.status)}</Badge></div><p className="mt-3 text-sm">{item.clinicalIndication || t(language, "irReferral.noClinicalIndication")}</p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>{item.documentsConfirmed ? t(language, "irReferral.documentsConfirmed") : t(language, "irReferral.documentsNotConfirmed")}</span><span>{item.imagesConfirmed ? t(language, "irReferral.imagingConfirmed") : t(language, "irReferral.imagingNotConfirmed")}</span></div><Link to={`/comparisons/ir/${item.id}`} className="mt-4 inline-block text-sm font-semibold text-accent">{t(language, "irReferral.openConsultation")}</Link></article>)}{query.data?.length === 0 ? <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">{t(language, "irReferral.worklistEmpty")}</p> : null}</div></section>;
}
