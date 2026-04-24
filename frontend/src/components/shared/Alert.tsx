import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  children: ReactNode;
}

const ALERT_VARIANTS: Record<AlertVariant, string> = {
  info: "alert-shell alert-shell--info",
  success: "alert-shell alert-shell--success",
  warning: "alert-shell alert-shell--warning",
  error: "alert-shell alert-shell--error",
};

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ variant = "info", className = "", children, ...props }, ref) => {
    return (
      <div ref={ref} className={`${ALERT_VARIANTS[variant]} ${className}`.trim()} {...props}>
        {children}
      </div>
    );
  }
);

Alert.displayName = "Alert";

export function AlertTitle({ className = "", children, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h4 className={`text-sm font-semibold ${className}`.trim()} {...props}>
      {children}
    </h4>
  );
}

export function AlertDescription({ className = "", children, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-1 text-sm ${className}`.trim()} {...props}>
      {children}
    </p>
  );
}
