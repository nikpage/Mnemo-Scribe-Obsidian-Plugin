// [utils]

/**
 * Tooltips for every control, from one attribute: `data-tip="what it does
 * and when to use it"`. One floating box per document, so a Button, a link,
 * a checkbox or a plugin's own DOM all show the same tip the same way, and a
 * new control needs only the attribute. `<Button tip>` writes it.
 *
 * Mouse: after a short pause on the element. Keyboard: at once on focus.
 * Touch: a long press (a tap still just acts). Escape, scrolling and leaving
 * all put it away. No dependency, no stylesheet: it carries its own look,
 * a dark box that reads on any theme.
 */

const SELECTOR = "[data-tip]";
const HOVER_MS = 350;
const PRESS_MS = 500;
const TOUCH_SHOW_MS = 4000;
const TOUCH_GHOST_MS = 1000;
const GAP = 8;
/** How far below the pointer's point the arrow or hand reaches. */
const CURSOR = 24;
const MAX_WIDTH = 280;

export interface TipRect { left: number; top: number; width: number; height: number }
export interface TipSize { width: number; height: number }

/** Where the box goes: centred below the element, above it when there is no
 *  room below, always inside the viewport. With a mouse `pointer` it hangs
 *  clear of the cursor instead (below its arrow, above when there is no
 *  room), so the cursor never sits on the words. Pure, so it is tested. */
export function placeTip(
  rect: TipRect,
  size: TipSize,
  viewport: TipSize,
  gap = GAP,
  pointer?: { x: number; y: number }
): { left: number; top: number } {
  const centre = pointer ? pointer.x : rect.left + rect.width / 2;
  const left = Math.max(gap, Math.min(centre - size.width / 2, viewport.width - size.width - gap));
  const below = pointer ? pointer.y + CURSOR : rect.top + rect.height + gap;
  if (below + size.height <= viewport.height - gap) return { left, top: below };
  const above = (pointer ? pointer.y : rect.top) - size.height - gap;
  return { left, top: Math.max(gap, above) };
}

/** One tip from parts, the empty ones left out: a control's words, then its price line. */
export function tipOf(...parts: (string | undefined | false | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

const installed = new WeakSet<Document>();

export function installTips(doc: Document = document): void {
  if (installed.has(doc)) return;
  const win = doc.defaultView;
  if (!win) return;
  installed.add(doc);

  const box = doc.createElement("div");
  box.setAttribute("role", "tooltip");
  box.id = "scribe-tip";
  box.style.cssText = [
    "position:fixed", "z-index:2147483647", "pointer-events:none",
    `max-width:${MAX_WIDTH}px`, "padding:7px 10px", "border-radius:8px",
    "background:#1f2328", "color:#fff", "font:12px/1.4 system-ui,sans-serif",
    "box-shadow:0 4px 14px rgba(0,0,0,.25)", "opacity:0", "left:0", "top:0",
    "transition:opacity .12s", "white-space:normal", "overflow-wrap:anywhere",
  ].join(";");

  let current: HTMLElement | null = null;
  let hoverTimer: number | undefined;
  let pressTimer: number | undefined;
  let hideTimer: number | undefined;
  let pressed = false;
  let lastTouch = 0;
  let pointer: { x: number; y: number } | null = null;

  const target = (node: EventTarget | null): HTMLElement | null =>
    node instanceof win.Element ? ((node.closest(SELECTOR) as HTMLElement | null) ?? null) : null;

  const show = (el: HTMLElement, at: { x: number; y: number } | null = null) => {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    win.clearTimeout(hoverTimer);
    win.clearTimeout(hideTimer);
    if (!box.isConnected) doc.body.appendChild(box);
    box.textContent = text;
    current = el;
    el.setAttribute("aria-describedby", box.id);
    const r = el.getBoundingClientRect();
    const spot = placeTip(
      { left: r.left, top: r.top, width: r.width, height: r.height },
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: win.innerWidth, height: win.innerHeight },
      GAP,
      at ?? undefined
    );
    box.style.left = `${spot.left}px`;
    box.style.top = `${spot.top}px`;
    box.style.opacity = "1";
  };

  const hide = () => {
    win.clearTimeout(hoverTimer);
    win.clearTimeout(pressTimer);
    win.clearTimeout(hideTimer);
    box.style.opacity = "0";
    current?.removeAttribute("aria-describedby");
    current = null;
  };

  doc.addEventListener("mouseover", (e) => {
    if (Date.now() - lastTouch < TOUCH_GHOST_MS) return; // emulated by a tap
    const el = target(e.target);
    if (!el || el === current) return;
    hide();
    pointer = { x: e.clientX, y: e.clientY };
    hoverTimer = win.setTimeout(() => show(el, pointer), HOVER_MS);
  });
  // The mouse may move on during the pause; the box hangs where it ends up.
  doc.addEventListener("mousemove", (e) => {
    if (pointer) pointer = { x: e.clientX, y: e.clientY };
  });
  doc.addEventListener("mouseout", (e) => {
    const el = target(e.target);
    if (el && !el.contains(e.relatedTarget as Node | null)) hide();
  });
  doc.addEventListener("focusin", (e) => {
    const el = target(e.target);
    if (el && el.matches(":focus-visible")) show(el);
  });
  doc.addEventListener("focusout", hide);
  doc.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  doc.addEventListener("scroll", hide, true);
  doc.addEventListener("mousedown", hide);

  doc.addEventListener("touchstart", (e) => {
    lastTouch = Date.now();
    pressed = false;
    const el = target(e.target);
    if (!el) return;
    win.clearTimeout(pressTimer);
    pressTimer = win.setTimeout(() => {
      pressed = true;
      show(el);
      hideTimer = win.setTimeout(hide, TOUCH_SHOW_MS);
    }, PRESS_MS);
  }, { passive: true });
  const cancelPress = () => {
    lastTouch = Date.now();
    win.clearTimeout(pressTimer);
  };
  doc.addEventListener("touchmove", cancelPress, { passive: true });
  doc.addEventListener("touchcancel", cancelPress, { passive: true });
  doc.addEventListener("touchend", cancelPress, { passive: true });
  doc.addEventListener("click", (e) => {
    if (!pressed) return;
    pressed = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
