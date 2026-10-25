import { useEffect, useState } from "react";
import { Button, Card, Checkbox, ErrorState, Input } from "@/components/shared";
import { DEFAULT_DICTATION_PREFERENCES, formatShortcut, hasConflictingDictationShortcuts, isStandaloneModifier, loadDictationPreferences, saveDictationPreferences, shortcutError, shortcutFromEvent, type DictationBinding, type DictationPreferences, type DictationShortcut, type SpeechMikeMode } from "@/lib/dictation-preferences";

export function DictationControlsPage() {
  const [preferences, setPreferences] = useState(loadDictationPreferences);
  const [capturing, setCapturing] = useState<DictationBinding | null>(null);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceNotice, setDeviceNotice] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectedEvents, setDetectedEvents] = useState<string[]>([]);
  const [detectionMessage, setDetectionMessage] = useState("");
  const save = (next: DictationPreferences) => {
    if (hasConflictingDictationShortcuts(next)) { setError("This shortcut is already used by another dictation control. Change that binding before switching modes or resetting."); return; }
    try { saveDictationPreferences(next); setPreferences(next); setError(""); }
    catch { setError("These preferences could not be saved. Allow browser local storage and try again."); }
  };
  useEffect(() => {
    if (!capturing) return;
    let modifier: DictationShortcut | null = null;
    const capture = (shortcut: DictationShortcut) => {
      if ((capturing === "speechMikeStart" || capturing === "speechMikeStop") && isStandaloneModifier(shortcut)) { setError("Choose a function key or numpad operator for separate SpeechMike Start/Stop commands."); return; }
      const invalid = shortcutError(shortcut);
      if (invalid) { setError(invalid); return; }
      const next = { ...preferences, [capturing]: shortcut };
      if (hasConflictingDictationShortcuts(next)) {
        setError("This shortcut is already used by another dictation control. Choose a different shortcut."); return;
      }
      try { saveDictationPreferences(next); setPreferences(next); setError(""); setCapturing(null); }
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
  useEffect(() => {
    if (!detecting) return;
    let received = false;
    const detect = (event: KeyboardEvent) => {
      if (event.code === "Tab") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.code === "Escape") { setDetecting(false); return; }
      received = true;
      const shortcut = shortcutFromEvent(event);
      const modifier = /^(Shift|Control|Alt|Meta)(Left|Right)$/.test(event.code);
      // Never retain ordinary typing or arbitrary event.key text in the diagnostic log.
      if (!modifier && shortcutError(shortcut)) { setDetectionMessage("Reserved or text-entry key ignored. Press the mapped SpeechMike button instead."); return; }
      const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta"].filter(Boolean).join(" + ") || "none";
      const eventName = event.type === "keydown" ? "Keydown" : "Keyup";
      setDetectedEvents((events) => [...events.slice(-7), `${eventName} · code: ${event.code} · key: ${event.key} · modifiers: ${modifiers}${event.repeat ? " · repeat" : ""}`]);
      if (!shortcutError(shortcut)) setDetectionMessage(`Detected: ${formatShortcut(shortcut)}. This shortcut can be used for dictation.`);
    };
    const timeout = setTimeout(() => {
      setDetecting(false);
      if (!received) setDetectionMessage("No keyboard event detected. Configure the SpeechMike button as a keyboard shortcut in Philips SpeechControl.");
    }, 10_000);
    const cancel = () => setDetecting(false);
    window.addEventListener("keydown", detect, true); window.addEventListener("keyup", detect, true); window.addEventListener("blur", cancel);
    return () => { clearTimeout(timeout); window.removeEventListener("keydown", detect, true); window.removeEventListener("keyup", detect, true); window.removeEventListener("blur", cancel); };
  }, [detecting]);
  const refreshDevices = async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) throw new Error("Microphone selection is unavailable in this browser.");
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default"));
      setDeviceNotice("If names are hidden, allow microphone access during a recording, then refresh this list.");
    } catch (e) { setDeviceNotice(e instanceof Error ? e.message : "Could not list microphones."); }
  };
  const captureButton = (binding: DictationBinding, label: string) => <Button type="button" variant="secondary" disabled={capturing !== null || detecting} onClick={() => { setError(""); setCapturing(binding); }}>{label}</Button>;
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
      <label className="block text-sm font-semibold">Recording Mode<select aria-label="SpeechMike recording mode" className="input-premium mt-1 w-full" value={preferences.speechMikeMode} disabled={capturing !== null || detecting} onChange={(event) => save({ ...preferences, speechMikeMode: event.target.value as SpeechMikeMode })}><option value="hold">Hold-to-Talk</option><option value="toggle">Toggle</option><option value="separate">Separate Start/Stop</option></select></label>
      {preferences.speechMikeMode === "separate" ? <>
      <p>Start shortcut: <kbd>{formatShortcut(preferences.speechMikeStart)}</kbd></p>{captureButton("speechMikeStart", "Capture Start Shortcut")}
      <p>Stop shortcut: <kbd>{formatShortcut(preferences.speechMikeStop)}</kbd></p>{captureButton("speechMikeStop", "Capture Stop Shortcut")}
      </> : <><p>Recording shortcut: <kbd>{formatShortcut(preferences.speechMikeShortcut)}</kbd></p>{captureButton("speechMikeShortcut", "Capture SpeechMike Shortcut")}</>}
      <div><Button type="button" variant="ghost" disabled={capturing !== null || detecting} onClick={() => save({ ...preferences, speechMikeEnabled: false, speechMikeMode: "separate", speechMikeShortcut: DEFAULT_DICTATION_PREFERENCES.speechMikeShortcut, speechMikeStart: DEFAULT_DICTATION_PREFERENCES.speechMikeStart, speechMikeStop: DEFAULT_DICTATION_PREFERENCES.speechMikeStop })}>Reset SpeechMike to default</Button></div>
      <p className="text-sm text-muted-foreground">{preferences.speechMikeMode === "hold" ? "Hold the mapped shortcut to record; release it to transcribe. If the device sends an immediate Keydown/Keyup pair, use Toggle or configure sustained press/release events in SpeechControl." : preferences.speechMikeMode === "toggle" ? "Press once to record and again to stop and transcribe. Key release does not toggle recording. Numpad + can be captured when the device sends that shortcut." : "Map separate Start/Stop commands in Philips SpeechControl (initial suggestion: F13 to start, F14 to stop). A press and release may send different shortcuts. Key release alone does not stop recording."}</p>
      <Button type="button" variant="secondary" size="sm" disabled={capturing !== null} onClick={() => { if (detecting) setDetecting(false); else { setDetectedEvents([]); setDetectionMessage(""); setDetecting(true); } }}>{detecting ? "Stop detection" : "Detect SpeechMike Button"}</Button>
      {detecting && <p className="text-sm" role="status">Press and release the microphone button within 10 seconds. Escape stops detection. Audio is not recorded.</p>}
      {detectedEvents.length > 0 && <ul aria-label="Detected keyboard events" className="space-y-1 break-words font-mono text-xs">{detectedEvents.map((event, index) => <li key={index}>{event}</li>)}</ul>}
      {detectionMessage && <p role="status" className="text-sm">{detectionMessage}</p>}
      <p className="text-sm text-muted-foreground">If nothing is captured, configure keyboard mapping in Philips SpeechControl. RISpro sees keyboard events and cannot distinguish a SpeechMike from a keyboard sending the same shortcut. Detection does not change your bindings.</p>
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
