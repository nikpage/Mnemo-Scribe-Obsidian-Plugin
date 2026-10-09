// [Smith]

import { requestUrl } from "obsidian";
import type { Http } from "./api";

/**
 * Obsidian's own HTTP call: it goes out from the app itself, desktop and
 * phone, so no cross-origin rule stands between a vault and Scribe.
 */
export const obsidianHttp: Http = async (request) => {
  const res = await requestUrl({ ...request, throw: false });
  let json: unknown;
  try {
    json = res.json;
  } catch {
    // Not JSON (an empty 204, a proxy's HTML page): the status says enough.
  }
  return { status: res.status, json, text: res.text };
};
