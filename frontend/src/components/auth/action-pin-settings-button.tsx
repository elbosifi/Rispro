import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { fetchActionPinStatus, setOwnActionPin } from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";

export function ActionPinSettingsButton() {
  const { language } = useLanguage();
  const isArabic = language === "ar";
  const [isOpen, setIsOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["action-pin", "status"],
    queryFn: fetchActionPinStatus,
    enabled: isOpen,
    retry: false
  });

  const setPinMutation = useMutation({
    mutationFn: () => setOwnActionPin(pin, currentPassword || undefined),
    meta: { suppressGlobalToast: true },
    onSuccess: async () => {
      setPin("");
      setCurrentPassword("");
      setMessage(isArabic ? "تم حفظ PIN الإجراء." : "Action PIN saved.");
      await queryClient.invalidateQueries({ queryKey: ["action-pin", "status"] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : (isArabic ? "تعذر حفظ PIN." : "Could not save Action PIN."));
    }
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!/^\d{4}$/.test(pin)) {
      setMessage(isArabic ? "أدخل PIN من 4 أرقام." : "Enter a 4-digit PIN.");
      return;
    }
    setPinMutation.mutate();
  };

  const status = statusQuery.data;
  const canChange = status?.policy.allowUserPinChange !== false;

  return (
    <>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setIsOpen(true)}
        aria-label={isArabic ? "إعدادات PIN الإجراء" : "Action PIN settings"}
        title={isArabic ? "PIN الإجراء" : "Action PIN"}
      >
        <ShieldCheck className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !setPinMutation.isPending) setIsOpen(false);
          }}
          dir={isArabic ? "rtl" : "ltr"}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-700 dark:bg-stone-800"
          >
            <h3 className="text-lg font-semibold text-stone-900 dark:text-white">
              {isArabic ? "PIN الإجراء" : "Action PIN"}
            </h3>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              {statusQuery.isLoading
                ? (isArabic ? "جار تحميل الحالة..." : "Loading status...")
                : status?.hasPin
                  ? (isArabic ? "لديك PIN إجراء محفوظ." : "You have an Action PIN set.")
                  : (isArabic ? "لم يتم تعيين PIN إجراء بعد." : "No Action PIN is set.")}
            </p>

            <form onSubmit={submit} className="mt-4 space-y-4">
              <input
                aria-label={isArabic ? "PIN إجراء جديد" : "New Action PIN"}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
                  setMessage(null);
                }}
                autoComplete="off"
                disabled={!canChange || setPinMutation.isPending}
                className="w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
              />

              {status?.hasPin && status.policy.requirePinToViewOwnPinSettings && (
                <input
                  aria-label={isArabic ? "كلمة المرور الحالية" : "Current password"}
                  type="password"
                  value={currentPassword}
                  onChange={(event) => {
                    setCurrentPassword(event.target.value);
                    setMessage(null);
                  }}
                  autoComplete="current-password"
                  disabled={!canChange || setPinMutation.isPending}
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
                />
              )}

              {!canChange && (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {isArabic ? "تغيير PIN معطل حسب السياسة." : "PIN changes are disabled by policy."}
                </p>
              )}
              {message && <p className="text-sm text-stone-700 dark:text-stone-200">{message}</p>}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={setPinMutation.isPending}
                  className="flex-1 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600"
                >
                  {isArabic ? "إغلاق" : "Close"}
                </button>
                <button
                  type="submit"
                  disabled={!canChange || setPinMutation.isPending}
                  className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:bg-teal-400"
                >
                  {setPinMutation.isPending ? (isArabic ? "جار الحفظ..." : "Saving...") : (isArabic ? "حفظ" : "Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
