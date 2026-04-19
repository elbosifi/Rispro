import { HTMLAttributes, forwardRef } from "react";

interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  message?: string;
}

export const LoadingState = forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ message = "Loading...", className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={`p-8 text-center ${className}`}
        style={{ color: "var(--text-muted)" }}
        {...props}
      >
        <div className="spinner-industrial mx-auto mb-4 w-8 h-8" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }
);

LoadingState.displayName = "LoadingState";
