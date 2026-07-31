import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

type AnchoredMenuProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement<{ onClick?: (event: React.MouseEvent) => void; "aria-expanded"?: boolean; "aria-controls"?: string; "aria-haspopup"?: "menu" }>;
  children: ReactNode;
  dir?: "ltr" | "rtl";
  width?: number;
};

type Position = { top: number; left: number };

export function AnchoredMenu({ open, onOpenChange, trigger, children, dir = "ltr", width = 240 }: AnchoredMenuProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const menuId = useId();
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const margin = 10;
    const menuWidth = menuRef.current?.offsetWidth || width;
    const menuHeight = menuRef.current?.offsetHeight ?? 260;
    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    const leftCandidate = anchor.right - menuWidth;
    const rightCandidate = anchor.left;
    const leftSpace = Math.max(0, anchor.left - margin);
    const rightSpace = Math.max(0, window.innerWidth - anchor.right - margin);
    const preferredCandidate = dir === "rtl" ? rightCandidate : leftCandidate;
    const preferredSpace = dir === "rtl" ? rightSpace : leftSpace;
    const oppositeCandidate = dir === "rtl" ? leftCandidate : rightCandidate;
    const oppositeSpace = dir === "rtl" ? leftSpace : rightSpace;
    const rawLeft = preferredSpace >= menuWidth
      ? preferredCandidate
      : oppositeSpace >= menuWidth
        ? oppositeCandidate
        : preferredSpace >= oppositeSpace
          ? preferredCandidate
          : oppositeCandidate;
    const left = Math.min(Math.max(margin, rawLeft), maxLeft);
    const below = anchor.bottom + margin;
    const top = below + menuHeight <= window.innerHeight - margin || anchor.top < menuHeight + margin
      ? below
      : Math.max(margin, anchor.top - menuHeight - margin);
    setPosition({ top: Math.min(top, Math.max(margin, window.innerHeight - menuHeight - margin)), left });
  }, [dir, width]);

  useEffect(() => {
    if (!open) return;
    lastFocusedRef.current = anchorRef.current?.querySelector<HTMLElement>(":where(button, [href], input, select, textarea, [tabindex])") ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const positionTimer = window.setTimeout(updatePosition, 0);
    const onViewportChange = () => updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) onOpenChange(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (!menuRef.current || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    const focusTimer = window.setTimeout(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(positionTimer);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      lastFocusedRef.current?.focus();
    };
  }, [open, onOpenChange, updatePosition]);

  if (!isValidElement(trigger)) return null;
  const triggerWithProps = cloneElement(trigger, {
    onClick: (event: React.MouseEvent) => {
      trigger.props.onClick?.(event);
      if (!event.defaultPrevented) onOpenChange(!open);
    },
    "aria-expanded": open,
    "aria-controls": open ? menuId : undefined,
    "aria-haspopup": "menu",
  });

  return <><span ref={anchorRef} className="inline-flex">{triggerWithProps}</span>{open ? createPortal(<div ref={menuRef} id={menuId} role="menu" dir={dir} className="fixed max-h-[min(70vh,420px)] overflow-y-auto rounded-xl border border-border bg-background p-1.5 shadow-2xl" style={{ top: position.top, left: position.left, width, zIndex: 200 }} onClick={(event) => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) onOpenChange(false); }}>{children}</div>, document.body) : null}</>;
}
