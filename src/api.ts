// [Smith]

import { requestUrl } from "obsidian";

/**
 * Talking to Scribe. Obsidian's own `requestUrl` is used rather than fetch
 * because it goes out from the app itself, desktop and phone, so no CORS
 * header has to exist on the server for a vault to be allowed to ask.
 */

export type RemoteNote = {
  id: string;
  rev: number;
  updatedAt: string;
  /** A name for a new file. A file already here keeps its own. */
  filename: string;
  /** What a new file is placed by. */
  tags: string[];
  markdown: string;
};

export type PullResult = {
  notes: RemoteNote[];
  cursor: string | null;
  more: boolean;
};

export type PushResult = {
  saved: { id: string; rev: number; updatedAt: string }[];
  conflicts: RemoteNote[];
  missing: string[];
};

export type RelatedNote = {
  id: string;
  title: string;
  path: string;
  score: number;
};

export type SearchHit = {
  note: {
    id: string;
    label: string;
    recorded_at: string;
    path: string;
    tags: string[];
  };
  score: number;
  excerpt: string;
};

export type Fact = {
  id: string;
  subject: string;
  variable: string;
  valueText: string;
  unit: string | null;
  happenedOn: string | null;
  saidOn: string | null;
  quote: string | null;
  confidence: number;
};

export type Reading = { id: string; part: string | null; status: "running" | "done" | "failed"; reading: string | null };
export type WhatNext = { reading: Reading | null; failed: string | null; more: Reading[] };
export type WhatNextScope = "overview" | "tags" | "item";

export type Answer = { answer: string | null; cited: { id: string; label: string }[]; noCredits?: boolean; declined?: boolean };
export type Theme = { id: string; name: string; body: string };
export type Subject = { id: string; name: string; archived?: boolean; notes: number };
export type SubjectNote = { id: string; label: string; recorded_at: string };
export type BillingInfo = {
  credits: number;
  paysInCredits: boolean;
  rates: { operation: string; credits: number | string; per: number | string; unit: string }[];
};

/** Refused at zero credits: said plainly, with where to top up. */
export class OutOfCredits extends Error {
  constructor(message = "Out of credits. Top up in Scribe to keep going.") {
    super(message);
    this.name = "OutOfCredits";
  }
}

export type IngestResult = {
  imported: { file: string; id: string; title: string; path: string; tags: string[] }[];
  failed: { file: string; error: string }[];
};

/**
 * A file upload, built by hand.
 *
 * `requestUrl` takes bytes, not a FormData — it is Obsidian's own HTTP call
 * rather than the browser's — so the multipart body is assembled here. The
 * boundary is random for the same reason it always is: it must not occur in
 * anything being sent.
 */
function multipart(
  files: { name: string; data: ArrayBuffer }[],
  fields: Record<string, string>
): { body: ArrayBuffer; contentType: string } {
  const boundary = `----mnemo${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const [key, value] of Object.entries(fields)) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`
      )
    );
  }

  for (const file of files) {
    parts.push(
      encoder.encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name.replace(/"/g, "")}"\r\n` +
          `Content-Type: text/markdown\r\n\r\n`
      )
    );
    parts.push(new Uint8Array(file.data));
    parts.push(encoder.encode("\r\n"));
  }

  parts.push(encoder.encode(`--${boundary}--\r\n`));

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.length;
  }

  return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

/** One reply read the same way everywhere: 401, 402 and any other refusal said in words. */
function answer<T>(res: { status: number; json: unknown; text: string }): T {
  const said = () => {
    try {
      return (res.json as { error?: string })?.error;
    } catch {
      return undefined;
    }
  };
  if (res.status === 401) throw new Error("Token rejected — reconnect this device in Scribe.");
  if (res.status === 402) throw new OutOfCredits();
  if (res.status >= 400) throw new Error(said() || `Scribe returned ${res.status}`);
  return res.json as T;
}

export class ScribeApi {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  /** Where to top up: Scribe's own settings page. */
  get topUpUrl(): string {
    return this.url("/settings");
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await requestUrl({
      url: this.url(path),
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      // A 401 is an answer, not a crash: it means the token was revoked.
      throw: false,
    });

    return answer<T>(res);
  }

  /** Everything that changed since the last pull. */
  pull(since: string | null): Promise<PullResult> {
    return this.call<PullResult>(`/api/sync${since ? `?since=${encodeURIComponent(since)}` : ""}`);
  }

  /** One note, for a search result this vault has never held. */
  async pullOne(id: string): Promise<RemoteNote | null> {
    const result = await this.call<PullResult>(`/api/sync?id=${encodeURIComponent(id)}`);
    return result.notes[0] ?? null;
  }

  push(notes: { id: string; rev: number; folder?: string; markdown: string }[]): Promise<PushResult> {
    return this.call<PushResult>("/api/sync", { method: "POST", body: { notes } });
  }

  /**
   * Files from the vault that Scribe has never seen, made into notes.
   *
   * The folder they sit in goes with them, so its words become the note's
   * tags rather than whatever a model would guess.
   */
  async ingest(files: { name: string; data: ArrayBuffer }[], folder: string): Promise<IngestResult> {
    const { body, contentType } = multipart(files, folder ? { folder } : {});
    const res = await requestUrl({
      url: this.url("/api/notes/import"),
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": contentType },
      body,
      throw: false,
    });

    return answer<IngestResult>(res);
  }

  /**
   * The notes nearest this one by meaning. Free on the server — it compares
   * vectors that already exist — so it can be asked on every pull.
   */
  async related(id: string): Promise<RelatedNote[]> {
    const result = await this.call<{ related: RelatedNote[] }>(
      `/api/notes/related?id=${encodeURIComponent(id)}`
    );
    return result.related || [];
  }

  /**
   * Words are free and run as you type; meaning is a model call and only
   * happens when asked for.
   */
  async search(query: string, byMeaning: boolean): Promise<SearchHit[]> {
    const params = new URLSearchParams({ q: query });
    if (byMeaning) params.set("fuzzy", "1");
    const result = await this.call<{ results: SearchHit[] }>(`/api/notes/search?${params}`);
    return result.results || [];
  }

  /** Of the notes this vault holds, the ones Scribe no longer has. */
  async gone(ids: string[]): Promise<string[]> {
    const gone: string[] = [];
    for (let at = 0; at < ids.length; at += 1000) {
      const result = await this.call<{ gone: string[] }>("/api/sync/gone", {
        method: "POST",
        body: { ids: ids.slice(at, at + 1000) },
      });
      gone.push(...result.gone);
    }
    return gone;
  }

  /** The same delete as the app's: the note, its audio and its transcript. */
  async deleteNote(id: string): Promise<void> {
    await this.call("/api/recordings", { method: "DELETE", body: { recordingId: id } });
  }

  billing(): Promise<BillingInfo> {
    return this.call<BillingInfo>("/api/billing");
  }

  whatNext(scope: WhatNextScope, target: string): Promise<WhatNext> {
    const params = new URLSearchParams({ scope, target });
    return this.call<WhatNext>(`/api/notes/what-next?${params}`);
  }

  /** A paid press; the reading is written in the background and read back by `whatNext()`. */
  pressWhatNext(scope: WhatNextScope, target: string, more?: { parentId: string; part: string }): Promise<{ readingId: string }> {
    return this.call<{ readingId: string }>("/api/notes/what-next", {
      method: "POST",
      body: { scope, target, ...(more || {}) },
    });
  }

  /** A written answer from the notes; each [n] in it is `cited[n - 1]`. */
  async ask(question: string): Promise<Answer> {
    const params = new URLSearchParams({ q: question, fuzzy: "1", answer: "1" });
    const result = await this.call<Answer>(`/api/notes/search?${params}`);
    if (result.noCredits) throw new OutOfCredits();
    return { ...result, cited: result.cited || [] };
  }

  async facts(id: string): Promise<Fact[]> {
    const result = await this.call<{ facts: Fact[] }>(`/api/notes/facts?id=${encodeURIComponent(id)}`);
    return result.facts || [];
  }

  async themes(): Promise<Theme[]> {
    const result = await this.call<{ themes: Theme[] }>("/api/notes/themes");
    return result.themes || [];
  }

  async subjects(): Promise<Subject[]> {
    const result = await this.call<{ subjects: Subject[] }>("/api/subjects");
    return (result.subjects || []).filter((subject) => !subject.archived);
  }

  async subjectNotes(id: string): Promise<SubjectNote[]> {
    const result = await this.call<{ notes: SubjectNote[] }>(`/api/subjects?id=${encodeURIComponent(id)}`);
    return result.notes || [];
  }

  /** Tells Scribe a recording exists, before its audio goes up. A repeat of the same id is fine. */
  async newRecording(recording: {
    id: string;
    filename: string;
    recorded_at: string;
    duration_seconds: number;
    file_size_bytes: number;
  }): Promise<void> {
    await this.call("/api/recordings", {
      method: "POST",
      body: { ...recording, label: "", speakers_expected: 1 },
    });
  }

  /**
   * The audio, straight to storage with a signed link: it never passes
   * through Scribe's server. Then the server is told it arrived.
   */
  async uploadAudio(id: string, filename: string, audio: ArrayBuffer, type: string): Promise<void> {
    const signed = await this.call<{ storagePath: string; signedUrl?: string }>("/api/upload", {
      method: "POST",
      body: { recordingId: id, filename },
    });
    if (!signed.signedUrl) throw new Error("This Scribe is too old to take recordings from Obsidian.");

    const res = await requestUrl({
      url: signed.signedUrl,
      method: "PUT",
      headers: { "Content-Type": type, "x-upsert": "true" },
      body: audio,
      throw: false,
    });
    if (res.status >= 400) throw new Error(`Upload failed (${res.status})`);

    await this.call("/api/upload", { method: "PUT", body: { recordingId: id, storagePath: signed.storagePath } });
  }

  /** Starts the paid transcription. A 409 means it is already under way, which is fine. */
  async transcribe(id: string): Promise<void> {
    const res = await requestUrl({
      url: this.url("/api/transcribe"),
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: id }),
      throw: false,
    });
    if (res.status === 409) return;
    answer(res);
  }
}
