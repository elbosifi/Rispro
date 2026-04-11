import { removeToast, useToastStore } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

export function ToastViewport() {
  const toasts = useToastStore();
  const { language } = useLanguage();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(92vw,24rem)] flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => {
        const isSuccess = toast.type === "success";
        const isError = toast.type === "error";
        const accentColor = isSuccess ? "var(--green)" : isError ? "var(--accent)" : "var(--blue)";
        const accentBorder = isSuccess ? "rgba(34,197,94,0.3)" : isError ? "rgba(255,71,87,0.3)" : "rgba(59,130,246,0.3)";
        const Icon = isSuccess ? CheckCircle2 : isError ? AlertCircle : AlertCircle;

        return (
          <div
            key={toast.id}
            className="pointer-events-auto rounded-lg border shadow-lg animate-slide-in relative overflow-hidden"
            style={{
              backgroundColor: "var(--background)",
              borderColor: accentBorder,
              boxShadow: "var(--shadow-card)"
            }}
          >
            {/* Left accent stripe */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1"
              style={{ backgroundColor: accentColor }}
            />

            <div className="p-4 pl-5">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5" style={{ color: accentColor }}>
                  <Icon size={18} strokeWidth={1.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{toast.title}</p>
                  {toast.message && (
                    <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{toast.message}</p>
                  )}
                  {toast.action && (
                    <button
                      type="button"
                      className="mt-2 text-xs font-semibold transition-colors duration-150 hover:underline"
                      style={{ color: accentColor }}
                      onClick={() => {
                        toast.action?.onClick();
                        removeToast(toast.id);
                      }}
                    >
                      {toast.action.label}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="flex-shrink-0 p-1 rounded-md transition-all duration-150"
                  style={{ color: "var(--text-muted)" }}
                  onClick={() => removeToast(toast.id)}
                  aria-label={t(language, "toast.close")}
                >
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
