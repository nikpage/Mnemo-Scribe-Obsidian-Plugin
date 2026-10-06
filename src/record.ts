// [Scribe]

import { App, DataAdapter, Modal, Notice, normalizePath } from "obsidian";
import type { ScribeApi } from "./api";

/**
 * Recording inside Obsidian, desktop and phone, by the app's rules.
 *
 * It starts on the tap: waiting for a voice cuts the first words, which is
 * where a pack keyword is said. Every five seconds a piece of audio is saved
 * to the plugin's own folder, so a crash keeps what was said. On Stop the
 * pieces become one file, held until Scribe has it: the audio goes straight
 * to storage on a signed link and never passes through Scribe's server. A
 * recording that could not be sent is sent again on the next start.
 *
 * The finished note arrives like any other, through a pull, and lands where
 * its tags fit.
 */

const CHUNK_MS = 5000;
const LIMIT_MS = 30 * 60 * 1000;

type Held = {
  id: string;
  filename: string;
  type: string;
  recorded_at: string;
  duration_seconds: number;
  file_size_bytes: number;
};

/** Ogg or WebM opus where it exists; the iPhone's own AAC where it does not. */
function bestType(): string {
  for (const type of ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/** `note_YYYYMMDD_HHMM`, the name the app gives a recording. */
function recordingName(at: Date): string {
  const date = at.toISOString().slice(0, 10).replace(/-/g, "");
  const time = at.toTimeString().slice(0, 5).replace(":", "");
  return `note_${date}_${time}`;
}

export class Recordings {
  constructor(
    private adapter: DataAdapter,
    private dir: string
  ) {}

  private get root() {
    return normalizePath(`${this.dir}/held`);
  }

  private async ensure(path: string) {
    if (!(await this.adapter.exists(path))) await this.adapter.mkdir(path);
  }

  async saveChunk(id: string, index: number, data: ArrayBuffer) {
    await this.ensure(this.root);
    await this.ensure(`${this.root}/${id}`);
    await this.adapter.writeBinary(`${this.root}/${id}/${String(index).padStart(5, "0")}`, data);
  }

  /** The pieces made into one file and its record, then the pieces removed. */
  async seal(held: Omit<Held, "file_size_bytes">): Promise<Held> {
    const folder = `${this.root}/${held.id}`;
    const pieces = (await this.adapter.list(folder)).files.sort();
    const parts = await Promise.all(pieces.map((piece) => this.adapter.readBinary(piece)));
    const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
    const audio = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      audio.set(new Uint8Array(part), at);
      at += part.byteLength;
    }
    const sealed = { ...held, file_size_bytes: size };
    await this.adapter.writeBinary(`${this.root}/${held.id}.audio`, audio.buffer);
    await this.adapter.write(`${this.root}/${held.id}.json`, JSON.stringify(sealed));
    await this.adapter.rmdir(folder, true);
    return sealed;
  }

  /** Recordings stopped but not yet in Scribe. */
  async held(): Promise<Held[]> {
    if (!(await this.adapter.exists(this.root))) return [];
    const files = (await this.adapter.list(this.root)).files.filter((f) => f.endsWith(".json"));
    const out: Held[] = [];
    for (const file of files) {
      try {
        out.push(JSON.parse(await this.adapter.read(file)) as Held);
      } catch {
        // A record cut off mid-write: its audio stays, and is not guessed at.
      }
    }
    return out;
  }

  /**
   * Each held recording sent: told to Scribe, uploaded, transcription
   * started. Only then is the audio removed here. A failure keeps it for the
   * next try; an out-of-credits refusal stops the round, since every other
   * recording would be refused the same way.
   */
  async sendAll(api: ScribeApi): Promise<number> {
    let sent = 0;
    for (const held of await this.held()) {
      const audio = await this.adapter.readBinary(`${this.root}/${held.id}.audio`);
      await api.newRecording({
        id: held.id,
        filename: held.filename,
        recorded_at: held.recorded_at,
        duration_seconds: held.duration_seconds,
        file_size_bytes: held.file_size_bytes,
      });
      await api.uploadAudio(held.id, held.filename, audio, held.type.split(";")[0] || "audio/webm");
      await api.transcribe(held.id);
      await this.adapter.remove(`${this.root}/${held.id}.audio`);
      await this.adapter.remove(`${this.root}/${held.id}.json`);
      sent++;
    }
    return sent;
  }
}

/**
 * The recording screen: a clock and a Stop button. Closing it any other way
 * also stops and keeps the recording — nothing said is thrown away by a
 * stray tap outside the box.
 */
export class RecordModal extends Modal {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private lock: { release(): Promise<void> } | null = null;
  private started = 0;
  private tick: number | null = null;
  private index = 0;
  private saves: Promise<void>[] = [];
  private id = crypto.randomUUID();
  private stopping: Promise<void> | null = null;

  constructor(
    app: App,
    private store: Recordings,
    private costNote: string,
    private afterStop: () => void
  ) {
    super(app);
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.addClass("mnemo-record");
    contentEl.createEl("h3", { text: "Recording" });
    const clock = contentEl.createDiv({ cls: "mnemo-clock", text: "0:00" });
    if (this.costNote) contentEl.createDiv({ cls: "mnemo-note", text: this.costNote });
    const stop = contentEl.createEl("button", { text: "Stop", cls: "mod-cta mnemo-stop" });
    stop.onclick = () => this.close();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      new Notice("Mnemo: the microphone is not available. Allow it for Obsidian and try again.");
      this.stream = null;
      this.close();
      return;
    }

    const type = bestType();
    this.recorder = new MediaRecorder(this.stream, {
      ...(type ? { mimeType: type } : {}),
      // Speech, not music: half the bitrate costs nothing a transcriber hears.
      audioBitsPerSecond: 64000,
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      const index = this.index++;
      this.saves.push(event.data.arrayBuffer().then((data) => this.store.saveChunk(this.id, index, data)));
    };
    this.recorder.start(CHUNK_MS);
    this.started = Date.now();
    await this.keepAwake();
    // A phone drops the screen lock whenever the app is left; it is asked
    // for again on every return.
    document.addEventListener("visibilitychange", this.onVisible);

    // Elapsed time, not counted ticks: a dark screen slows timers, not clocks.
    this.tick = window.setInterval(() => {
      const ms = Date.now() - this.started;
      const s = Math.floor(ms / 1000);
      clock.setText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
      if (ms >= LIMIT_MS) this.close();
    }, 500);
  }

  private onVisible = () => {
    if (document.visibilityState === "visible" && this.recorder?.state === "recording") void this.keepAwake();
  };

  private async keepAwake() {
    const wake = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    this.lock = wake ? await wake.request("screen").catch(() => null) : null;
  }

  onClose() {
    this.stopping ??= this.finish();
  }

  private async finish() {
    const seconds = Math.round((Date.now() - this.started) / 1000);
    if (this.tick) window.clearInterval(this.tick);
    document.removeEventListener("visibilitychange", this.onVisible);
    await this.lock?.release().catch(() => {});
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") {
      this.stream?.getTracks().forEach((track) => track.stop());
      return;
    }

    // The last piece arrives after stop is called; waiting for it is what
    // keeps a short note from losing its only piece.
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.stop();
    await stopped;
    this.stream?.getTracks().forEach((track) => track.stop());
    await Promise.all(this.saves);

    if (this.index === 0) {
      new Notice("Mnemo: nothing was recorded.");
      return;
    }
    const at = new Date(this.started);
    await this.store.seal({
      id: this.id,
      filename: recordingName(at),
      type: recorder.mimeType || "audio/webm",
      recorded_at: at.toISOString(),
      duration_seconds: seconds,
    });
    new Notice("Mnemo: recording kept. Sending it to Scribe…");
    this.afterStop();
  }
}
