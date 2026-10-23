// [Guru]

import type { SupabaseClient } from "@supabase/supabase-js";
import { openQuestions } from "@/lib/note/tag-suggestions";
import { openTodos, type Todo } from "@/lib/note/todos";
import { READ } from "@/lib/note/shelf";
import { type Drew, HIDDEN, outNotes, outputOut } from "@/lib/note/switches";
import { type Extract, additionsOf, drewOf } from "@/lib/note/brain-library";
import type { Scope } from "@/lib/note/what-next-target";

/**
 * What the home screen shows, in one free read: how much is in the store, the
 * open to-dos, the newest of what Brain wrote and what is waiting on the
 * person. Nothing here calls a model; the readings and insights are only
 * read back.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, any, any>;

export type Home = {
  totals: { notes: number; words: number; week: number };
  todos: Todo[];
  /** The newest What next readings, each cut to its opening; the whole one is read on demand. */
  readings: { id: string; scope: string; target: string; excerpt: string; at: string }[];
  /** This week's insights, newest report first. */
  insights: { week: string; headline: string; body: string }[];
  needs: { tags: number; report: boolean };
  /** The notes added last, newest first, each with its summary's opening. */
  recent: { id: string; path: string; label: string; recordedAt: string; summary: string }[];
};

const WEEK = 7 * 24 * 60 * 60 * 1000;
const EXCERPT = 320;
const RECENT = 5;
const READINGS = 6;

/** A reading's opening, without its Markdown marks, cut at a word. */
export function excerptOf(text: string, max = EXCERPT): string {
  const plain = text
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 0) || max)}…`;
}

export async function homeOf(admin: Admin, userId: string, now = Date.now()): Promise<Home> {
  const since = new Date(now - WEEK).toISOString();
  const [totals, week, todos, readings, insights, questions, added, out] = await Promise.all([
    admin.rpc("note_totals", { uid: userId }),
    admin
      .from("recordings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "done")
      .eq("report", false)
      .in("shelf", READ)
      .neq(HIDDEN, true)
      .gte("recorded_at", since),
    openTodos(admin, userId),
    admin
      .from("what_next_readings")
      .select("id, scope, target, reading, created_at, read_ids, elsewhere_ids, extracts")
      .eq("user_id", userId)
      .eq("status", "done")
      .neq("scope", "suggest")
      .is("parent_id", null)
      .order("created_at", { ascending: false })
      .limit(READINGS * 4),
    admin
      .from("note_insights")
      .select("week_start, headline, body, evidence, read_ids")
      .eq("user_id", userId)
      .order("week_start", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(12),
    openQuestions(admin, userId),
    admin
      .from("recordings")
      .select("id, path, label, recorded_at, summary:analysis->summary")
      .eq("user_id", userId)
      .eq("status", "done")
      .eq("report", false)
      .in("shelf", READ)
      .neq(HIDDEN, true)
      .order("created_at", { ascending: false })
      .limit(RECENT),
    outNotes(admin, userId),
  ]);
  // What a switch now puts out is not shown here (`lib/note/switches.ts`).
  const anyOut = out.hidden.size + out.brainOff.size > 0;
  const additions = anyOut ? await additionsOf(admin, userId, ((readings.data || []) as { id: string }[]).map((r) => r.id)) : [];
  const shown = (drew: Drew) => !anyOut || !outputOut(drew, out);

  const total = (Array.isArray(totals.data) ? totals.data[0] : totals.data) as { notes?: number; words?: number } | null;
  type ReadingRow = { id: string; scope: Scope; target: string; reading: string | null; created_at: string; read_ids: string[] | null; elsewhere_ids: string[] | null; extracts: Extract[] | null };
  const kept = ((readings.data || []) as ReadingRow[]).filter((r) => shown(drewOf(r, additions))).slice(0, READINGS);
  type InsightRow = { week_start: string; headline: string; body: string; evidence: string[] | null; read_ids: string[] | null };
  const written = ((insights.data || []) as InsightRow[]).filter((i) => shown({ shows: i.evidence ?? [], read: i.read_ids })).slice(0, 3).map((i) => ({
    week: i.week_start,
    headline: i.headline,
    body: i.body,
  }));
  // The newest week's report, as the Recent screen counts it: a week old at most.
  const newest = written[0]?.week;

  return {
    totals: { notes: Number(total?.notes ?? 0), words: Number(total?.words ?? 0), week: week.count ?? 0 },
    todos,
    readings: kept
      .filter((r) => r.reading)
      .map((r) => ({ id: r.id, scope: r.scope, target: r.target, excerpt: excerptOf(r.reading!), at: r.created_at })),
    insights: written.filter((i) => i.week === newest),
    needs: { tags: questions.length, report: Boolean(newest) && now - new Date(newest!).getTime() < WEEK },
    recent: ((added.data || []) as { id: string; path: string | null; label: string | null; recorded_at: string; summary: string | null }[]).map((n) => ({
      id: n.id,
      path: n.path || "",
      label: n.label || "",
      recordedAt: n.recorded_at,
      summary: typeof n.summary === "string" ? n.summary : "",
    })),
  };
}
