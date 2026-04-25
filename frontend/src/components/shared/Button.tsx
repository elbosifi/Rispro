import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "default", className = "", children, ...props }, ref) => {
    const baseClass = `btn-${variant}`;
    
    const sizeClasses = {
      sm: "h-[var(--control-height-sm)] px-3 text-sm",
      default: "h-[var(--control-height-md)] px-4",
      lg: "h-[var(--control-height-lg)] px-6 text-base",
      icon: "w-[var(--control-height-md)] h-[var(--control-height-md)] p-0"
    };

    return (
      <button
        ref={ref}
        className={`${baseClass} ${sizeClasses[size]} ${className}`.trim()}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
