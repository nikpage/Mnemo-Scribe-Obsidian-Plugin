// [Guru, Librarian]

/**
 * The panel's look: the app's chips, pills, options and buttons, drawn in the
 * host app's own colours (Joplin's `--joplin-*`, Obsidian's theme variables),
 * so it sits in either app as if it were part of it. Put on the page once.
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
  color: var(--s-text); font-size: 13px; line-height: 1.45; padding: 10px 12px 24px;
  font-family: var(--joplin-font-family, var(--font-interface, system-ui, sans-serif));
}
.scribe-panel * { box-sizing: border-box; }
:where(.scribe-panel) button { font: inherit; color: inherit; cursor: pointer; background: none; border: 0; padding: 0; margin: 0; box-shadow: none; height: auto; min-height: 0; }
:where(.scribe-panel) button:disabled { opacity: .5; cursor: default; }
.scribe-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.scribe-name { font-size: 14px; font-weight: 600; }
.scribe-balance { display: inline-flex; align-items: center; gap: 3px; font-weight: 600; font-variant-numeric: tabular-nums; }
.scribe-status { margin-left: auto; color: var(--s-muted); font-size: 12px; text-align: right; }
.scribe-status button { color: var(--s-accent); text-decoration: underline; }
.scribe-tabs { display: flex; gap: 14px; border-bottom: 1px solid var(--s-line); margin-bottom: 14px; overflow-x: auto; overflow-y: hidden; }
.scribe-tabs button { padding: 6px 0; color: var(--s-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; white-space: nowrap; }
.scribe-tabs button[aria-selected="true"] { color: var(--s-text); border-bottom-color: var(--s-accent); font-weight: 600; }
.scribe-section { margin-bottom: 18px; }
.scribe-section > h3 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
.scribe-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 12px; padding: 7px 14px; font-weight: 500; border: 1px solid var(--s-line) !important; }
.scribe-btn:hover:not(:disabled) { background: var(--s-soft); }
.scribe-btn.is-primary { background: var(--s-accent); color: var(--s-on-accent); border-color: transparent !important; }
.scribe-btn.is-primary:hover:not(:disabled) { background: var(--s-accent); filter: brightness(1.08); }
.scribe-btn.is-record { color: var(--s-danger); }
.scribe-btn.is-recording { background: var(--s-danger); color: #fff; border-color: transparent !important; }
.scribe-link { color: var(--s-accent); font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
.scribe-link:hover:not(:disabled) { text-decoration: underline; }
.scribe-options { display: grid; gap: 6px; }
.scribe-option { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; border: 1px solid var(--s-line) !important; border-radius: 12px; padding: 8px 12px !important; }
.scribe-option:hover { background: var(--s-soft); }
.scribe-option[aria-checked="true"] { border-color: var(--s-accent) !important; background: color-mix(in srgb, var(--s-accent) 10%, transparent); }
.scribe-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--s-line); margin-top: 2px; flex: none; }
.scribe-option[aria-checked="true"] .scribe-dot { border-color: var(--s-accent); background: var(--s-accent); }
.scribe-option b { display: block; font-weight: 500; }
.scribe-option small, .scribe-muted { display: block; color: var(--s-muted); font-size: 12px; }
.scribe-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.scribe-row + .scribe-row, .scribe-row + .scribe-input, .scribe-input + .scribe-row { margin-top: 8px; }
.scribe-chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--s-line) !important; border-radius: 999px; padding: 2px 10px !important; font-size: 12px; color: var(--s-muted) !important; }
.scribe-chip:hover { background: var(--s-soft); }
.scribe-chip[aria-pressed="true"] { border-color: var(--s-accent) !important; color: var(--s-accent) !important; background: color-mix(in srgb, var(--s-accent) 10%, transparent); }
.scribe-pill { display: inline-flex; align-items: center; border: 1px solid var(--s-accent); border-radius: 999px; font-size: 12px; color: var(--s-accent); background: color-mix(in srgb, var(--s-accent) 10%, transparent); }
.scribe-pill > :first-child { padding: 2px 4px 2px 10px; }
.scribe-pill > button:first-child:hover { text-decoration: underline; }
.scribe-pill > button:last-child { padding: 2px 9px 2px 3px; border-radius: 999px; }
.scribe-input { width: 100%; border: 1px solid var(--s-line); border-radius: 12px; padding: 7px 11px; font: inherit; color: var(--s-text); background: var(--s-bg); outline: none; }
.scribe-input:focus { border-color: var(--s-accent); }
textarea.scribe-input { resize: vertical; min-height: 64px; }
.scribe-cost { display: inline-flex; align-items: center; gap: 2px; font-variant-numeric: tabular-nums; }
.scribe-cost svg, .scribe-balance svg { width: 14px; height: 14px; }
.scribe-under { min-height: 16px; margin-top: 4px; color: var(--s-muted); font-size: 12px; }
.scribe-error { color: var(--s-danger); font-size: 12px; margin: 6px 0; }
.scribe-fold { margin: 14px 0 0; border-top: 1px solid var(--s-line); padding-top: 10px; }
.scribe-fold > summary { cursor: pointer; font-weight: 600; }
.scribe-fold[open] > summary { margin-bottom: 8px; }
.scribe-tick { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.scribe-tick input { margin: 0; }
.scribe-btn.is-small { padding: 4px 11px; font-size: 12px; }
.scribe-count { border-radius: 999px; padding: 0 5px; font-size: 10px; background: var(--s-soft); }
.scribe-heading { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--s-muted); margin: 0 0 8px; }
.scribe-notice { border: 1px solid var(--s-line); border-radius: 12px; padding: 10px 12px; }
.scribe-notice.is-primary { border-color: color-mix(in srgb, var(--s-accent) 35%, transparent); background: color-mix(in srgb, var(--s-accent) 6%, transparent); }
.scribe-notice.is-error { border-color: var(--s-danger); color: var(--s-danger); }
.scribe-select { width: auto; padding: 3px 8px; }
.scribe-list { border-top: 1px solid var(--s-line); }
.scribe-list > li { border-bottom: 1px solid var(--s-line); }
.scribe-panel a { color: inherit; text-decoration: none; cursor: pointer; }
.scribe-panel ul { margin: 0; padding: 0; list-style: none; }
.scribe-panel h3, .scribe-panel p { margin: 0; }
`;

/**
 * The layout words the app's screens use (Tailwind's names and sizes), drawn
 * in the host's colours. A shared screen using a word missing here fails
 * `npm run audit`; `UNDRAWN` are the ones left out on purpose.
 */
const LAYOUT = String.raw`
.scribe-panel .block { display: block; }
.scribe-panel .flex { display: flex; }
.scribe-panel .flex-1 { flex: 1 1 0%; }
.scribe-panel .flex-wrap { flex-wrap: wrap; }
.scribe-panel .items-center { align-items: center; }
.scribe-panel .gap-1 { gap: 4px; }
.scribe-panel .gap-2 { gap: 8px; }
.scribe-panel .gap-3 { gap: 12px; }
.scribe-panel .space-y-0\.5 > * + * { margin-top: 2px; }
.scribe-panel .space-y-1 > * + * { margin-top: 4px; }
.scribe-panel .space-y-2 > * + * { margin-top: 8px; }
.scribe-panel .space-y-4 > * + * { margin-top: 16px; }
.scribe-panel .space-y-5 > * + * { margin-top: 20px; }
.scribe-panel .mx-auto { margin-left: auto; margin-right: auto; }
.scribe-panel .mt-1 { margin-top: 4px; }
.scribe-panel .mt-2 { margin-top: 8px; }
.scribe-panel .mt-4 { margin-top: 16px; }
.scribe-panel .mb-1 { margin-bottom: 4px; }
.scribe-panel .mb-2 { margin-bottom: 8px; }
.scribe-panel .mb-3 { margin-bottom: 12px; }
.scribe-panel .mb-4 { margin-bottom: 16px; }
.scribe-panel .px-1 { padding-left: 4px; padding-right: 4px; }
.scribe-panel .px-2 { padding-left: 8px; padding-right: 8px; }
.scribe-panel .px-4 { padding-left: 6px; padding-right: 6px; }
.scribe-panel .py-1 { padding-top: 4px; padding-bottom: 4px; }
.scribe-panel .py-3 { padding-top: 8px; padding-bottom: 8px; }
.scribe-panel .py-8 { padding-top: 32px; padding-bottom: 32px; }
.scribe-panel .pl-3 { padding-left: 12px; }
.scribe-panel .min-w-0 { min-width: 0; }
.scribe-panel .min-h-4 { min-height: 16px; }
.scribe-panel .max-h-40 { max-height: 160px; }
.scribe-panel .h-3 { height: 12px; }
.scribe-panel .w-3 { width: 12px; }
.scribe-panel .h-8 { height: 32px; }
.scribe-panel .w-auto { width: auto; }
.scribe-panel .overflow-y-auto { overflow-y: auto; }
.scribe-panel .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scribe-panel .line-clamp-2 { overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.scribe-panel .rounded { border-radius: 4px; }
.scribe-panel .rounded-lg { border-radius: 8px; }
.scribe-panel .border-l-2 { border-left: 2px solid var(--s-line); }
.scribe-panel .border-border { border-color: var(--s-line); }
.scribe-panel .border-dashed { border-style: dashed !important; }
.scribe-panel .bg-muted { background: var(--s-soft); }
.scribe-panel .hover\:bg-muted:hover, .scribe-panel .hover\:bg-muted\/50:hover { background: var(--s-soft); }
.scribe-panel .hover\:underline:hover { text-decoration: underline; }
.scribe-panel .text-xs { font-size: 12px; }
.scribe-panel .text-sm { font-size: 13px; }
.scribe-panel .leading-4 { line-height: 16px; }
.scribe-panel .font-medium { font-weight: 500; }
.scribe-panel .font-semibold { font-weight: 600; }
.scribe-panel .italic { font-style: italic; }
.scribe-panel .uppercase { text-transform: uppercase; }
.scribe-panel .tracking-wide { letter-spacing: .025em; }
.scribe-panel .text-left { text-align: left; }
.scribe-panel .text-center { text-align: center; }
.scribe-panel .whitespace-pre-line { white-space: pre-line; }
.scribe-panel .whitespace-pre-wrap { white-space: pre-wrap; }
.scribe-panel .text-foreground { color: var(--s-text) !important; }
.scribe-panel .text-muted-foreground { color: var(--s-muted); }
.scribe-panel .text-primary { color: var(--s-accent); }
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
