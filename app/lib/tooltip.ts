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
 *  room below, always inside the viewport. With a mouse `pointer` it goes to
 *  the side of the element instead (right, else left), level with the
 *  pointer, so it covers neither the cursor nor the words under it; only an
 *  element with no room at either side gets it hung below the cursor. Pure,
 *  so it is tested. */
export function placeTip(
  rect: TipRect,
  size: TipSize,
  viewport: TipSize,
  gap = GAP,
  pointer?: { x: number; y: number }
): { left: number; top: number } {
  if (pointer) {
    const level = Math.max(gap, Math.min(pointer.y - size.height / 2, viewport.height - size.height - gap));
    const right = rect.left + rect.width + gap;
    if (right + size.width <= viewport.width - gap) return { left: right, top: level };
    const left = rect.left - size.width - gap;
    if (left >= gap) return { left, top: level };
    const x = Math.max(gap, Math.min(pointer.x - size.width / 2, viewport.width - size.width - gap));
    const below = pointer.y + CURSOR;
    if (below + size.height <= viewport.height - gap) return { left: x, top: below };
    return { left: x, top: Math.max(gap, pointer.y - size.height - gap) };
  }
  const left = Math.max(gap, Math.min(rect.left + rect.width / 2 - size.width / 2, viewport.width - size.width - gap));
  const below = rect.top + rect.height + gap;
  if (below + size.height <= viewport.height - gap) return { left, top: below };
  return { left, top: Math.max(gap, rect.top - size.height - gap) };
}

/** One tip from parts, the empty ones left out: a control's words, then its price line. */
export function tipOf(...parts: (string | undefined | false | null)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Who holds a document's tips: the listeners go when the last holder lets go. */
const installed = new WeakMap<Document, { holders: number; remove: () => void }>();

/** Puts tips on `doc` and returns the one call that gives them up. Each caller
 *  holds them; the listeners and the box are removed when the last lets go, so
 *  a plugin that reloads leaves no second copy running beside the new one. */
export function installTips(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  let held = installed.get(doc);
  if (!held) {
    held = { holders: 0, remove: setUp(doc, win) };
    installed.set(doc, held);
  }
  const mine = held;
  mine.holders += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    mine.holders -= 1;
    if (mine.holders > 0) return;
    mine.remove();
    if (installed.get(doc) === mine) installed.delete(doc);
  };
}

function setUp(doc: Document, win: Window & typeof globalThis): () => void {
  const listeners: Array<[string, EventListener, boolean | AddEventListenerOptions | undefined]> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const on = (type: string, handler: (e: any) => void, options?: boolean | AddEventListenerOptions) => {
    doc.addEventListener(type, handler, options);
    listeners.push([type, handler, options]);
  };

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

  on("mouseover", (e) => {
    if (Date.now() - lastTouch < TOUCH_GHOST_MS) return; // emulated by a tap
    const el = target(e.target);
    if (!el || el === current) return;
    hide();
    pointer = { x: e.clientX, y: e.clientY };
    hoverTimer = win.setTimeout(() => show(el, pointer), HOVER_MS);
  });
  // The mouse may move on during the pause; the box hangs where it ends up.
  on("mousemove", (e) => {
    if (pointer) pointer = { x: e.clientX, y: e.clientY };
  });
  on("mouseout", (e) => {
    const el = target(e.target);
    if (el && !el.contains(e.relatedTarget as Node | null)) hide();
  });
  on("focusin", (e) => {
    const el = target(e.target);
    if (el && el.matches(":focus-visible")) show(el);
  });
  on("focusout", hide);
  on("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  on("scroll", hide, true);
  on("mousedown", hide);

  on("touchstart", (e) => {
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
  on("touchmove", cancelPress, { passive: true });
  on("touchcancel", cancelPress, { passive: true });
  on("touchend", cancelPress, { passive: true });
  on("click", (e) => {
    if (!pressed) return;
    pressed = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  return () => {
    hide();
    for (const [type, handler, options] of listeners) doc.removeEventListener(type, handler, options);
    listeners.length = 0;
    box.remove();
  };
}
