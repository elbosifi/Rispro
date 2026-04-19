import { HTMLAttributes, forwardRef } from "react";

interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  pulsing?: boolean;
}

export const SectionLabel = forwardRef<HTMLDivElement, SectionLabelProps>(
  ({ pulsing = false, className = "", children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`section-label ${className}`.trim()}
        {...props}
      >
        <span className={`section-label-dot ${pulsing ? "animate-pulse-dot" : ""}`} />
        <span className="section-label-text">
          {children}
        </span>
      </div>
    );
  }
);

SectionLabel.displayName = "SectionLabel";
