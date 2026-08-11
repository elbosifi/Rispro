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

  it("closes only the topmost nested dialog on Escape and restores scrolling after the parent closes", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    function Harness() {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(false);
      return (
        <>
          <button type="button">Page control</button>
          <Dialog open={parentOpen} onClose={() => setParentOpen(false)}>
            <DialogContent aria-label="Parent dialog">
              <button type="button" onClick={() => setChildOpen(true)}>Open child</button>
              <Dialog open={childOpen} onClose={() => setChildOpen(false)}>
                <DialogContent aria-label="Child dialog">
                  <button type="button">Child action</button>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    expect(document.body.style.position).toBe("fixed");

    const openChild = screen.getByRole("button", { name: "Open child" });
    fireEvent.click(openChild);
    expect(screen.getByRole("dialog", { name: "Child dialog" })).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Child dialog" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Parent dialog" })).not.toBeNull();
    expect(document.body.style.position).toBe("fixed");
    expect(document.activeElement).toBe(openChild);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Parent dialog" })).toBeNull();
    expect(document.body.style.position).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(18, 240);
  });
});

describe("Dialog focus behavior", () => {
  it("moves focus inside without a caller ref and restores it on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog open={open} onClose={() => setOpen(false)}>
            <DialogContent aria-label="Focus dialog"><button type="button">First action</button></DialogContent>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "First action" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("contains Tab and Shift+Tab inside the topmost dialog", () => {
    render(
      <>
        <button type="button">Page control</button>
        <Dialog open onClose={() => undefined}>
          <DialogContent aria-label="Keyboard dialog">
            <button type="button">First</button>
            <button type="button">Last</button>
          </DialogContent>
        </Dialog>
      </>,
    );

    const first = screen.getByRole("button", { name: "First" });
    const last = screen.getByRole("button", { name: "Last" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("focuses dialog content when there is no interactive child and only the topmost backdrop closes a dialog", () => {
    function Harness() {
      const [parentOpen, setParentOpen] = useState(true);
      const [childOpen, setChildOpen] = useState(true);
      return (
        <Dialog open={parentOpen} onClose={() => setParentOpen(false)}>
          <DialogContent aria-label="Parent backdrop dialog">
            Parent
            <Dialog open={childOpen} onClose={() => setChildOpen(false)}>
              <DialogContent aria-label="Child backdrop dialog">Child</DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Harness />);
    const parent = screen.getByRole("dialog", { name: "Parent backdrop dialog" });
    const child = screen.getByRole("dialog", { name: "Child backdrop dialog" });
    expect(child.contains(document.activeElement)).toBe(true);

    fireEvent.click(parent.firstElementChild!);
    expect(screen.getByRole("dialog", { name: "Child backdrop dialog" })).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Parent backdrop dialog" })).not.toBeNull();

    fireEvent.click(child.firstElementChild!);
    expect(screen.queryByRole("dialog", { name: "Child backdrop dialog" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Parent backdrop dialog" })).not.toBeNull();
  });

  it("skips hidden and disabled controls when entering and trapping focus", () => {
    render(
      <Dialog open onClose={() => undefined}>
        <DialogContent aria-label="Usable controls dialog">
          <button type="button" disabled>Disabled</button>
          <div hidden><button type="button">Hidden attribute</button></div>
          <div aria-hidden="true"><button type="button">Aria hidden</button></div>
          <div inert><button type="button">Inert</button></div>
          <div style={{ display: "none" }}><button type="button">Display none</button></div>
          <div style={{ visibility: "hidden" }}><button type="button">Visibility hidden</button></div>
          <button type="button">First visible</button>
          <button type="button">Last visible</button>
          <div style={{ visibility: "collapse" }}><button type="button">Collapsed</button></div>
        </DialogContent>
      </Dialog>,
    );

    const first = screen.getByRole("button", { name: "First visible" });
    const last = screen.getByRole("button", { name: "Last visible" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    expect(document.activeElement?.textContent).not.toMatch(/Disabled|Hidden|Inert|none|hidden|Collapsed/i);
  });

  it("restores the page opener when a parent and child unmount together", () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    function Harness() {
      const [parentOpen, setParentOpen] = useState(false);
      const [childOpen, setChildOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setParentOpen(true)}>Page opener</button>
          <Dialog open={parentOpen} onClose={() => setParentOpen(false)}>
            <DialogContent aria-label="Teardown parent">
              <button type="button" onClick={() => setChildOpen(true)}>Open teardown child</button>
              <button type="button" onClick={() => setParentOpen(false)}>Remove parent</button>
              <Dialog open={childOpen} onClose={() => setChildOpen(false)}>
                <DialogContent aria-label="Teardown child"><button type="button">Child action</button></DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Page opener" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Open teardown child" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove parent" }));

    expect(screen.queryByRole("dialog", { name: "Teardown parent" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Teardown child" })).toBeNull();
    expect(document.body.style.position).toBe("");
    expect(document.activeElement).toBe(opener);
    expect(scrollTo).toHaveBeenCalledWith(18, 240);
  });
});
