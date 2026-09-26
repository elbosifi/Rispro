import { useNavigate } from "react-router-dom";
import { BookOpenText } from "lucide-react";
import { Button, Card } from "@/components/shared";
import { useTeachingAuth } from "../auth/teaching-auth-context";

export function TeachingAccessDenied({ capability }: { capability?: string }) {
  const { logout } = useTeachingAuth();
  const isEditorialAccess = capability === "Teaching editorial access";
  const isLearnerAccess = capability === "Teaching learner access";
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center p-4" style={{ backgroundColor: "var(--background)" }}>
      <Card className="w-full max-w-lg p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-accent" aria-hidden="true">
          <BookOpenText size={24} />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">{isEditorialAccess ? "Teaching editorial access is required" : isLearnerAccess ? "Teaching learner access is not enabled" : capability ? "Teaching author access is required" : "Teaching access is not enabled"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{isEditorialAccess ? "This account can use Teaching but does not have question authoring, review, or publishing permission." : isLearnerAccess ? "This account can use Teaching but does not have permission to study from the learner question bank." : capability ? "This account can use Teaching but does not have permission to manage imports." : "This account does not have permission to enter the Teaching workspace."}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Return to RISpro
          </Button>
          <Button variant="ghost" onClick={() => void logout()}>Sign out</Button>
        </div>
      </Card>
    </main>
  );
}
