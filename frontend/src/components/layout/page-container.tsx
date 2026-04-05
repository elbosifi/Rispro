import { type ReactNode, Suspense } from "react";
import { useLanguage } from "@/providers/language-provider";

function LoadingSpinner() {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-center min-h-[200px]">
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-10 h-10 border-4 rounded-full animate-spin"
          style={{
            borderColor: "var(--line)",
            borderTopColor: "var(--teal)"
          }}
        />
        <p className="text-sm" style={{ color: "var(--muted)" }}>
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
      <div className="text-center space-y-3 max-w-md">
        <div className="text-4xl">⚠️</div>
        <h3 className="text-lg font-semibold" style={{ color: "var(--red)" }}>
          {error.name || "Error"}
        </h3>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {error.message}
        </p>
        <button
          className="px-4 py-2 text-sm font-medium rounded-lg text-white transition-opacity hover:opacity-80"
          style={{ backgroundColor: "var(--teal)" }}
          onClick={onRetry}
        >
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
    <div className="flex-1 overflow-y-auto p-4 lg:p-6" style={{ backgroundColor: "var(--bg)" }}>
      {loading ? (
        <LoadingSpinner />
      ) : error ? (
        <ErrorBoundary error={error} onRetry={onRetry ?? (() => window.location.reload())} />
      ) : (
        <Suspense fallback={<LoadingSpinner />}>{children}</Suspense>
      )}
    </div>
  );
}
