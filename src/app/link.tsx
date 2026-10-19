// [utils]

import { api } from "@/lib/api";
import { noteAddress, noteAtUrl } from "@/lib/note/notes-page";
import { type Shell, useNotes } from "./shell";

/**
 * A click on a link: the screen's own handler first. A click it cancelled (the
 * Web's drag that ends on a note) opens nothing, as in the app.
 */
export function clicked<E extends { defaultPrevented: boolean; preventDefault(): void }>(event: E, own: ((event: E) => void) | undefined, go: () => void): void {
  own?.(event);
  const cancelled = event.defaultPrevented;
  event.preventDefault();
  if (!cancelled) go();
}

/**
 * Where an app address leads here. The app links a note by its path
 * (`noteHref()`) or as `/transcript/<id>`; a path is asked of the server, as
 * the app's notes page asks it, and opens the note it names.
 */
export function follow(shell: Shell, href: string): void {
  if (/^\/write(\/|\?|$)/.test(href)) return shell.go(href);
  if (/^\/settings(\/|\?|$)/.test(href)) return shell.away(href);
  void idOf(href).then((id) => id && shell.open(id));
}

async function idOf(href: string): Promise<string | null> {
  const id = /^\/transcript\/([^/?#]+)/.exec(href)?.[1];
  if (id) return id;
  const address = noteAddress(href.split(/[?#]/)[0].split("/").filter(Boolean));
  if (!address) return null;
  const found = await api<{ recording: { id: string } | null }>(noteAtUrl(address)).catch(() => null);
  return found?.recording?.id ?? null;
}

/**
 * `next/link` as the plugins run the app's screens: a link to a note opens
 * that note in this app; a Write page opens in the Write tab; Settings, which
 * the panel has not, opens in the browser.
 */
export default function Link({ href, className, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; "data-tip"?: string }) {
  const shell = useNotes();
  return (
    <a
      href="#"
      className={className}
      data-tip={rest["data-tip"]}
      onClick={(event) => clicked(event, rest.onClick, () => follow(shell, href))}
    >
      {children}
    </a>
  );
}
