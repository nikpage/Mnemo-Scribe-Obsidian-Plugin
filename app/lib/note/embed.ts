// [Librarian]

import { type Chunk, chunkSpans } from "@/lib/note/chunk";
import { assertBudget } from "@/lib/ai/budget";
import { type CostContext, type Operation, recordEmbeddingCost } from "@/lib/ai/cost";

// The model's full width.
//
// This was truncated to 768 for as long as `note_chunks.embedding` was a
// `vector(768)` — pgvector will not build an HNSW index above 2000
// dimensions, so the wide vector had nowhere to live. `embedding_hv` is a
// `halfvec(3072)`, which it indexes to 4000, so the truncation is gone and
// the whole vector is stored.
//
// The REST endpoint is called directly rather than through the installed
// @google/generative-ai SDK, which has no way to ask for a dimension count.
const MODEL = "gemini-embedding-001";
const DIMENSIONS = 3072;
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;

/**
 * At full width this model already returns unit-length vectors, so this is a
 * no-op on 3072 — and the one thing that makes any narrower width safe,
 * because a truncated vector is not unit length and cosine distance in
 * pgvector assumes it is. Kept for that reason, not this one.
 */
function normalize(vector: number[]): number[] {
  const magnitude = Math.hypot(...vector);
  return magnitude === 0 ? vector : vector.map((v) => v / magnitude);
}

/**
 * How many chunks fit in one call.
 *
 * `batchEmbedContents` refuses a request carrying more than a hundred, and a
 * note long enough to exceed that is exactly the kind worth finding: twenty
 * five pages is around eighty five chunks, so a document of any real length
 * sails past it. Indexing is deliberately non-fatal, so the failure would be
 * silent — the note imports, and simply never appears in a search again.
 */
const PER_CALL = 100;

async function embed(texts: string[], taskType: string): Promise<number[][]> {
  if (texts.length === 0) return [];

  // Sequential, not parallel: a long document would otherwise throw a dozen
  // calls at the rate limit at once, and the note is being indexed in the
  // background where a second of extra wall time costs nobody anything.
  if (texts.length > PER_CALL) {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += PER_CALL) {
      out.push(...(await embed(texts.slice(i, i + PER_CALL), taskType)));
    }
    return out;
  }

  const res = await fetch(`${ENDPOINT}?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: DIMENSIONS,
      })),
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding failed: ${res.status} ${await res.text()}`);
  }

  const { embeddings } = (await res.json()) as { embeddings: { values: number[] }[] };
  return embeddings.map((e) => normalize(e.values));
}

/** The chunks of a note, each with its vector, ready to store. */
export async function embedNote(
  note: {
    title: string;
    summary?: string;
    text: string;
  },
  ctx: CostContext
): Promise<(Chunk & { embedding: number[] })[]> {
  // Asked before a byte is sent: the day's ceiling is what stands behind
  // every other guard in this app. A long document is many calls, and this
  // is the one place they all start from.
  await assertBudget(ctx);

  const chunks = chunkSpans(note);
  const texts = chunks.map((c) => c.content);
  const vectors = await embed(texts, "RETRIEVAL_DOCUMENT");
  await recordEmbeddingCost(ctx, "index", texts.join("").length);
  return chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] }));
}

/** A search phrase, embedded the way queries are rather than documents. */
export async function embedQuery(query: string, ctx: CostContext): Promise<number[]> {
  await assertBudget(ctx);

  const [vector] = await embed([query], "RETRIEVAL_QUERY");
  await recordEmbeddingCost(ctx, "search", query.length);
  return vector;
}

/**
 * Several short texts embedded the way queries are — an angle's claim, to be
 * compared with what was already said. One call for all of them.
 */
export async function embedQueries(texts: string[], ctx: CostContext, operation: Operation): Promise<number[][]> {
  if (texts.length === 0) return [];
  await assertBudget(ctx);

  const vectors = await embed(texts, "RETRIEVAL_QUERY");
  await recordEmbeddingCost(ctx, operation, texts.join("").length);
  return vectors;
}

/** Chunks already cut, embedded as `embedNote()` embeds them. */
export async function embedDocuments(texts: string[], ctx: CostContext): Promise<number[][]> {
  if (texts.length === 0) return [];
  await assertBudget(ctx);

  const vectors = await embed(texts, "RETRIEVAL_DOCUMENT");
  await recordEmbeddingCost(ctx, "index", texts.join("").length);
  return vectors;
}
