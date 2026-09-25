import { LoadingState } from "@/components/shared";

export function TeachingLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ backgroundColor: "var(--background)" }}>
      <LoadingState className="w-full max-w-sm" message="Loading Teaching…" />
    </div>
  );
}
