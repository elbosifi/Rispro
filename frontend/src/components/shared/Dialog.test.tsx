import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Dialog, DialogContent } from "./Dialog";

afterEach(() => {
  cleanup();
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  vi.restoreAllMocks();
});

beforeEach(() => {
  Object.defineProperty(window, "scrollX", { configurable: true, value: 18 });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
});

describe("Dialog body scroll lock", () => {
  it("locks page scrolling while open and restores the original position and styles", () => {
    document.body.style.overflow = "auto";
    document.body.style.position = "relative";
    document.body.style.top = "12px";
    document.body.style.left = "4px";
    document.body.style.width = "80%";
    document.body.style.paddingRight = "5px";
    document.body.style.overscrollBehavior = "auto";
    document.documentElement.style.overscrollBehavior = "auto";
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>Close</button>
          <Dialog open={open} onClose={() => setOpen(false)}>
            <DialogContent>Dialog content</DialogContent>
          </Dialog>
        </>
      );
    }

    render(<Harness />);

    expect(document.body.style.overflow).toBe("hidden");
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-240px");
    expect(document.body.style.left).toBe("-18px");
    expect(document.body.style.overscrollBehavior).toBe("none");
    expect(document.documentElement.style.overscrollBehavior).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(document.body.style.overflow).toBe("auto");
    expect(document.body.style.position).toBe("relative");
    expect(document.body.style.top).toBe("12px");
    expect(document.body.style.left).toBe("4px");
    expect(document.body.style.width).toBe("80%");
    expect(document.body.style.paddingRight).toBe("5px");
    expect(document.body.style.overscrollBehavior).toBe("auto");
    expect(document.documentElement.style.overscrollBehavior).toBe("auto");
    expect(scrollTo).toHaveBeenCalledWith(18, 240);
  });

  it("keeps the lock until the final nested dialog closes", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    function Harness() {
      const [parentOpen, setParentOpen] = useState(true);
      const [nestedOpen, setNestedOpen] = useState(false);
      return (
        <Dialog open={parentOpen} onClose={() => setParentOpen(false)}>
          <DialogContent>
            <button type="button" onClick={() => setNestedOpen(true)}>Open nested</button>
            <button type="button" onClick={() => setParentOpen(false)}>Close parent</button>
            <Dialog open={nestedOpen} onClose={() => setNestedOpen(false)}>
              <DialogContent>
                <button type="button" onClick={() => setNestedOpen(false)}>Close nested</button>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Harness />);
    expect(document.body.style.position).toBe("fixed");

    fireEvent.click(screen.getByRole("button", { name: "Open nested" }));
    fireEvent.click(screen.getByRole("button", { name: "Close nested" }));
    expect(document.body.style.position).toBe("fixed");

    fireEvent.click(screen.getByRole("button", { name: "Close parent" }));
    expect(document.body.style.position).toBe("");
  });
});
