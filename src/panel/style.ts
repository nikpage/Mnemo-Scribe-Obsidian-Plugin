// [Guru, Librarian]

/**
 * The panel's look: the app's chips, pills, options and buttons, drawn in the
 * host app's own colours (Joplin's `--joplin-*`, Obsidian's theme variables),
 * so it sits in either app as if it were part of it. Put on the page once.
 */
/**
 * The panel's root, named twice. Obsidian (and its themes) style every
 * `button` — grey fill, shadow, centred, never wrapping, fixed height — at
 * `button:not(.clickable-icon)`; a reset any weaker than that loses, and
 * each kind of button came out half Obsidian's, half ours. Twice the class
 * outranks the host's element rules without `!important`.
 */
const R = ".scribe-panel.scribe-panel";

/**
 * Five pieces, and nothing else: a section title, a grey hint line, a chip, a
 * main button and a quiet link (plus the input and option card they sit
 * with). One radius for cards, one for pills, one text size per role.
 */
const CSS = `
.scribe-panel {
  --s-text: var(--joplin-color, var(--text-normal, #1f2328));
  --s-muted: var(--joplin-color-faded, var(--text-muted, #6b7280));
  --s-bg: var(--joplin-background-color, var(--background-primary, #ffffff));
  --s-soft: var(--joplin-background-color3, var(--background-secondary, #f3f4f6));
  --s-line: var(--joplin-divider-color, var(--background-modifier-border, #e5e7eb));
  --s-accent: var(--interactive-accent, var(--joplin-color4, #2563eb));
  --s-on-accent: var(--text-on-accent, #ffffff);
  --s-danger: var(--text-error, #c53030);
  --s-card: 10px;
  color: var(--s-text); font-size: 13px; line-height: 1.45; padding: 10px 12px 24px;
  font-family: var(--joplin-font-family, var(--font-interface, system-ui, sans-serif));
  container-type: inline-size; overflow-wrap: anywhere;
}
${R} * { box-sizing: border-box; }
${R} button { display: inline; justify-content: normal; align-items: normal; user-select: auto; font: inherit; color: inherit; text-align: inherit; white-space: normal; cursor: pointer; background: none; border: 0; border-radius: 0; padding: 0; margin: 0; box-shadow: none; height: auto; min-height: 0; }
${R} button:disabled { opacity: .5; cursor: default; }
${R} a { color: inherit; text-decoration: none; cursor: pointer; }
${R} ul, ${R} ol { margin: 0; padding: 0; list-style: none; }
${R} h3, ${R} p { margin: 0; }

${R} .scribe-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
${R} .scribe-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
${R} .scribe-balance { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
${R} .scribe-head .scribe-btn { margin-left: auto; flex: none; }
${R} .scribe-tabs { display: flex; gap: 14px; border-bottom: 1px solid var(--s-line); margin-top: 8px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
${R} .scribe-tabs::-webkit-scrollbar { display: none; }
${R} .scribe-tabs button { padding: 6px 0; color: var(--s-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
${R} .scribe-tabs button:hover { color: var(--s-text); }
${R} .scribe-tabs button[aria-selected="true"] { color: var(--s-text); border-bottom-color: var(--s-accent); font-weight: 600; }
${R} .scribe-status { display: block; color: var(--s-muted); font-size: 12px; margin: 6px 0 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
${R} .scribe-status button { color: var(--s-accent); text-decoration: underline; }
@container (max-width: 300px) {
  ${R} .scribe-long { display: none; }
  ${R} .scribe-tabs { gap: 10px; }
}

${R} .scribe-section { margin-bottom: 18px; }
${R} .scribe-section > h3, ${R} .scribe-heading { font-size: 13px; font-weight: 600; margin: 0 0 6px; color: var(--s-text); }
${R} .scribe-fold { margin: 14px 0 0; border-top: 1px solid var(--s-line); padding-top: 10px; }
${R} .scribe-fold > summary { cursor: pointer; font-size: 13px; font-weight: 600; }
${R} .scribe-fold[open] > summary { margin-bottom: 6px; }
${R} .scribe-option small, ${R} .scribe-muted { display: block; color: var(--s-muted); font-size: 12px; }
${R} .scribe-fold > .scribe-muted { margin-bottom: 8px; }

${R} .scribe-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; border-radius: 999px; padding: 6px 14px; font-size: 13px; font-weight: 600; border: 1px solid var(--s-line); }
${R} .scribe-btn:hover:not(:disabled) { background: var(--s-soft); }
${R} .scribe-btn.is-primary { background: var(--s-accent); color: var(--s-on-accent); border-color: transparent; }
${R} .scribe-btn.is-primary:hover:not(:disabled) { background: var(--s-accent); filter: brightness(1.08); }
${R} .scribe-btn.is-record { color: var(--s-danger); }
${R} .scribe-btn.is-recording { background: var(--s-danger); color: #fff; border-color: transparent; }
${R} .scribe-btn.is-small { padding: 4px 11px; font-size: 12px; }
${R} .scribe-link { display: inline-flex; align-items: center; gap: 4px; color: var(--s-accent); font-size: 12px; }
${R} .scribe-link:hover:not(:disabled) { text-decoration: underline; }

${R} .scribe-options { display: grid; gap: 6px; }
${R} .scribe-option { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; border: 1px solid var(--s-line); border-radius: var(--s-card); padding: 8px 12px; }
${R} .scribe-option:hover { background: var(--s-soft); }
${R} .scribe-option[aria-checked="true"] { border-color: var(--s-accent); background: color-mix(in srgb, var(--s-accent) 10%, transparent); }
${R} .scribe-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--s-line); margin-top: 2px; flex: none; }
${R} .scribe-option[aria-checked="true"] .scribe-dot { border-color: var(--s-accent); background: var(--s-accent); }
${R} .scribe-option b { display: block; font-weight: 500; }

${R} .scribe-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
${R} .scribe-row + .scribe-row, ${R} .scribe-row + .scribe-input, ${R} .scribe-input + .scribe-row { margin-top: 8px; }
${R} .scribe-chip { display: inline-block; max-width: 100%; text-align: left; border: 1px solid var(--s-line); border-radius: 12px; padding: 2px 10px; font-size: 12px; color: var(--s-muted); }
${R} .scribe-chip:hover { background: var(--s-soft); }
${R} .scribe-chip[aria-pressed="true"] { border-color: var(--s-accent); color: var(--s-accent); background: color-mix(in srgb, var(--s-accent) 10%, transparent); }
${R} .scribe-chip > .scribe-count, ${R} .scribe-chip > [aria-hidden] { margin-left: 4px; }
${R} .scribe-count { border-radius: 999px; padding: 0 5px; font-size: 10px; background: var(--s-soft); }
${R} .scribe-pill { display: inline-flex; align-items: center; max-width: 100%; border: 1px solid var(--s-accent); border-radius: 12px; font-size: 12px; color: var(--s-accent); background: color-mix(in srgb, var(--s-accent) 10%, transparent); }
${R} .scribe-pill > :first-child { padding: 2px 4px 2px 10px; }
${R} .scribe-pill > button:first-child:hover { text-decoration: underline; }
${R} .scribe-pill > button:last-child { padding: 2px 9px 2px 3px; }

${R} .scribe-input { width: 100%; border: 1px solid var(--s-line); border-radius: var(--s-card); padding: 7px 11px; font: inherit; color: var(--s-text); background: var(--s-bg); outline: none; box-shadow: none; height: auto; }
${R} .scribe-input:focus { border-color: var(--s-accent); }
${R} textarea.scribe-input { resize: vertical; min-height: 64px; }
${R} .scribe-select { width: auto; padding: 3px 8px; }
${R} .scribe-cost { display: inline-flex; align-items: center; gap: 2px; font-variant-numeric: tabular-nums; }
${R} .scribe-cost svg, ${R} .scribe-balance svg { width: 14px; height: 14px; }
${R} .scribe-under { min-height: 16px; margin-top: 4px; color: var(--s-muted); font-size: 12px; }
${R} .scribe-error { color: var(--s-danger); font-size: 12px; margin: 6px 0; }
${R} .scribe-tick { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
${R} .scribe-tick input { margin: 0; }
${R} .scribe-notice { border: 1px solid var(--s-line); border-radius: var(--s-card); padding: 10px 12px; }
${R} .scribe-notice.is-primary { border-color: color-mix(in srgb, var(--s-accent) 35%, transparent); background: color-mix(in srgb, var(--s-accent) 6%, transparent); }
${R} .scribe-notice.is-error { border-color: var(--s-danger); color: var(--s-danger); }
${R} .scribe-list { border-top: 1px solid var(--s-line); }
${R} .scribe-list > li { border-bottom: 1px solid var(--s-line); }
`;

/**
 * The layout words the app's screens use (Tailwind's names and sizes), drawn
 * in the host's colours. A shared screen using a word missing here fails
 * `npm run audit`; `UNDRAWN` are the ones left out on purpose.
 */
const LAYOUT = String.raw`
${R} .mt-3 { margin-top: 12px; }
${R} .block { display: block; }
${R} .flex { display: flex; }
${R} .flex-1 { flex: 1 1 0%; }
${R} .flex-wrap { flex-wrap: wrap; }
${R} .items-center { align-items: center; }
${R} .gap-1 { gap: 4px; }
${R} .gap-2 { gap: 8px; }
${R} .gap-3 { gap: 12px; }
${R} .space-y-0\.5 > * + * { margin-top: 2px; }
${R} .space-y-1 > * + * { margin-top: 4px; }
${R} .space-y-2 > * + * { margin-top: 8px; }
${R} .space-y-4 > * + * { margin-top: 16px; }
${R} .space-y-5 > * + * { margin-top: 20px; }
${R} .mx-auto { margin-left: auto; margin-right: auto; }
${R} .mt-1 { margin-top: 4px; }
${R} .mt-2 { margin-top: 8px; }
${R} .mt-4 { margin-top: 16px; }
${R} .mb-1 { margin-bottom: 4px; }
${R} .mb-2 { margin-bottom: 8px; }
${R} .mb-3 { margin-bottom: 12px; }
${R} .mb-4 { margin-bottom: 16px; }
${R} .px-1 { padding-left: 4px; padding-right: 4px; }
${R} .px-2 { padding-left: 8px; padding-right: 8px; }
${R} .px-4 { padding-left: 6px; padding-right: 6px; }
${R} .py-1 { padding-top: 4px; padding-bottom: 4px; }
${R} .py-3 { padding-top: 8px; padding-bottom: 8px; }
${R} .py-8 { padding-top: 32px; padding-bottom: 32px; }
${R} .pl-3 { padding-left: 12px; }
${R} .min-w-0 { min-width: 0; }
${R} .min-h-4 { min-height: 16px; }
${R} .max-h-40 { max-height: 160px; }
${R} .h-3 { height: 12px; }
${R} .w-3 { width: 12px; }
${R} .h-8 { height: 32px; }
${R} .w-auto { width: auto; }
${R} .overflow-y-auto { overflow-y: auto; }
${R} .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
${R} .line-clamp-2 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
${R} .rounded { border-radius: 4px; }
${R} .rounded-lg { border-radius: 8px; }
${R} .border-l-2 { border-left: 2px solid var(--s-line); }
${R} .border-border { border-color: var(--s-line); }
${R} .border-dashed { border-style: dashed; }
${R} .bg-muted { background: var(--s-soft); }
${R} .hover\:bg-muted:hover, ${R} .hover\:bg-muted\/50:hover { background: var(--s-soft); }
${R} .hover\:underline:hover { text-decoration: underline; }
${R} .text-xs { font-size: 12px; }
${R} .text-lg { font-size: 17px; }
${R} .line-through { text-decoration: line-through; }
${R} .text-destructive { color: var(--s-danger); }
${R} .text-sm { font-size: 13px; }
${R} .leading-4 { line-height: 16px; }
${R} .font-medium { font-weight: 500; }
${R} .font-semibold { font-weight: 600; }
${R} .italic { font-style: italic; }
${R} .uppercase { text-transform: uppercase; }
${R} .tracking-wide { letter-spacing: .025em; }
${R} .text-left { text-align: left; }
${R} .text-center { text-align: center; }
${R} .whitespace-pre-line { white-space: pre-line; }
${R} .whitespace-pre-wrap { white-space: pre-wrap; }
${R} .text-foreground { color: var(--s-text); }
${R} .text-muted-foreground { color: var(--s-muted); }
${R} .text-primary { color: var(--s-accent); }
`;

/** Left undrawn on purpose: the app's wide-screen rules and page margins, which a side panel has no room for. */
export const UNDRAWN = ["md:hidden", "md:p-6", "p-4", "max-w-2xl"];

export function addStyle(doc: Document = document) {
  if (doc.getElementById("scribe-panel-style")) return;
  const style = doc.createElement("style");
  style.id = "scribe-panel-style";
  style.textContent = CSS + LAYOUT;
  doc.head.appendChild(style);
}
