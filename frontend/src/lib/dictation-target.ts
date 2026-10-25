import type { Editor } from "@tiptap/core";

const editors = new WeakMap<HTMLElement, Editor>();
export function registerDictationEditor(editor: Editor) {
  const element = editor.view.dom;
  editors.set(element, editor);
  return () => { editors.delete(element); };
}

type NativeField = HTMLInputElement | HTMLTextAreaElement;
type Selection = { from: number; to: number };
export type DictationTarget = {
  element: HTMLElement;
  valid: () => boolean;
  insert: (text: string) => boolean;
};

function allowed(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[data-dictation="off"], [data-dictation-controls], [hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]')) return false;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const dialog = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).at(-1);
  if (dialog && !dialog.contains(element)) return false;
  const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? Array.from(element.labels ?? []).map((label) => label.textContent).join(" ") : "";
  const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" ");
  const description = [element.id, element.getAttribute("name"), element.getAttribute("aria-label"), labelledBy, element.getAttribute("placeholder"), element.getAttribute("autocomplete"), labels].join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ");
  return !/\b(id|identifier|mrn|accession|password|pin|secret|token|username|email|phone|mobile|barcode|dicom|uid|code|national|passport|birth|dob)\b|رقم|هوية|كلمة المرور/i.test(description);
}

function insertion(before: string, after: string, text: string) {
  const leading = before && !/[\s([{]$/.test(before) && !/^[\s,.;:!?)}\]]/.test(text) ? " " : "";
  const trailing = after && !/^[\s,.;:!?)}\]]/.test(after) && !/\s$/.test(text) ? " " : "";
  return leading + text + trailing;
}

/** Capture the actual field, selection, and record scope. Never look up a new destination on completion. */
export function captureDictationTarget(active: Element | null): DictationTarget | null {
  if (!(active instanceof HTMLElement)) return null;
  const element = active.closest<HTMLElement>('input, textarea, [contenteditable="true"]');
  if (!element || !allowed(element)) return null;
  const route = window.location.href;
  const contexts = () => {
    const scopes: HTMLElement[] = [];
    for (let scope = element.closest<HTMLElement>('[data-dictation-context]'); scope; scope = scope.parentElement?.closest<HTMLElement>('[data-dictation-context]') ?? null) scopes.push(scope);
    return scopes;
  };
  // Only the target's ancestry owns its record identity. Sibling panels can refresh independently.
  const scopes = contexts().map((scope) => [scope, scope.getAttribute("data-dictation-context")] as const);
  const sameScope = () => {
    const current = contexts();
    return window.location.href === route && current.length === scopes.length
      && scopes.every(([scope, value], index) => current[index] === scope && scope.getAttribute("data-dictation-context") === value);
  };
  const valid = () => allowed(element) && sameScope();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const field: NativeField = element;
    if (field instanceof HTMLInputElement && (field.type !== "text" || ["numeric", "decimal", "tel", "email"].includes(field.inputMode) || field.getAttribute("role") === "combobox")) return null;
    if (field.disabled || field.readOnly || field.matches(":disabled") || field.selectionStart === null) return null;
    const value = field.value;
    const selection: Selection = { from: field.selectionStart, to: field.selectionEnd ?? field.selectionStart };
    const unchanged = () => valid() && (!(field instanceof HTMLInputElement) || field.type === "text") && !field.disabled && !field.readOnly && !field.matches(":disabled") && field.value === value;
    return { element, valid: unchanged, insert: (text) => {
      if (!unchanged() || !document.execCommand) return false;
      const previous = document.activeElement;
      const previousSelection = { from: field.selectionStart, to: field.selectionEnd };
      field.focus({ preventScroll: true });
      field.setSelectionRange(selection.from, selection.to);
      const inserted = insertion(value.slice(0, selection.from), value.slice(selection.to), field instanceof HTMLInputElement ? text.replace(/\n+/g, " ") : text);
      if (field.maxLength >= 0 && value.length - (selection.to - selection.from) + inserted.length > field.maxLength) {
        field.setSelectionRange(previousSelection.from, previousSelection.to);
        if (previous instanceof HTMLElement && previous !== field) previous.focus({ preventScroll: true });
        return false;
      }
      // insertText preserves the browser undo stack and emits input for React's controlled forms.
      document.execCommand("insertText", false, inserted);
      const success = field.value === value.slice(0, selection.from) + inserted + value.slice(selection.to);
      if (!success) field.setSelectionRange(previousSelection.from, previousSelection.to);
      if (previous instanceof HTMLElement && previous !== field) previous.focus({ preventScroll: true });
      return success;
    } };
  }
  const editor = editors.get(element);
  if (!editor || editor.isDestroyed || !editor.isEditable) return null;
  const doc = editor.state.doc;
  const { from, to } = editor.state.selection;
  const unchanged = () => valid() && !editor.isDestroyed && editor.isEditable && editor.state.doc === doc;
  return { element, valid: unchanged, insert: (text) => {
    if (!unchanged()) return false;
    const inserted = insertion(doc.textBetween(Math.max(0, from - 1), from), doc.textBetween(to, Math.min(doc.content.size, to + 1)), text);
    // Text nodes avoid parsing dictated text as HTML; a transaction participates in Tiptap history.
    const content = inserted.split("\n").flatMap((line, index) => [...(index ? [{ type: "hardBreak" }] : []), ...(line ? [{ type: "text", text: line }] : [])]);
    return editor.commands.insertContentAt({ from, to }, content);
  } };
}
