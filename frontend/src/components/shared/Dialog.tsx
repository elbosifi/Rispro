import {
  createContext,
  useContext,
  useEffect,
  ReactNode,
  forwardRef,
  HTMLAttributes,
} from "react";
import { X } from "lucide-react";

interface DialogContextType {
  open: boolean;
  onClose: () => void;
}

const DialogContext = createContext<DialogContextType | null>(null);

function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("Dialog components must be used within a Dialog");
  }
  return context;
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

function Dialog({ open, onClose, children }: DialogProps) {
  return (
    <DialogContext.Provider value={{ open, onClose }}>
      {open && children}
    </DialogContext.Provider>
  );
}

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  maxWidth?: string;
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ children, maxWidth = "400px", className = "", ...props }, ref) => {
    const { onClose } = useDialog();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    // Focus first interactive element when opened
    if (ref && typeof ref !== "function" && ref.current) {
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }
  }, [ref]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={handleBackdropClick}
      {...props}
    >
      {/* Backdrop */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.5)"
      }} />

      {/* Dialog */}
      <div
        ref={ref}
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth,
          margin: "0 16px",
          padding: 24,
          borderRadius: "var(--radius-xl)",
          backgroundColor: "var(--background)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-floating)",
        }}
        className={className}
      >
        {children}
      </div>
     </div>
   );
});

DialogContent.displayName = "DialogContent";

interface DialogHeaderProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  showClose?: boolean;
}

const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ children, showClose = true, className = "", ...props }, ref) => {
    const { onClose } = useDialog();

    return (
      <div
        ref={ref}
        className={className}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}
        {...props}
      >
        <div style={{ flex: 1 }}>{children}</div>
        {showClose && (
          <button
            onClick={onClose}
            className="btn-ghost"
            style={{ width: 32, height: 32, padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <X size={16} />
          </button>
        )}
     </div>
   );
});

DialogHeader.displayName = "DialogHeader";

interface DialogTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
}

const DialogTitle = forwardRef<HTMLHeadingElement, DialogTitleProps>(
  ({ children, className = "", ...props }, ref) => {
    return (
      <h3
        ref={ref}
        className={className}
        style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "var(--text)" }}
        {...props}
      >
        {children}
      </h3>
    );
  }
);

DialogTitle.displayName = "DialogTitle";

interface DialogDescriptionProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

const DialogDescription = forwardRef<HTMLParagraphElement, DialogDescriptionProps>(
  ({ children, className = "", ...props }, ref) => {
    return (
      <p
        ref={ref}
        className={className}
        style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0 0" }}
        {...props}
      >
        {children}
      </p>
    );
  }
);

DialogDescription.displayName = "DialogDescription";

interface DialogFooterProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const DialogFooter = forwardRef<HTMLDivElement, DialogFooterProps>(
  ({ children, className = "", ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={className}
        style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 24 }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

DialogFooter.displayName = "DialogFooter";

export { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter };
