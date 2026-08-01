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

interface BodyScrollLockSnapshot {
  scrollX: number;
  scrollY: number;
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyWidth: string;
  bodyPaddingRight: string;
  bodyOverscrollBehavior: string;
  documentOverscrollBehavior: string;
}

let bodyScrollLockCount = 0;
let bodyScrollLockSnapshot: BodyScrollLockSnapshot | null = null;

function lockBodyScroll() {
  if (typeof document === "undefined" || typeof window === "undefined") return;

  if (bodyScrollLockCount === 0) {
    const body = document.body;
    const documentElement = document.documentElement;
    const scrollBarWidth = documentElement.clientWidth > 0
      ? Math.max(0, window.innerWidth - documentElement.clientWidth)
      : 0;
    bodyScrollLockSnapshot = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
      bodyPaddingRight: body.style.paddingRight,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      documentOverscrollBehavior: documentElement.style.overscrollBehavior,
    };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${bodyScrollLockSnapshot.scrollY}px`;
    body.style.left = `-${bodyScrollLockSnapshot.scrollX}px`;
    body.style.width = "100%";
    if (scrollBarWidth > 0) body.style.paddingRight = `${scrollBarWidth}px`;
    body.style.overscrollBehavior = "none";
    documentElement.style.overscrollBehavior = "none";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
  if (bodyScrollLockCount === 0) return;
  bodyScrollLockCount -= 1;
  if (bodyScrollLockCount > 0 || !bodyScrollLockSnapshot || typeof document === "undefined" || typeof window === "undefined") return;

  const body = document.body;
  const documentElement = document.documentElement;
  const snapshot = bodyScrollLockSnapshot;
  body.style.overflow = snapshot.bodyOverflow;
  body.style.position = snapshot.bodyPosition;
  body.style.top = snapshot.bodyTop;
  body.style.left = snapshot.bodyLeft;
  body.style.width = snapshot.bodyWidth;
  body.style.paddingRight = snapshot.bodyPaddingRight;
  body.style.overscrollBehavior = snapshot.bodyOverscrollBehavior;
  documentElement.style.overscrollBehavior = snapshot.documentOverscrollBehavior;
  bodyScrollLockSnapshot = null;
  window.scrollTo(snapshot.scrollX, snapshot.scrollY);
}

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
  useEffect(() => {
    if (!open) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open]);

  return (
    <DialogContext.Provider value={{ open, onClose }}>
      {open && children}
    </DialogContext.Provider>
  );
}

interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  maxWidth?: string;
  scrollable?: boolean;
}

const DialogContent = forwardRef<HTMLDivElement, DialogContentProps>(
  ({ children, maxWidth = "400px", scrollable = true, className = "", ...props }, ref) => {
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
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overscrollBehavior: "contain",
      }}
      onClick={handleBackdropClick}
      {...props}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "rgba(0,0,0,0.5)"
        }}
        onClick={onClose}
      />

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
          maxHeight: "calc(100vh - 32px)",
          overflow: scrollable ? "auto" : "hidden",
          overscrollBehavior: "contain",
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
  closeLabel?: string;
}

const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  ({ children, showClose = true, closeLabel = "Close dialog", className = "", ...props }, ref) => {
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
            type="button"
            onClick={onClose}
            className="btn-ghost"
            aria-label={closeLabel}
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
