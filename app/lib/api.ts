// [utils]

import { useCallback } from "react";
import useSWR, { type KeyedMutator, type SWRConfiguration } from "swr";
import { request } from "@/lib/http";

/**
 * The one way a screen talks to the server.
 *
 * Every screen used to write its own fetch, its own loading flag and its own
 * error handling, and nothing was remembered between screens: the clients
 * list was fetched by four of them and the trade pack by three. Reads now
 * go through SWR — one request per address however many screens ask, the
 * last answer shown at once on return — and writes through `send()`.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

/** A JSON request. Throws an ApiError carrying the server's `{ error }` when refused. */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await request(url, init);
  if (!res.ok) throw new ApiError((res.json as { error?: string }).error || `HTTP ${res.status}`, res.status);
  return res.json as T;
}

/** A write with a JSON body. */
export function send<T = unknown>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) {
  return api<T>(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A read, cached and shared by every screen that asks for the same address. Null waits. */
export function useApi<T>(url: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(url, (key: string) => api<T>(key), config);
}

/** Whether a request has come back, well or not. */
export function answered(res: { data?: unknown; error?: unknown }): boolean {
  return res.data !== undefined || res.error !== undefined;
}

/**
 * Whether a screen may draw: every part it shows has answered. A screen
 * draws once, whole; nothing lands after it and shoves the rest. Holding
 * back for a fixed time and drawing anyway was tried twice and brought the
 * jumping back whenever the server was slower than the wait. The wait is
 * short because the answers come from this device's copy
 * (`lib/device-cache.ts`) and only a first-ever open asks the server.
 */
export function allAnswered(...parts: { data?: unknown; error?: unknown }[]): boolean {
  return parts.every(answered);
}

/**
 * Shows `next` straight away and saves in the background; if the save
 * fails, the screen goes back to what it was. A button moves on the tap.
 */
export function useOptimistic<T>(mutate: KeyedMutator<T>) {
  return useCallback(
    async (next: T, save: () => Promise<unknown>): Promise<boolean> => {
      try {
        await mutate(
          async () => {
            await save();
            return next;
          },
          { optimisticData: next, rollbackOnError: true, revalidate: false }
        );
        return true;
      } catch {
        return false;
      }
    },
    [mutate]
  );
}
