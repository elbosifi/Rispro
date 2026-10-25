import { useEffect, useState } from "react";
import { ChevronDown, Loader2, Mic } from "lucide-react";
import { AnchoredMenu, Button } from "@/components/shared";
import { useDictation } from "@/providers/dictation-context";
import { useLanguage } from "@/providers/language-provider";
import { DictationControlsPage } from "@/pages/doctor/dictation-controls-page";

export function DictationControl() {
  const dictation = useDictation();
  return dictation ? <ActiveDictationControl dictation={dictation} /> : null;
}

function ActiveDictationControl({ dictation }: { dictation: NonNullable<ReturnType<typeof useDictation>> }) {
  const { t, isArabic } = useLanguage();
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(() => Math.min(560, typeof window === "undefined" ? 560 : window.innerWidth - 20));
  useEffect(() => {
    const resize = () => setWidth(Math.min(560, window.innerWidth - 20));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const label = t(dictation.processing ? "dictation.globalProcessing" : dictation.recording ? "dictation.globalStop" : "dictation.globalStart");
  return <div data-dictation-toolbar className="flex shrink-0 items-center rounded-lg border border-border bg-background">
    <Button type="button" variant="ghost" size="icon" className="!h-9 !min-h-9 !w-9 !p-0" aria-label={label} title={label} aria-pressed={dictation.recording} disabled={dictation.processing || open} onMouseDown={(event) => event.preventDefault()} onClick={dictation.toggle}
      style={dictation.recording ? { color: "var(--state-error-text)", backgroundColor: "var(--state-error-bg)" } : undefined}>
      {dictation.processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mic className={`h-4 w-4 ${dictation.recording ? "animate-pulse" : ""}`} aria-hidden="true" />}
    </Button>
    <AnchoredMenu open={open} onOpenChange={setOpen} width={width} dir={isArabic ? "rtl" : "ltr"}
      trigger={<Button type="button" variant="ghost" className="!h-9 !min-h-9 !w-6 !px-0" aria-label={t("dictation.controlsTitle")} title={t("dictation.controlsTitle")} onClick={dictation.cancel}><ChevronDown className="h-3 w-3" aria-hidden="true" /></Button>}>
      <div className="p-2" data-dictation-toolbar><DictationControlsPage /></div>
    </AnchoredMenu>
    <span className="sr-only" role="status">{label}</span>
  </div>;
}
