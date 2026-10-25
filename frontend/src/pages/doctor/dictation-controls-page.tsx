import { useEffect, useState } from "react";
import { Button, Card, Checkbox, ErrorState, Input } from "@/components/shared";
import { DEFAULT_DICTATION_PREFERENCES, formatShortcut, isStandaloneModifier, loadDictationPreferences, sameShortcut, saveDictationPreferences, shortcutError, shortcutFromEvent, type DictationPreferences, type DictationShortcut } from "@/lib/dictation-preferences";

type Binding = "keyboardShortcut" | "speechMikeStart" | "speechMikeStop";
export function DictationControlsPage() {
  const [preferences, setPreferences] = useState(loadDictationPreferences);
  const [capturing, setCapturing] = useState<Binding | null>(null);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceNotice, setDeviceNotice] = useState("");
  const save = (next: DictationPreferences) => {
    const shortcuts = [next.keyboardShortcut, next.speechMikeStart, next.speechMikeStop];
    if (shortcuts.some((a, i) => shortcuts.slice(i + 1).some((b) => sameShortcut(a, b)))) { setError("A default shortcut is used by another dictation control. Change that binding before resetting."); return; }
    try { saveDictationPreferences(next); setPreferences(next); setError(""); }
    catch { setError("These preferences could not be saved. Allow browser local storage and try again."); }
  };
  useEffect(() => {
    if (!capturing) return;
    let modifier: DictationShortcut | null = null;
    const capture = (shortcut: DictationShortcut) => {
      if (capturing !== "keyboardShortcut" && isStandaloneModifier(shortcut)) { setError("Choose a function key for SpeechMike Start/Stop so a short button press can activate it."); return; }
      const invalid = shortcutError(shortcut);
      if (invalid) { setError(invalid); return; }
      if ((["keyboardShortcut", "speechMikeStart", "speechMikeStop"] as Binding[]).some((binding) => binding !== capturing && sameShortcut(preferences[binding], shortcut))) {
        setError("This shortcut is already used by another dictation control. Choose a different shortcut."); return;
      }
      try { const next = { ...preferences, [capturing]: shortcut }; saveDictationPreferences(next); setPreferences(next); setError(""); setCapturing(null); }
      catch { setError("These preferences could not be saved. Allow browser local storage and try again."); }
    };
    const down = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Escape") { setCapturing(null); setError(""); return; }
      if (event.repeat || event.isComposing) return;
      const shortcut = shortcutFromEvent(event);
      // Wait for release so Shift can also be part of Ctrl + Shift + F9.
      if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code)) { modifier = isStandaloneModifier(shortcut) ? shortcut : null; return; }
      modifier = null; capture(shortcut);
    };
    const up = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopImmediatePropagation();
      if (modifier?.code === event.code) { capture(modifier); modifier = null; }
    };
    const cancel = () => setCapturing(null);
    document.addEventListener("keydown", down, true); document.addEventListener("keyup", up, true);
    window.addEventListener("blur", cancel);
    return () => { document.removeEventListener("keydown", down, true); document.removeEventListener("keyup", up, true); window.removeEventListener("blur", cancel); };
  }, [capturing, preferences]);
  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error("Microphone selection is unavailable in this browser.");
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default"));
      setDeviceNotice("If names are hidden, allow microphone access during a recording, then refresh this list.");
    } catch (e) { setDeviceNotice(e instanceof Error ? e.message : "Could not list microphones."); }
  };
  const captureButton = (binding: Binding, label: string) => <Button type="button" variant="secondary" disabled={capturing !== null} onClick={() => { setError(""); setCapturing(binding); }}>{label}</Button>;
  return <div className="mx-auto max-w-3xl space-y-4" dir="ltr">
    <div><h1 className="text-2xl font-semibold">Dictation Controls</h1><p className="text-sm text-muted-foreground">Preferences save automatically for this workstation/browser. Shortcuts work only in an active Protocoling editor with browser focus. Microphone buttons always remain available.</p></div>
    {capturing && <Card className="space-y-2"><p role="status">Press the key or key combination you want to use.</p><p className="text-sm">For a Shift key alone, press and release it. Escape cancels capture.</p><Button type="button" variant="secondary" onClick={() => setCapturing(null)}>Cancel capture</Button></Card>}
    {error && <ErrorState role="alert" message={error} />}
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Keyboard Dictation</h2>
      <label className="flex items-center gap-2"><Checkbox checked={preferences.keyboardEnabled} disabled={capturing !== null} onCheckedChange={(keyboardEnabled) => save({ ...preferences, keyboardEnabled })} />Enable keyboard dictation</label>
      <p>Recording shortcut: <kbd>{formatShortcut(preferences.keyboardShortcut)}</kbd></p>
      <div className="flex flex-wrap gap-2">{captureButton("keyboardShortcut", "Capture Shortcut")}<Button type="button" variant="ghost" disabled={capturing !== null} onClick={() => save({ ...preferences, keyboardEnabled: true, keyboardMode: "hold", keyboardShortcut: DEFAULT_DICTATION_PREFERENCES.keyboardShortcut })}>Reset keyboard to default</Button></div>
      <label className="block text-sm font-semibold">Recording mode<select className="input-premium mt-1 w-full" value={preferences.keyboardMode} disabled={capturing !== null} onChange={(event) => save({ ...preferences, keyboardMode: event.target.value as "hold" | "toggle" })}><option value="hold">Hold-to-Talk</option><option value="toggle">Toggle</option></select></label>
      <p className="text-sm text-muted-foreground">Right Shift alone waits 200 ms before recording. It can still conflict with typing or text selection. Choose an alternative such as F9 if needed. Focus a Protocoling text field first. Dictation appears directly in that field after stopping; review and edit it there. Saving remains manual.</p>
    </Card>
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold">Philips SpeechMike</h2>
      <label className="flex items-center gap-2"><Checkbox checked={preferences.speechMikeEnabled} disabled={capturing !== null} onCheckedChange={(speechMikeEnabled) => save({ ...preferences, speechMikeEnabled })} />Enable SpeechMike shortcuts</label>
      <p>Start shortcut: <kbd>{formatShortcut(preferences.speechMikeStart)}</kbd></p>{captureButton("speechMikeStart", "Capture Start Shortcut")}
      <p>Stop shortcut: <kbd>{formatShortcut(preferences.speechMikeStop)}</kbd></p>{captureButton("speechMikeStop", "Capture Stop Shortcut")}
      <div><Button type="button" variant="ghost" disabled={capturing !== null} onClick={() => save({ ...preferences, speechMikeEnabled: false, speechMikeStart: DEFAULT_DICTATION_PREFERENCES.speechMikeStart, speechMikeStop: DEFAULT_DICTATION_PREFERENCES.speechMikeStop })}>Reset SpeechMike to default</Button></div>
      <p className="text-sm text-muted-foreground">Map buttons to keyboard shortcuts in Philips SpeechControl (initial suggestion: F13 to start, F14 to stop). Click Capture Start Shortcut and press the mapped button, then repeat for Stop. If nothing is captured, the button sends no browser keyboard event: map it in SpeechControl first. Start/Stop are separate presses; no hold is needed. RISpro uses keyboard events only.</p>
    </Card>
    <Card className="space-y-3"><h2 className="text-lg font-semibold">Microphone</h2>
      <label className="block text-sm font-semibold">Recording input<select className="input-premium mt-1 w-full" value={preferences.deviceId} onChange={(event) => save({ ...preferences, deviceId: event.target.value })}><option value="">Workstation default microphone</option>{preferences.deviceId && !devices.some((device) => device.deviceId === preferences.deviceId) && <option value={preferences.deviceId}>Saved microphone (refresh to check availability)</option>}{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
      <Button type="button" variant="secondary" onClick={() => void refreshDevices()}>Refresh microphones</Button>
      <p className="text-sm text-muted-foreground">Choose the built-in microphone or SpeechMike USB microphone. If the selected input is unavailable, recording uses the workstation default and displays a notice.</p>
      {deviceNotice && <p role="status" className="text-sm">{deviceNotice}</p>}
      <section className="space-y-3 border-t border-border pt-3" aria-labelledby="windows-microphone-setup">
        <h3 id="windows-microphone-setup" className="font-semibold">Windows Microphone Setup</h3>
        <p className="text-sm text-muted-foreground">Enable browser microphone access when using RISpro through the hospital's local IP address.</p>
        <a href="/downloads/Repair-RISpro-Microphone-Windows.ps1" download="Repair-RISpro-Microphone-Windows.ps1" className="btn-primary inline-flex items-center justify-center px-3 py-2 text-sm">Download Windows Setup Script</a>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Download the script.</li>
          <li>Run Windows PowerShell as Administrator.</li>
          <li>Execute the downloaded script.</li>
          <li>Restart Chrome/Edge or restart Windows.</li>
          <li>Reopen RISpro and allow microphone access.</li>
        </ol>
        <label className="block text-sm">PowerShell command (select to copy)
          <Input className="mt-1 w-full font-mono text-xs" readOnly value={'powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\\Repair-RISpro-Microphone-Windows.ps1"'} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <p className="text-xs text-muted-foreground">Run this command from the folder containing the downloaded file.</p>
        <p className="text-xs text-muted-foreground">Windows only. Configured for http://192.9.101.252:3000. Intended for trusted hospital LAN workstations. HTTP traffic remains unencrypted.</p>
      </section>
    </Card>
  </div>;
}
