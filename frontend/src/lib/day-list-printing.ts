import { buildDayListPrintUrl, type DayListPrintRouteOptions } from "@/lib/print-routing";

export function printDayListFromRoute(options: DayListPrintRouteOptions): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.left = "-10000px";
  frame.style.top = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.src = buildDayListPrintUrl({ ...options, autoprint: true });

  const cleanup = () => {
    window.setTimeout(() => frame.remove(), 1000);
  };

  frame.addEventListener("load", () => {
    const printWindow = frame.contentWindow;
    if (!printWindow) {
      cleanup();
      return;
    }
    printWindow.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(cleanup, 30_000);
  }, { once: true });

  document.body.appendChild(frame);
}
