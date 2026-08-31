import type { CSSProperties, ReactNode } from "react";

interface NavigationMenuItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  showTooltip?: boolean;
  animationDelayMs?: number;
  attentionPulse?: boolean;
  eventFlash?: "success" | "attention" | null;
  trailing?: ReactNode;
  onClick: () => void;
}

export function NavigationMenuItem({
  icon,
  label,
  active = false,
  collapsed = false,
  showTooltip = true,
  animationDelayMs,
  attentionPulse = false,
  eventFlash = null,
  trailing,
  onClick,
}: NavigationMenuItemProps) {
  const buttonStyle: CSSProperties = {
    backgroundColor: eventFlash === "success" ? "color-mix(in srgb, #059669 18%, transparent)" : eventFlash === "attention" ? "color-mix(in srgb, #dc2626 18%, transparent)" : active ? "color-mix(in srgb, var(--accent) 12%, transparent)" : attentionPulse ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "transparent",
    color: active ? "var(--accent)" : "var(--foreground)",
    border: eventFlash === "success" ? "1px solid color-mix(in srgb, #059669 50%, var(--border))" : eventFlash === "attention" ? "1px solid color-mix(in srgb, #dc2626 50%, var(--border))" : active ? "1px solid color-mix(in srgb, var(--accent) 28%, var(--border))" : "1px solid transparent",
    boxShadow: active || attentionPulse || eventFlash ? "var(--shadow-sm)" : "none",
    animationDelay: animationDelayMs == null ? undefined : `${animationDelayMs}ms`,
  };

  return (
    <button
      type="button"
      className={`nav-item-reveal group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm font-medium transition-colors duration-150 ${attentionPulse ? "animate-pulse" : ""} ${eventFlash ? "motion-safe:animate-pulse" : ""} ${collapsed ? "justify-center px-2" : ""}`}
      style={buttonStyle}
      data-active={active ? "true" : "false"}
      data-attention-pulse={attentionPulse ? "true" : "false"}
      data-event-flash={eventFlash ?? undefined}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      aria-label={label}
      title={collapsed && showTooltip ? label : undefined}
    >
      {active ? <span className="absolute start-0 inset-y-1 w-0.5 rounded-full bg-accent" aria-hidden="true" /> : null}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-accent transition-colors group-hover:text-foreground" style={{ color: active ? "var(--accent)" : "var(--muted-foreground)" }}>
        {icon}
      </span>
      <span className={`${collapsed ? "sr-only" : "min-w-0 flex-1 truncate"} leading-tight`}>
        {label}
      </span>
      {trailing ? <span className="ms-auto shrink-0">{trailing}</span> : null}
    </button>
  );
}
