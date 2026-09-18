import { useEffect, useMemo } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Redo2, Table2, Underline as UnderlineIcon, Undo2 } from "lucide-react";
import type { SopDocument, SopSection } from "@/lib/api/sops";

type BlockDirection = "auto" | "rtl" | "ltr";
const DIRECTION_TYPES = ["paragraph", "heading", "bulletList", "orderedList", "listItem", "table", "tableCell", "tableHeader"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    sopDirection: { setBlockDirection: (direction: BlockDirection) => ReturnType };
  }
}

const DirectionExtension = Extension.create({
  name: "sopDirection",
  addGlobalAttributes() {
    return [{ types: DIRECTION_TYPES, attributes: { dir: { default: "auto", parseHTML: (element: HTMLElement) => (element.getAttribute("dir") as BlockDirection | null) ?? "auto", renderHTML: (attributes: { dir?: BlockDirection }) => ({ dir: attributes.dir ?? "auto" }) } } }];
  },
  addCommands() {
    return {
      setBlockDirection: (direction: BlockDirection) => ({ state, dispatch }: { state: Editor["state"]; dispatch?: (tr: unknown) => void }) => {
        let transaction = state.tr;
        let changed = false;
        state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
          if (!DIRECTION_TYPES.includes(node.type.name) || node.attrs.dir === direction) return;
          transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, dir: direction });
          changed = true;
        });
        if (changed && dispatch) dispatch(transaction);
        return changed;
      },
    };
  },
});

function ToolbarButton({ label, onClick, active = false, disabled = false, children }: { label: string; onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" className={`sop-toolbar-button ${active ? "is-active" : ""}`} aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}>{children}</button>;
}

function SopToolbar({ editor, editable }: { editor: Editor; editable: boolean }) {
  if (!editable) return null;
  return <div className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 p-2" role="toolbar" aria-label="SOP formatting toolbar">
    <select aria-label="Heading" className="input-premium h-8 w-28 px-2 text-xs" value={editor.isActive("heading", { level: 2 }) ? "2" : editor.isActive("heading", { level: 3 }) ? "3" : "p"} onChange={(event) => { const value = event.target.value; if (value === "p") editor.chain().focus().setParagraph().run(); else editor.chain().focus().toggleHeading({ level: Number(value) as 2 | 3 }).run(); }}>
      <option value="p">Body</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
    </select>
    <ToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}><List className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="h-4 w-4" /></ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
    <ToolbarButton label="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}><AlignLeft className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}><AlignCenter className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}><AlignRight className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Auto direction" active={editor.isActive({ dir: "auto" })} onClick={() => editor.chain().focus().setBlockDirection("auto").run()}>Auto</ToolbarButton>
    <ToolbarButton label="RTL" active={editor.isActive({ dir: "rtl" })} onClick={() => editor.chain().focus().setBlockDirection("rtl").run()}>RTL</ToolbarButton>
    <ToolbarButton label="LTR" active={editor.isActive({ dir: "ltr" })} onClick={() => editor.chain().focus().setBlockDirection("ltr").run()}>LTR</ToolbarButton>
    <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
    <ToolbarButton label="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 className="h-4 w-4" /></ToolbarButton>
    <ToolbarButton label="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 className="h-4 w-4" /></ToolbarButton>
  </div>;
}

function SectionEditor({ section, editable, onChange }: { section: SopSection; editable: boolean; onChange: (content: Record<string, unknown>) => void }) {
  const extensions = useMemo(() => [StarterKit, TextAlign.configure({ types: ["heading", "paragraph", "listItem", "tableCell", "tableHeader"] }), Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, DirectionExtension], []);
  const editor = useEditor({
    extensions,
    content: section.content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as Record<string, unknown>),
  });

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable, false);
    const current = JSON.stringify(editor.getJSON());
    if (current !== JSON.stringify(section.content)) editor.commands.setContent(section.content, { emitUpdate: false });
  }, [editor, editable, section.content]);

  if (!editor) return <div className="min-h-24 animate-pulse bg-muted/20" />;
  return <div className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/10 px-3 py-2"><span className="text-sm font-semibold">{section.title}</span>{section.required ? <span className="text-xs font-medium text-amber-700">Required</span> : <span className="text-xs text-muted-foreground">Optional</span>}</div>
    <SopToolbar editor={editor} editable={editable} />
    <EditorContent editor={editor} className="sop-editor-content" />
  </div>;
}

export function SopStructuredEditor({ value, editable, onChange }: { value: SopDocument; editable: boolean; onChange?: (next: SopDocument) => void }) {
  const sections = useMemo(() => value.sections, [value.sections]);
  return <div className="grid gap-4" data-testid="sop-structured-editor">{sections.map((section) => <SectionEditor key={section.key} section={section} editable={editable} onChange={(content) => onChange?.({ ...value, sections: value.sections.map((current) => current.key === section.key ? { ...current, content } : current) })} />)}</div>;
}

export function SopReadOnlyDocument({ value }: { value: SopDocument }) {
  return <div data-testid="sop-read-only-document"><SopStructuredEditor value={value} editable={false} /></div>;
}
