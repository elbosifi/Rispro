import { HTMLAttributes, forwardRef } from "react";

interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  message?: string;
  icon?: React.ReactNode;
}

export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ message = "No data available", icon, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`p-8 text-center ${className}`}
        style={{ color: "var(--text-muted)" }}
        {...props}
      >
        {icon && <div className="mb-4 opacity-50">{icon}</div>}
        <p className="text-sm">{message}</p>
      </div>
    );
  }
);

EmptyState.displayName = "EmptyState";
