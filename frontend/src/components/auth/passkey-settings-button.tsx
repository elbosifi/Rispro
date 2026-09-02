import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { KeyRound } from "lucide-react";
import { getPasskeyRegistrationOptions, verifyPasskeyRegistration } from "@/lib/api-hooks";

function passkeySupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (window.isSecureContext === false) return false;
  return "PublicKeyCredential" in window;
}

export function PasskeySettingsButton() {
  const [state, setState] = useState<"idle" | "working" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const supported = passkeySupported();

  const addPasskey = async () => {
    if (!supported) return;
    setState("working");
    setMessage("");
    try {
      const options = await getPasskeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON: options as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"] });
      await verifyPasskeyRegistration(response);
      setState("success");
      setMessage("Passkey added successfully.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Could not add passkey.");
    }
  };

  return (
    <div className="w-full rounded-lg border border-stone-200 p-2 dark:border-stone-700">
      <p className="px-1 pb-1 text-xs font-medium text-stone-700 dark:text-stone-200">Passkey</p>
      <button
        type="button"
        className="flex w-full items-center justify-start gap-2 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
        onClick={() => void addPasskey()}
        disabled={!supported || state === "working"}
      >
        <KeyRound className="h-4 w-4" />
        {state === "working" ? "Adding passkey..." : "Add passkey to this device"}
      </button>
      {!supported ? <p className="px-1 pt-1 text-xs text-stone-600 dark:text-stone-300">Passkeys are not supported on this device/browser.</p> : message ? <p className={state === "error" ? "px-1 pt-1 text-xs text-red-600" : "px-1 pt-1 text-xs text-emerald-600"}>{message}</p> : null}
    </div>
  );
}
