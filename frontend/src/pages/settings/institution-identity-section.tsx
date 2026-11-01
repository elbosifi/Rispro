import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, LoadingState, ErrorState } from "@/components/shared";
import { api, ApiError } from "@/lib/api-client";
import { setInstitutionIdentity, type InstitutionIdentity } from "@/lib/institution-identity";
import { useLanguage } from "@/providers/language-provider";

export default function InstitutionIdentitySection({ onReAuthRequired, reauthVersion }: { onReAuthRequired: (keys: string[]) => void; reauthVersion: number }) {
  const { language } = useLanguage(), ar = language === "ar";
  const client = useQueryClient();
  const [override, setOverride] = useState<InstitutionIdentity | null>(null);
  const [assetError, setAssetError] = useState("");
  const [pendingSave, setPendingSave] = useState<number | null>(null);
  const query = useQuery({ queryKey: ["institution-identity"], queryFn: () => api<InstitutionIdentity>("/settings/institution-identity"), retry: false });
  const draft = override ?? query.data;
  const reauth = (error: unknown) => error instanceof ApiError && [401,403].includes(error.status);
  useEffect(() => { if (reauth(query.error)) onReAuthRequired(["institution-identity"]); }, [query.error, onReAuthRequired]);
  const mutation = useMutation({
    mutationFn: () => api<InstitutionIdentity>("/settings/institution-identity", { method: "PUT", body: JSON.stringify(draft) }),
    onSuccess: async saved => {
      setOverride(saved); setInstitutionIdentity(saved); setPendingSave(null);
      await client.invalidateQueries({ predicate: query => /institution|appointment-slip|patient-qr/.test(String(query.queryKey[0])) });
    },
    onError: error => { if (reauth(error)) { setPendingSave(reauthVersion); onReAuthRequired(["institution-identity"]); } },
  });
  useEffect(() => { if (pendingSave !== null && reauthVersion > pendingSave && !mutation.isPending) mutation.mutate(); }, [pendingSave, reauthVersion, mutation]);
  function change(key: keyof InstitutionIdentity, value: string) { if (draft) setOverride({ ...draft, [key]: value }); }
  async function upload(key: "hospitalLogo" | "departmentLogo", file?: File) {
    if (!file) return;
    setAssetError("");
    if (!["image/png","image/jpeg"].includes(file.type) || file.size > 2_000_000) { setAssetError(ar ? "اختر صورة PNG أو JPEG بحجم لا يتجاوز 2 MB." : "Choose a PNG or JPEG image of at most 2 MB."); return; }
    try {
      const value = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      change(key, value);
    } catch { setAssetError(ar ? "تعذر قراءة الصورة." : "The image could not be read."); }
  }
  const fields: [keyof InstitutionIdentity,string,string][] = [
    ["hospitalNameEn","Hospital name (English)","اسم المستشفى (الإنجليزية)"], ["hospitalNameAr","Hospital name (Arabic)","اسم المستشفى (العربية)"],
    ["departmentNameEn","Department name (English)","اسم القسم (الإنجليزية)"], ["departmentNameAr","Department name (Arabic)","اسم القسم (العربية)"],
    ["addressEn","Hospital address (English)","عنوان المستشفى (الإنجليزية)"], ["addressAr","Hospital address (Arabic)","عنوان المستشفى (العربية)"],
    ["primaryPhone","Primary phone","رقم الهاتف الرئيسي"], ["secondaryPhone","Secondary phone","رقم الهاتف الثاني"],
    ["contactInformation","Additional contact information","معلومات التواصل الإضافية"], ["website","Hospital website (optional)","موقع المستشفى (اختياري)"],
  ];
  if (query.isLoading) return <LoadingState />;
  if (!draft) return reauth(query.error) ? null : <ErrorState message={query.error instanceof Error ? query.error.message : "Institution identity could not be loaded."} />;
  return <section className="space-y-4 border-b border-border pb-5">
    <p className="text-sm text-muted-foreground">{ar ? "تستخدم التقارير والمواعيد وصفحة QR وهوية التطبيق هذه البيانات. تحتفظ التقارير الموقعة بهويتها المسجلة." : "Reports, appointment slips, patient QR information, and application branding share these values. Signed reports retain their recorded identity."}</p>
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([key,en,labelAr]) => <label key={key} className="block text-sm font-semibold">{ar ? labelAr : en}<Input className="mt-1 w-full" dir={key.endsWith("Ar") ? "rtl" : "ltr"} value={draft[key]} maxLength={1000} onChange={event => change(key,event.target.value)} /></label>)}</div>
    <div className="grid gap-4 sm:grid-cols-2">{(["hospitalLogo","departmentLogo"] as const).map(key => <div key={key} className="space-y-2">
      <label className="block text-sm font-semibold">{key === "hospitalLogo" ? (ar ? "شعار المستشفى" : "Hospital logo") : (ar ? "شعار القسم (اختياري)" : "Department logo (optional)")}<Input type="file" accept="image/png,image/jpeg" className="mt-1 w-full" onChange={event => void upload(key,event.target.files?.[0])} /></label>
      {draft[key] ? <img src={draft[key]} alt={key === "hospitalLogo" ? "Hospital logo preview" : "Department logo preview"} className="h-20 max-w-full object-contain" /> : null}
      <Button variant="secondary" size="sm" onClick={() => change(key,key === "hospitalLogo" ? "/assets/nccb-logo.png" : "")}>{ar ? "إعادة تعيين الشعار" : "Reset logo"}</Button>
    </div>)}</div>
    {assetError ? <ErrorState message={assetError} /> : null}
    <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>{ar ? "حفظ هوية المؤسسة" : "Save institution identity"}</Button>
    {mutation.isSuccess ? <p role="status" className="text-sm">{ar ? "تم الحفظ." : "Institution identity saved."}</p> : null}
    {mutation.error && !reauth(mutation.error) ? <ErrorState message={mutation.error.message} /> : null}
  </section>;
}
