import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { GitMerge } from "lucide-react";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { Card } from "@/components/shared/Card";
import PatientDuplicateResolverSection from "@/pages/settings/patient-duplicate-resolver-section";

export default function PatientMergePage() {
  const queryClient = useQueryClient();
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingReAuthKeys, setPendingReAuthKeys] = useState<string[][]>([]);

  const requestReAuth = (queryKey: string[]) => {
    setPendingReAuthKeys((current) =>
      current.some((key) => key.length === queryKey.length && key.every((part, index) => part === queryKey[index]))
        ? current
        : [...current, queryKey]
    );
    setShowReAuthModal(true);
  };

  const handleReAuthSuccess = async () => {
    setShowReAuthModal(false);
    const keys = pendingReAuthKeys;
    setPendingReAuthKeys([]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["auth-session"] }),
      ...keys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
    ]);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex items-center gap-2">
        <GitMerge size={22} className="text-accent" />
        <div>
          <h2 className="text-xl font-bold text-foreground">Patient Merge</h2>
          <p className="text-sm text-muted-foreground">Review duplicate candidates, select the survivor, and merge duplicate patient records.</p>
        </div>
      </div>
      <Card className="p-4 sm:p-5">
        <PatientDuplicateResolverSection onReAuthRequired={requestReAuth} />
      </Card>
      {showReAuthModal ? <SupervisorReAuthModal onClose={() => setShowReAuthModal(false)} onSuccess={handleReAuthSuccess} /> : null}
    </div>
  );
}
