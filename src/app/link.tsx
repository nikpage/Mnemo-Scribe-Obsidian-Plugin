// [utils]

import { noteHref } from "@/lib/note/filing";
import { useNotes } from "./shell";

/**
 * `next/link` as the plugins run the app's screens: a link to a note opens
 * that note in this app. The app links a note by its path (`noteHref()`) or
 * as `/transcript/<id>`; both are turned back into the note's id here.
 */
export default function Link({ href, className, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; "data-tip"?: string }) {
  const { recordings, open } = useNotes();
  const id = /^\/transcript\/([^/?#]+)/.exec(href)?.[1] ?? recordings.find((n) => noteHref(n.path, n.id) === href)?.id;
  return (
    <a
      href="#"
      className={className}
      data-tip={rest["data-tip"]}
      onClick={(event) => {
        event.preventDefault();
        if (id) open(id);
      }}
    >
      {children}
    </a>
  );
}
