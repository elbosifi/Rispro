import { HTMLAttributes, forwardRef } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorStateProps extends HTMLAttributes<HTMLDivElement> {
  message?: string;
  onRetry?: () => void;
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(
  ({ message = "An error occurred", onRetry, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`p-8 text-center ${className}`}
        {...props}
      >
        <AlertTriangle className="mx-auto mb-4" style={{ color: "var(--accent)", opacity: 0.8 }} size={32} />
        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>{message}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="btn-secondary text-xs"
          >
            Retry
          </button>
        )}
      </div>
    );
  }
);

ErrorState.displayName = "ErrorState";
