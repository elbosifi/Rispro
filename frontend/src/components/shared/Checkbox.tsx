import { InputHTMLAttributes, forwardRef } from "react";

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { onCheckedChange?: (checked: boolean) => void };

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className = "", onCheckedChange, onChange, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={`h-4 w-4 rounded border border-border bg-background text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 ${className}`.trim()}
        {...props}
        onChange={(event) => { onChange?.(event); onCheckedChange?.(event.target.checked); }}
      />
    );
  }
);

Checkbox.displayName = "Checkbox";
