// [Guru]

/**
 * A reading cut where its headings are, so each part can be elaborated. The
 * model writes `## Heading`, or a bold line on its own — a piece of work's
 * title, perhaps with its kind after it: `**Title** (Essay)`; text before the first
 * heading is a part with no heading.
 */
export function readingSections(text: string): { heading: string | null; body: string }[] {
  const sections: { heading: string | null; body: string[] }[] = [];
  for (const line of text.split("\n")) {
    const heading = /^\s*(?:#{1,6}\s+(.+?)\s*#*|\*\*(.+?)\*\*:?(\s*\([^)]*\))?)\s*$/.exec(line);
    if (heading) sections.push({ heading: (heading[1] ?? `${heading[2]}${heading[3] ?? ""}`).replace(/\*\*/g, "").trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(line);
    else sections.push({ heading: null, body: [line] });
  }
  return sections
    .map((s) => ({ heading: s.heading, body: s.body.join("\n").trim() }))
    .filter((s) => s.heading || s.body);
}

export type Mark = "strong" | "em" | "code" | null;

/**
 * A line of a reading cut into its marked runs — `**bold**`, `*italic*`,
 * `` `code` `` — so the screen draws them as the file shows them instead of
 * printing the asterisks.
 */
export function inlineMarks(text: string): { text: string; mark: Mark }[] {
  const runs: { text: string; mark: Mark }[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|`([^`]+)`/g;
  let at = 0;
  for (const found of text.matchAll(pattern)) {
    if (found.index > at) runs.push({ text: text.slice(at, found.index), mark: null });
    runs.push(found[1] !== undefined ? { text: found[1], mark: "strong" } : found[2] !== undefined ? { text: found[2], mark: "em" } : { text: found[3], mark: "code" });
    at = found.index + found[0].length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), mark: null });
  return runs;
}
