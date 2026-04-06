import { removeToast, useToastStore } from "@/lib/toast";
import { useLanguage } from "@/providers/language-provider";
import { t } from "@/lib/i18n";

export function ToastViewport() {
  const toasts = useToastStore();
  const { language } = useLanguage();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[70] flex w-[min(92vw,24rem)] flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${
            toast.type === "error"
              ? "border-red-200 bg-red-50/95 text-red-900 dark:border-red-900/60 dark:bg-red-950/95 dark:text-red-100"
              : toast.type === "success"
              ? "border-emerald-200 bg-emerald-50/95 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/95 dark:text-emerald-100"
              : "border-stone-200 bg-white/95 text-stone-900 dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-100"
          }`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{toast.title}</p>
              <p className="mt-1 text-sm opacity-90 leading-relaxed">{toast.message}</p>
              {toast.action && (
                <button
                  type="button"
                  className="mt-3 inline-flex items-center rounded-lg bg-black/5 px-3 py-1.5 text-xs font-semibold hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15"
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
              className="text-xs font-semibold uppercase tracking-[0.16em] opacity-60 hover:opacity-100"
              onClick={() => removeToast(toast.id)}
            >
              {t(language, "toast.close")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
