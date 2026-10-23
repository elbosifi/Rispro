const commands: Record<string, string> = {
  period: ".", comma: ",", semicolon: ";", "question mark": "?",
  newline: "\n", "new line": "\n", "next line": "\n",
  "new paragraph": "\n\n", "next paragraph": "\n\n",
};
const commandPattern = "period|comma|semicolon|question[ \\t]+mark|newline|(?:new|next)[ \\t]+(?:paragraph|line)";

/** Local formatting only: no terminology correction, inference or report writes. */
export function cleanupMedicalDictation(input: string): string {
  // Remove only exact MedASR end tokens at the end, never arbitrary tags.
  let text = input.replace(/\r\n?/g, "\n").replace(/(?:<\/s>\s*)+$/, "");

  text = text.replace(/(?<![\p{L}\p{N}_'-])(?:um|uh|erm)(?![\p{L}\p{N}_'-])(?:[ \t]*,)?/giu, (match, offset: number, source: string) => {
    // "5 um" is a measurement; uppercase tokens may be clinical abbreviations.
    if (match === match.toUpperCase() || (/^um\b/i.test(match) && /\d[ \t]*$/.test(source.slice(0, offset)))) return match;
    return "";
  });
  // Run after filler removal so repeating cleanup cannot change a decimal again.
  // Only digit-to-digit decimals; words such as "point tenderness" stay intact.
  text = text.replace(/(?<![\p{L}\p{N}_.])(\d+)[ \t]+point[ \t]+(\d+)(?![\p{L}\p{N}_]|\.\d)/giu, (match, whole, fraction, offset: number, source: string) => {
    if (/\bpoint[ \t]+$/i.test(source.slice(0, offset)) || /^[ \t]+point\b/i.test(source.slice(offset + match.length))) return match;
    return `${whole}.${fraction}`;
  });

  // Matched brackets/braces explicitly identify commands, even beside other text.
  text = text.replace(new RegExp(`\\[[ \\t]*(${commandPattern})[ \\t]*\\]|\\{[ \\t]*(${commandPattern})[ \\t]*\\}`, "gi"), (_match, square: string, brace: string) => ` ${commands[(square ?? brace).toLowerCase().replace(/[ \t]+/g, " ")]} `);
  text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_'\\-\\[{])(?:${commandPattern})(?![\\p{L}\\p{N}_'\\-\\]}])`, "giu"), (match, offset: number, source: string) => {
    const command = match.toLowerCase().replace(/[ \t]+/g, " ");
    const before = source.slice(0, offset);
    const after = source.slice(offset + match.length);
    // Preserve literal mentions, clinical periods and lines of treatment.
    if (/\b(?:a|an|the|this|that|each|every|last|no|menstrual|menstruation|incubation|refractory|latent|postoperative|perioperative|follow-up|observation|recovery|treatment|time|short|long|brief|prolonged)[ \t]+$/i.test(before)) return match;
    if (/^[ \t]+(?:of|is|was|were|has|had|lasts|lasted|shaped)\b/i.test(after)) return match;
    if (command === "period") {
      // A bare "period" is accepted only at the end or before a clear new
      // sentence/formatting command. Use [period] for ambiguous positions.
      if (!before.trim() || !/^(?:\s*$|\s*(?:[.!?]|\n)|[ \t]+(?:there|no|not|neither|without|a|an|the|it|this|that|these|those|findings|impression|new|next|newline)\b)/i.test(after)) return match;
    }
    return ` ${commands[command]} `;
  });

  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,;!?]|\.(?!\d))/g, "$1")
    .replace(/([,;!?])(?=[\p{L}])/gu, "$1 ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Capitalize lowercase words only; preserve mixed-case medical tokens (pH,
  // eGFR), acronyms, decimals and all remaining clinical wording.
  return text.replace(/(^|[.!?]["')\]]* +|\n+)([a-z]+)(?![\p{L}\p{N}_])/gu, (_match, boundary: string, word: string) => boundary + word[0].toUpperCase() + word.slice(1));
}
