import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { SopReadOnlyDocument, SopStructuredEditor } from "./sop-editor";
import { localizeSopSectionTitle } from "./sop-section-utils";
import { createEmptySopDocument } from "./sop-document";
import { LanguageProvider } from "@/providers/language-provider-component";

const oneSection = [{ key: "purpose", title: "Purpose", required: true }];

describe("SOP structured editor", () => {
  beforeEach(() => {
    localStorage.setItem("rispro-language", "en");
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => document.body });
  });

  it("preserves built-in section localization and custom title fallback", () => {
    expect(localizeSopSectionTitle("purpose", "Fallback", (key) => key)).toBe("sops.section.purpose");
    expect(localizeSopSectionTitle("custom", "Custom title", (key) => key)).toBe("Custom title");
  });

  it("creates the canonical section shape and exposes rich text, table, alignment, and direction controls", async () => {
    const user = userEvent.setup();
    const value = createEmptySopDocument(oneSection);
    render(<LanguageProvider><SopStructuredEditor value={value} editable /></LanguageProvider>);
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
    expect(screen.getByRole("button", { name: "Right-to-left" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Left-to-right" })).toBeTruthy();
    const editor = document.querySelector(".ProseMirror") as HTMLElement;
    await user.click(editor);
    await user.click(screen.getByRole("button", { name: "Right-to-left" }));
    expect(editor.querySelector("[dir='rtl']")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Insert table" }));
    expect(editor.querySelector("table")).toBeTruthy();
  });

  it("renders the same structured document read-only without editing controls", () => {
    const value = createEmptySopDocument(oneSection);
    render(<LanguageProvider><SopReadOnlyDocument value={value} /></LanguageProvider>);
    expect(screen.queryByRole("toolbar", { name: "SOP formatting toolbar" })).toBeNull();
    expect(document.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false");
  });
});
