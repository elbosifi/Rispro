import { SchedulingOverrideRequestsWorkspace } from "@/v2/appointments/components/SchedulingOverrideApprovalCenter";
import { useAuth } from "@/providers/auth-provider";

export default function SchedulingOverrideRequestsPage() {
  const { user } = useAuth();

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <h1 className="text-xl font-semibold text-foreground">Override requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review scheduling override requests. Pending requests are not confirmed appointments until approved.
        </p>
      </div>

      <SchedulingOverrideRequestsWorkspace user={user} variant="page" />
    </div>
  );
}
