import type { SopDocument } from "@/lib/api/sops";

const EMPTY_SECTION_CONTENT = { type: "doc", content: [{ type: "paragraph", attrs: { dir: "auto" } }] } as Record<string, unknown>;

export function createEmptySopDocument(sections: Array<{ key: string; title: string; required: boolean }>): SopDocument {
  return { type: "sop", version: 1, sections: sections.map((section) => ({ ...section, content: structuredClone(EMPTY_SECTION_CONTENT) })) };
}
