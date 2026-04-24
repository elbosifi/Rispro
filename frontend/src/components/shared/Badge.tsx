import { HTMLAttributes, forwardRef } from "react";

type BadgeVariant =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "accent"
  | "available"
  | "blocked"
  | "restricted"
  | "full"
  | "requires_override"
  | "selected"
  | "disabled"
  | "draft"
  | "live"
  | "legacy"
  | "v2"
  | "v3";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "default" | "sm";
}

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  success: "state-chip state-chip--success",
  warning: "state-chip state-chip--warning",
  error: "state-chip state-chip--error",
  info: "state-chip state-chip--info",
  neutral: "state-chip state-chip--disabled",
  accent: "state-chip state-chip--live",
  available: "state-chip state-chip--available",
  blocked: "state-chip state-chip--blocked",
  restricted: "state-chip state-chip--restricted",
  full: "state-chip state-chip--full",
  requires_override: "state-chip state-chip--requires_override",
  selected: "state-chip state-chip--selected",
  disabled: "state-chip state-chip--disabled",
  draft: "state-chip state-chip--draft",
  live: "state-chip state-chip--live",
  legacy: "state-chip state-chip--legacy",
  v2: "state-chip state-chip--v2",
  v3: "state-chip state-chip--v3",
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "neutral", size = "default", className = "", style = {}, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={`${BADGE_VARIANTS[variant]} ${size === "sm" ? "text-[0.72rem]" : "text-[0.8rem]"} ${className}`.trim()}
        style={{
          ...style,
        }}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = "Badge";
