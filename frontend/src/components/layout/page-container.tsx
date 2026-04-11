import { type ReactNode, Suspense } from "react";
import { useLanguage } from "@/providers/language-provider";
import { AlertTriangle } from "lucide-react";

function LoadingSpinner() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="flex flex-col items-center gap-4">
        <div className="spinner-industrial h-10 w-10" />
        <p className="text-xs uppercase tracking-[0.15em] font-mono-data" style={{ color: "var(--text-muted)" }}>
          {t("common.loading")}
        </p>
      </div>
    </div>
  );
}

function ErrorBoundary({
  error,
  onRetry
}: {
  error: Error | null;
  onRetry: () => void;
}) {
  const { t } = useLanguage();
  if (!error) return null;

  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="card-shell text-center space-y-4 max-w-md">
        <div className="flex justify-center">
          <div className="icon-housing icon-housing--md" style={{ color: "var(--accent)" }}>
            <AlertTriangle size={28} />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-bold text-embossed" style={{ color: "var(--accent)" }}>
            {error.name || "Error"}
          </h3>
          <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
            {error.message}
          </p>
        </div>
        <button className="btn-primary" onClick={onRetry}>
          {t("common.tryAgain")}
        </button>
      </div>
    </div>
  );
}

export function PageContainer({
  children,
  loading,
  error,
  onRetry
}: {
  children: ReactNode;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-6" style={{ backgroundColor: "var(--background)" }}>
      <div className="max-w-7xl mx-auto">
        {loading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorBoundary error={error} onRetry={onRetry ?? (() => window.location.reload())} />
        ) : (
          <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
        )}
      </div>
    </div>
  );
}
