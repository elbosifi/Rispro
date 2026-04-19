import { HTMLAttributes, forwardRef } from "react";

type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "default" | "sm";
}

const BADGE_VARIANTS: Record<BadgeVariant, { color: string; bg: string }> = {
  success: { color: "var(--green)", bg: "rgba(34, 197, 94, 0.1)" },
  warning: { color: "var(--amber)", bg: "rgba(245, 158, 11, 0.1)" },
  error: { color: "var(--accent)", bg: "rgba(255, 71, 87, 0.1)" },
  info: { color: "var(--blue)", bg: "rgba(59, 130, 246, 0.1)" },
  neutral: { color: "var(--text-muted)", bg: "var(--muted)" },
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "neutral", size = "default", className = "", style = {}, children, ...props }, ref) => {
    const { color, bg } = BADGE_VARIANTS[variant];
    const padding = size === "sm" ? "2px 8px" : "4px 12px";
    const fontSize = size === "sm" ? "0.75rem" : "0.8rem";

    return (
      <span
        ref={ref}
        className={className}
        style={{
          display: "inline-block",
          padding,
          borderRadius: "var(--radius-sm)",
          fontSize,
          fontWeight: 600,
          color,
          backgroundColor: bg,
          width: "fit-content",
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
