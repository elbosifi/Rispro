import { HTMLAttributes, forwardRef } from "react";

type CardVariant = "default" | "elevated" | "compact" | "featured";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "default", className = "", children, ...props }, ref) => {
    const variantClasses = {
      default: "",
      elevated: "card-elevated",
      compact: "p-4",
      featured: ""
    };

    if (variant === "featured") {
      return (
        <div ref={ref} className={`card-featured ${className}`.trim()} {...props}>
          <div className="card-featured-inner p-6">
            {children}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={`card-shell ${variantClasses[variant]} ${className}`.trim()}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
