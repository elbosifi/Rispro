import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SopReadOnlyDocument, SopStructuredEditor } from "./sop-editor";
import { createEmptySopDocument } from "./sop-document";

const oneSection = [{ key: "purpose", title: "Purpose", required: true }];

describe("SOP structured editor", () => {
  beforeEach(() => {
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  });

  it("creates the canonical section shape and exposes rich text, table, alignment, and direction controls", async () => {
    const user = userEvent.setup();
    const value = createEmptySopDocument(oneSection);
    render(<SopStructuredEditor value={value} editable />);
    expect(value.sections).toHaveLength(1);
    expect(value.sections[0]?.content).toMatchObject({ type: "doc" });
    expect(screen.getByRole("toolbar", { name: "SOP formatting toolbar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Italic" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Underline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bullet list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Numbered list" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Insert table" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Align left" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "RTL" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "LTR" })).toBeTruthy();
    const editor = document.querySelector(".ProseMirror") as HTMLElement;
    await user.click(editor);
    await user.click(screen.getByRole("button", { name: "RTL" }));
    expect(editor.querySelector("[dir='rtl']")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Insert table" }));
    expect(editor.querySelector("table")).toBeTruthy();
  });

  it("renders the same structured document read-only without editing controls", () => {
    const value = createEmptySopDocument(oneSection);
    render(<SopReadOnlyDocument value={value} />);
    expect(screen.queryByRole("toolbar", { name: "SOP formatting toolbar" })).toBeNull();
    expect(document.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false");
  });
});
