// [Librarian]

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The notes nearest this one by meaning, using its own chunks as the query.
 *
 * Nothing is embedded: a note's vectors already exist, so this is database
 * reads and no model call. Two callers want it at different strictnesses —
 * a vault link has to be worth writing into someone's front matter, while a
 * link candidate only has to be worth *looking at* before being judged — so
 * the floor is the caller's to choose rather than a constant here.
 */
export async function nearestByVector(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string,
  recordingId: string,
  { floor, limit, perChunk = 50 }: { floor: number; limit: number; perChunk?: number }
): Promise<{ id: string; score: number }[]> {
  const { data: chunks } = await admin
    .from("note_chunks")
    .select("embedding_hv")
    .eq("user_id", userId)
    .eq("recording_id", recordingId)
    .not("embedding_hv", "is", null);

  if (!chunks || chunks.length === 0) return [];

  // One score per note, taken from its best-matching chunk. A mean over
  // chunks would bury a note whose single relevant paragraph is the whole
  // reason it is related.
  const best = new Map<string, number>();

  for (const chunk of chunks as { embedding_hv: string }[]) {
    const { data: matches } = await admin.rpc("match_note_chunks_hv", {
      query_embedding: chunk.embedding_hv,
      match_user_id: userId,
      match_count: perChunk,
      min_similarity: floor,
    });

    for (const match of (matches || []) as { recording_id: string; similarity: number }[]) {
      if (match.recording_id === recordingId) continue;
      const current = best.get(match.recording_id);
      if (current === undefined || match.similarity > current) {
        best.set(match.recording_id, match.similarity);
      }
    }
  }

  return [...best.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) => ({ id, score }));
}
