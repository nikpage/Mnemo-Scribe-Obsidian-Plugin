// [utils]

/**
 * `next/navigation` as the plugins run the app's screens: there is no
 * address bar, so a screen starts as it would on a bare address.
 */
export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}
