// [Smith]

/**
 * Talking to Scribe, from any app that holds a device token.
 *
 * Nothing here knows which app it runs in: each one hands over how it sends
 * a request (`Http`). Obsidian uses its own `requestUrl`, which goes out from
 * the app itself; Joplin uses fetch from its plugin frame, which is why the
 * token routes answer cross-origin requests (`next.config.ts`).
 */

export type HttpRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | ArrayBuffer;
};
export type HttpResponse = { status: number; json: unknown; text: string };
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

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

/** What a call really cost; Scribe sends it to the owner's account alone. */
export type Spent = { costUsd: number; readTokens: number; wroteTokens: number };
export type Reading = { id: string; target?: string; spent?: Spent; part: string | null; status: "running" | "done" | "failed"; reading: string | null; created_at?: string };
/** An earlier reading, one line: what it was of and when. */
export type Earlier = { id: string; scope: WhatNextScope; target: string; created_at: string };
export type WhatNext = { reading: Reading | null; failed: string | null; more: Reading[] };
export type WhatNextScope = "overview" | "tags" | "item" | "subject";
/** A press's price before it is pressed; `credits` null = nothing to read, 0 = an own-key account. */
export type Quote = { credits: number | null; balance: number | null; notes?: number };
/** One of the day's suggested topics, with the jobs its notes support. */
export type Suggestion = { label: string; subject: string; jobs: string[] };

export type Answer = { answer: string | null; cited: { id: string; label: string }[]; noCredits?: boolean; declined?: boolean; priceChanged?: number; spent?: Spent };
export type Theme = { id: string; name: string; body: string };
export type Subject = { id: string; name: string; archived?: boolean; notes: number };
export type SubjectNote = { id: string; label: string; recorded_at: string };
export type BillingInfo = {
  credits: number;
  paysInCredits: boolean;
  rates: { operation: string; credits: number | string; per: number | string; unit: string }[];
};

/** The price moved since it was shown: nothing ran, nothing was taken. */
export class PriceChanged extends Error {
  constructor(public readonly credits: number) {
    super(`The price changed to ${credits} credit${credits === 1 ? "" : "s"}. Press again to accept it.`);
  }
}

/** Refused at zero credits: said plainly, with where to top up. */
export class OutOfCredits extends Error {
  constructor(message = "Out of credits. Top up in Mnemo Scribe to keep going.") {
    super(message);
    this.name = "OutOfCredits";
  }
}

export type IngestResult = {
  imported: { file: string; id: string; title: string; path: string; tags: string[] }[];
  failed: { file: string; error: string }[];
  /** Set when the price differs from the one shown: nothing was imported. */
  priceChanged?: number;
};

/**
 * A file upload, built by hand.
 *
 * Obsidian's `requestUrl` takes bytes, not a FormData — it is the app's own
 * HTTP call rather than the browser's — so the multipart body is assembled
 * here, the same for every app. The boundary is random for the same reason it always is: it must not occur in
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
function answer<T>(res: HttpResponse): T {
  const said = () => (res.json as { error?: string } | undefined)?.error;
  if (res.status === 401) throw new Error("Token rejected — reconnect this device in Mnemo Scribe.");
  if (res.status === 402) throw new OutOfCredits();
  if (res.status === 412) throw new PriceChanged(Number((res.json as { credits?: number })?.credits));
  if (res.status >= 400) throw Object.assign(new Error(said() || `Mnemo Scribe returned ${res.status}`), { status: res.status });
  return res.json as T;
}

export class ScribeApi {
  constructor(
    private baseUrl: string,
    private token: string,
    private http: Http
  ) {}

  /** Where and how this device talks to Scribe, for the app's screens (`app/http.ts`). */
  connection(): { baseUrl: string; token: string; http: Http } {
    return { baseUrl: this.baseUrl, token: this.token, http: this.http };
  }

  private url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  /** Where to top up: Scribe's own settings page. */
  get topUpUrl(): string {
    return this.url("/settings");
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    // A 401 is an answer, not a crash: it means the token was revoked.
    const res = await this.http({
      url: this.url(path),
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
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
  async ingest(files: { name: string; data: ArrayBuffer }[], folder: string, credits: number): Promise<IngestResult> {
    const { body, contentType } = multipart(files, { ...(folder ? { folder } : {}), credits: String(credits) });
    const res = await this.http({
      url: this.url("/api/notes/import"),
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": contentType },
      body,
    });

    return answer<IngestResult>(res);
  }

  /**
   * What importing these files will cost, before anything is sent to a
   * model. Free. The import takes exactly this, or nothing.
   */
  async importQuote(files: { name: string; data: ArrayBuffer }[]): Promise<{ credits: number; balance: number }> {
    const { body, contentType } = multipart(files, {});
    const res = await this.http({
      url: this.url("/api/notes/import/quote"),
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": contentType },
      body,
    });

    return answer<{ credits: number; balance: number }>(res);
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

  /** The earlier readings, newest first, one line each; no text until one is opened. */
  async earlier(): Promise<Earlier[]> {
    return (await this.call<{ readings: Earlier[] }>("/api/notes/what-next?history=1")).readings || [];
  }

  /** What a press will cost, free: `parentId` prices an Elaborate of that reading. */
  quoteReading(scope: WhatNextScope, target: string, parentId?: string): Promise<Quote> {
    const params = new URLSearchParams({ scope, target, ...(parentId ? { parentId } : {}) });
    return this.call<Quote>(`/api/notes/what-next/quote?${params}`);
  }

  /** The day's three suggested topics. */
  async suggestions(): Promise<Suggestion[]> {
    return (await this.call<{ suggestions: Suggestion[] }>("/api/notes/what-next/suggest")).suggestions || [];
  }

  /**
   * A paid press at `credits`, the price shown; the reading is written in
   * the background and read back by `whatNext()`.
   */
  pressWhatNext(scope: WhatNextScope, target: string, credits: number | null, more?: { parentId: string; part: string }): Promise<{ readingId: string }> {
    return this.call<{ readingId: string }>("/api/notes/what-next", {
      method: "POST",
      body: { scope, target, ...(more || {}), ...(credits === null ? {} : { credits }) },
    });
  }

  /** What a written answer will cost, free. */
  quoteAsk(): Promise<Quote> {
    return this.call<Quote>("/api/notes/search/quote");
  }

  /** A written answer from the notes at `credits`, the price shown; each [n] in it is `cited[n - 1]`. */
  async ask(question: string, credits: number | null): Promise<Answer> {
    const params = new URLSearchParams({ q: question, fuzzy: "1", answer: "1", ...(credits === null ? {} : { credits: String(credits) }) });
    const result = await this.call<Answer>(`/api/notes/search?${params}`);
    if (result.noCredits) throw new OutOfCredits();
    if (result.priceChanged !== undefined) throw new PriceChanged(result.priceChanged);
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
    if (!signed.signedUrl) throw new Error("This Mnemo Scribe is too old to take recordings from this app.");

    const res = await this.http({
      url: signed.signedUrl,
      method: "PUT",
      headers: { "Content-Type": type, "x-upsert": "true" },
      body: audio,
    });
    if (res.status >= 400) throw new Error(`Upload failed (${res.status})`);

    await this.call("/api/upload", { method: "PUT", body: { recordingId: id, storagePath: signed.storagePath } });
  }

  /** Starts the paid transcription. A 409 means it is already under way, which is fine. */
  async transcribe(id: string): Promise<void> {
    const res = await this.http({
      url: this.url("/api/transcribe"),
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: id }),
    });
    if (res.status === 409) return;
    answer(res);
  }
}
