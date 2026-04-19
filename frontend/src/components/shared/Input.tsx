import { InputHTMLAttributes, forwardRef } from "react";

type InputVariant = "default";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ variant = "default", className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`input-premium ${className}`.trim()}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
