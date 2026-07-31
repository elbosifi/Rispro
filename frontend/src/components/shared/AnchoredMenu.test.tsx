import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnchoredMenu } from "./AnchoredMenu";

afterEach(cleanup);

describe("AnchoredMenu", () => {
  it("renders in the document body, supports keyboard navigation, and closes outside", async () => {
    const onOpenChange = vi.fn();
    render(<AnchoredMenu open onOpenChange={onOpenChange} trigger={<button type="button">More actions</button>}><button type="button" role="menuitem">First action</button><button type="button" role="menuitem">Second action</button></AnchoredMenu>);

    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "First action" })));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Second action" }));
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return <AnchoredMenu open={open} onOpenChange={setOpen} trigger={<button type="button">More actions</button>}><button type="button" role="menuitem">Change status</button></AnchoredMenu>;
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("opens inward from an RTL trigger near the left edge", async () => {
    const rect = vi.spyOn(HTMLSpanElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 40, right: 64, top: 40, bottom: 64, width: 24, height: 24, x: 40, y: 40, toJSON: () => ({}) });
    render(<AnchoredMenu open onOpenChange={vi.fn()} dir="rtl" width={120} trigger={<button type="button">More actions</button>}><button type="button" role="menuitem">First action</button></AnchoredMenu>);

    await waitFor(() => expect(screen.getByRole("menu").style.left).toBe("40px"));
    rect.mockRestore();
  });

  it("opens inward from an LTR trigger near the right edge and flips when needed", async () => {
    const rect = vi.spyOn(HTMLSpanElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 860, right: 884, top: 40, bottom: 64, width: 24, height: 24, x: 860, y: 40, toJSON: () => ({}) });
    render(<AnchoredMenu open onOpenChange={vi.fn()} dir="ltr" width={120} trigger={<button type="button">More actions</button>}><button type="button" role="menuitem">First action</button></AnchoredMenu>);

    await waitFor(() => expect(screen.getByRole("menu").style.left).toBe("764px"));
    rect.mockRestore();
  });
});
