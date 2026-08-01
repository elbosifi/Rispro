import QzTrayPrintingSection from "@/pages/settings/qz-tray-printing-section";

export default function WorkstationPrintingPage() {
  return <div className="mx-auto w-full max-w-6xl space-y-4"><div><h1 className="text-2xl font-semibold">Workstation printing</h1><p className="text-sm text-muted-foreground">Configure QZ Tray and physical printer mappings for this browser only.</p></div><QzTrayPrintingSection /></div>;
}
