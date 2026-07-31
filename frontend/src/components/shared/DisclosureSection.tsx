import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type DisclosureSectionProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
};

export function DisclosureSection({ title, children, defaultOpen = false, className = "" }: DisclosureSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section className={`border-t border-border/70 pt-3 ${className}`.trim()}>
      <button
        type="button"
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg text-start text-sm font-semibold text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        <ChevronDown className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} size={18} aria-hidden="true" />
      </button>
      {open ? <div id={contentId} className="mt-3">{children}</div> : null}
    </section>
  );
}
