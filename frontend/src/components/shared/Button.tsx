import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "default" | "sm" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "default", className = "", children, ...props }, ref) => {
    const baseClass = `btn-${variant}`;
    
    const sizeClasses = {
      sm: "h-10 px-3 text-sm",
      default: "h-12 px-4",
      lg: "h-14 px-6 text-base",
      icon: "w-12 h-12 p-0"
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
