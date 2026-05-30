import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { disableOwnActionPin, fetchActionPinStatus, setOwnActionPin } from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";

type Mode = "overview" | "reset" | "disable";

function validatePin(pin: string, confirmPin: string): string | null {
  if (!pin) return "PIN is required.";
  if (!/^\d+$/.test(pin)) return "PIN must contain digits only.";
  if (!/^\d{4,8}$/.test(pin)) return "PIN must be 4-8 digits.";
  if (pin !== confirmPin) return "PINs do not match.";
  return null;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not update Security Action PIN.";
  return message === "Invalid username or password." ? "Account password is incorrect." : message;
}

export function ActionPinSettingsButton() {
  const { language } = useLanguage();
  const isArabic = language === "ar";
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("overview");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["action-pin", "status"],
    queryFn: fetchActionPinStatus,
    enabled: isOpen,
    retry: false
  });

  const resetForm = () => {
    setPin("");
    setConfirmPin("");
    setCurrentPassword("");
    setError(null);
  };

  const setPinMutation = useMutation({
    mutationFn: () => setOwnActionPin(pin, confirmPin, currentPassword),
    meta: { suppressGlobalToast: true },
    onSuccess: async () => {
      resetForm();
      setMode("overview");
      setMessage(isArabic ? "تم حفظ PIN الأمان." : "Security Action PIN saved.");
      await queryClient.invalidateQueries({ queryKey: ["action-pin", "status"] });
    },
    onError: (err) => {
      setError(friendlyError(err));
    }
  });

  const disablePinMutation = useMutation({
    mutationFn: () => disableOwnActionPin(currentPassword),
    meta: { suppressGlobalToast: true },
    onSuccess: async () => {
      resetForm();
      setMode("overview");
      setMessage(isArabic ? "تم تعطيل PIN الأمان." : "Security Action PIN disabled.");
      await queryClient.invalidateQueries({ queryKey: ["action-pin", "status"] });
    },
    onError: (err) => {
      setError(friendlyError(err));
    }
  });

  const status = statusQuery.data;
  const hasPin = Boolean(status?.hasPin);
  const canChange = status?.policy.allowUserPinChange !== false;
  const isPending = setPinMutation.isPending || disablePinMutation.isPending;
  const isSetFlow = !hasPin;
  const showPinForm = isSetFlow || mode === "reset";
  const showDisableForm = hasPin && mode === "disable";

  const close = () => {
    setIsOpen(false);
    setMode("overview");
    setMessage(null);
    resetForm();
  };

  const submitPin = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!currentPassword.trim()) {
      setError("Account password is required.");
      return;
    }
    const pinError = validatePin(pin, confirmPin);
    if (pinError) {
      setError(pinError);
      return;
    }
    setPinMutation.mutate();
  };

  const submitDisable = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (!currentPassword.trim()) {
      setError("Account password is required.");
      return;
    }
    disablePinMutation.mutate();
  };

  const updatePin = (value: string, setter: (value: string) => void) => {
    setter(value.replace(/\D/g, "").slice(0, 8));
    setError(null);
    setMessage(null);
  };

  return (
    <>
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={() => setIsOpen(true)}
        aria-label={isArabic ? "إدارة PIN الأمان" : "Manage Security PIN"}
        title={isArabic ? "PIN الأمان" : "Manage Security PIN"}
      >
        <ShieldCheck className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isPending) close();
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
              {hasPin ? (isArabic ? "إدارة PIN إجراء الأمان" : "Manage Security Action PIN") : (isArabic ? "تعيين PIN إجراء الأمان" : "Set Security Action PIN")}
            </h3>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              {hasPin
                ? (isArabic ? "يُستخدم PIN إجراء الأمان لتأكيد الإجراءات الحساسة أثناء تسجيل الدخول. وهو ليس كلمة مرور الحساب." : "Your Security Action PIN is used to confirm sensitive actions while you are signed in. It is not your account password.")
                : (isArabic ? "أنشئ PIN إجراء الأمان لتأكيد الإجراءات الحساسة أثناء تسجيل الدخول. وهو ليس كلمة مرور الحساب." : "Create a Security Action PIN to confirm sensitive actions while you are signed in. It is not your account password.")}
            </p>

            {statusQuery.isLoading && <p className="mt-4 text-sm text-stone-500 dark:text-stone-400">{isArabic ? "جار تحميل الحالة..." : "Loading status..."}</p>}

            {!statusQuery.isLoading && !canChange && (
              <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
                {isArabic ? "تغيير PIN معطل حسب السياسة." : "PIN changes are disabled by policy."}
              </p>
            )}

            {!statusQuery.isLoading && hasPin && mode === "overview" && (
              <div className="mt-4 space-y-4">
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {isArabic ? "تم تعيين PIN" : "PIN is set"}
                </p>
                {message && <p className="text-sm text-stone-700 dark:text-stone-200">{message}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={close} disabled={isPending} className="flex-1 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600">
                    {isArabic ? "إلغاء" : "Cancel"}
                  </button>
                  <button type="button" onClick={() => { resetForm(); setMode("reset"); }} disabled={!canChange || isPending} className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:bg-teal-400">
                    {isArabic ? "إعادة تعيين PIN" : "Reset PIN"}
                  </button>
                  <button type="button" onClick={() => { resetForm(); setMode("disable"); }} disabled={!canChange || isPending} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:bg-red-400">
                    {isArabic ? "تعطيل PIN" : "Disable PIN"}
                  </button>
                </div>
              </div>
            )}

            {!statusQuery.isLoading && showPinForm && (
              <form onSubmit={submitPin} className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
                  {isArabic ? "كلمة مرور الحساب" : "Account password"}
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => {
                      setCurrentPassword(event.target.value);
                      setError(null);
                      setMessage(null);
                    }}
                    autoComplete="current-password"
                    disabled={!canChange || isPending}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
                  />
                </label>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
                  {isArabic ? "PIN جديد" : "New PIN"}
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={pin}
                    onChange={(event) => updatePin(event.target.value, setPin)}
                    autoComplete="off"
                    disabled={!canChange || isPending}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
                  />
                </label>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
                  {isArabic ? "تأكيد PIN" : "Confirm PIN"}
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={8}
                    value={confirmPin}
                    onChange={(event) => updatePin(event.target.value, setConfirmPin)}
                    autoComplete="off"
                    disabled={!canChange || isPending}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
                  />
                </label>
                <p className="text-xs text-stone-500 dark:text-stone-400">{isArabic ? "استخدم 4-8 أرقام." : "Use 4-8 digits."}</p>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                {message && <p className="text-sm text-stone-700 dark:text-stone-200">{message}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={hasPin ? () => { resetForm(); setMode("overview"); } : close} disabled={isPending} className="flex-1 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600">
                    {isArabic ? "إلغاء" : "Cancel"}
                  </button>
                  <button type="submit" disabled={!canChange || isPending} className="flex-1 rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-700 disabled:bg-teal-400">
                    {isPending ? (isArabic ? "جار الحفظ..." : "Saving...") : hasPin ? (isArabic ? "إعادة تعيين PIN" : "Reset PIN") : (isArabic ? "حفظ PIN" : "Save PIN")}
                  </button>
                </div>
              </form>
            )}

            {!statusQuery.isLoading && showDisableForm && (
              <form onSubmit={submitDisable} className="mt-4 space-y-4">
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {isArabic ? "قد يؤدي تعطيل PIN إجراء الأمان إلى منعك من تأكيد الإجراءات المقيدة حتى يتم تعيين PIN جديد." : "Disabling your Security Action PIN may prevent you from confirming restricted actions until a new PIN is set."}
                </p>
                <label className="block text-sm font-medium text-stone-700 dark:text-stone-200">
                  {isArabic ? "كلمة مرور الحساب" : "Account password"}
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => {
                      setCurrentPassword(event.target.value);
                      setError(null);
                      setMessage(null);
                    }}
                    autoComplete="current-password"
                    disabled={!canChange || isPending}
                    className="mt-1 w-full rounded-lg border border-stone-300 bg-stone-50 px-4 py-2 text-stone-900 outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-white"
                  />
                </label>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex gap-3">
                  <button type="button" onClick={() => { resetForm(); setMode("overview"); }} disabled={isPending} className="flex-1 rounded-lg bg-stone-100 px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600">
                    {isArabic ? "إلغاء" : "Cancel"}
                  </button>
                  <button type="submit" disabled={!canChange || isPending} className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:bg-red-400">
                    {isPending ? (isArabic ? "جار التعطيل..." : "Disabling...") : (isArabic ? "تعطيل PIN" : "Disable PIN")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
