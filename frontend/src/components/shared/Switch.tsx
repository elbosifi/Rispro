import { InputHTMLAttributes, forwardRef } from "react";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(
  ({ className = "", ...props }, ref) => {
    return (
      <label className={`relative inline-flex h-6 w-11 items-center ${className}`.trim()}>
        <input
          ref={ref}
          type="checkbox"
          className="peer sr-only"
          {...props}
        />
        <span className="absolute inset-0 rounded-full border border-border bg-muted transition-colors peer-checked:border-accent/35 peer-checked:bg-accent/15" />
        <span className="relative left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-5 peer-checked:bg-accent" />
      </label>
    );
  }
);

Switch.displayName = "Switch";
