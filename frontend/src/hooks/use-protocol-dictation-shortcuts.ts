import { useEffect, useLayoutEffect, useRef } from "react";
import { isStandaloneModifier, matchesShortcut, type DictationPreferences } from "@/lib/dictation-preferences";

export function useProtocolDictationShortcuts(options: {
  enabled: boolean; preferences: DictationPreferences; isActive: () => boolean;
  start: () => void; stop: () => void; toggle: () => void;
}) {
  const latest = useRef(options);
  useLayoutEffect(() => { latest.current = options; }, [options]);
  useEffect(() => {
    const pressed = new Set<string>();
    let pending: ReturnType<typeof setTimeout> | undefined;
    let holdCode: string | null = null;
    const cancelPending = () => { clearTimeout(pending); pending = undefined; };
    const stop = () => { cancelPending(); pressed.clear(); holdCode = null; latest.current.stop(); };
    const down = (event: KeyboardEvent) => {
      const current = latest.current;
      if (!current.enabled || !document.hasFocus() || document.visibilityState === "hidden" || !current.isActive() || event.defaultPrevented || event.isComposing) return;
      const { preferences } = current;
      const separate = preferences.speechMikeEnabled && preferences.speechMikeMode === "separate";
      const speechStart = separate && matchesShortcut(event, preferences.speechMikeStart);
      const speechStop = separate && matchesShortcut(event, preferences.speechMikeStop);
      if (speechStart || speechStop) {
        cancelPending();
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.repeat) return;
        // SpeechControl Start/Stop are commands, independent of key release.
        if (speechStop) current.stop(); else current.start();
        return;
      }
      const speech = preferences.speechMikeEnabled && preferences.speechMikeMode !== "separate" && matchesShortcut(event, preferences.speechMikeShortcut);
      const keyboard = preferences.keyboardEnabled && matchesShortcut(event, preferences.keyboardShortcut);
      const shortcut = speech ? preferences.speechMikeShortcut : preferences.keyboardShortcut;
      if ((speech || keyboard) && !isStandaloneModifier(shortcut)) { event.preventDefault(); event.stopImmediatePropagation(); }
      if (event.repeat || pressed.has(event.code)) {
        pressed.add(event.code);
        if (!speech && !keyboard) cancelPending();
        return;
      }
      cancelPending();
      pressed.add(event.code);
      if (!speech && !keyboard) return;
      const mode = speech ? preferences.speechMikeMode : preferences.keyboardMode;
      const activate = () => {
        if (!latest.current.enabled || !document.hasFocus() || !latest.current.isActive()) return;
        if (mode === "toggle") current.toggle();
        else { holdCode = event.code; current.start(); }
      };
      if (isStandaloneModifier(shortcut)) {
        // Do not consume Shift: ordinary selection/typing must keep working.
        if (pressed.size === 1) pending = setTimeout(activate, 200);
      } else activate();
    };
    const up = (event: KeyboardEvent) => {
      pressed.delete(event.code);
      cancelPending();
      if (holdCode === event.code) { holdCode = null; latest.current.stop(); }
    };
    const visibility = () => { if (document.visibilityState === "hidden") stop(); };
    window.addEventListener("keydown", down, true); window.addEventListener("keyup", up, true);
    window.addEventListener("blur", stop); document.addEventListener("visibilitychange", visibility);
    return () => { cancelPending(); window.removeEventListener("keydown", down, true); window.removeEventListener("keyup", up, true); window.removeEventListener("blur", stop); document.removeEventListener("visibilitychange", visibility); };
  }, []);
}
