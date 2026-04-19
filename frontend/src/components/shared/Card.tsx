import { HTMLAttributes, forwardRef } from "react";

type CardVariant = "default" | "elevated" | "compact";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "default", className = "", children, ...props }, ref) => {
    const variantClass = variant === "elevated" ? "card-elevated" : "";
    const paddingClass = variant === "compact" ? "p-4" : "";

    return (
      <div
        ref={ref}
        className={`card-shell ${variantClass} ${paddingClass} ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
