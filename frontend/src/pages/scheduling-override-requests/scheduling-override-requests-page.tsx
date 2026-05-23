import { SchedulingOverrideRequestsWorkspace } from "@/v2/appointments/components/SchedulingOverrideApprovalCenter";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";

export default function SchedulingOverrideRequestsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <h1 className="text-xl font-semibold text-foreground">{t("overrideRequests.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("overrideRequests.pageDescription")}
        </p>
      </div>

      <SchedulingOverrideRequestsWorkspace user={user} variant="page" />
    </div>
  );
}
