// [utils]

import { follow } from "./link";
import { useNotes } from "./shell";

/**
 * `next/navigation` as the plugins run the app's screens: there is no
 * address bar, so a screen starts as it would on a bare address, and a move
 * to an address goes where a link to it would (`follow()`).
 */
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useRouter(): { push: (href: string) => void } {
  const shell = useNotes();
  return { push: (href) => follow(shell, href) };
}
