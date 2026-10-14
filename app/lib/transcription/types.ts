// [Scribe]

export interface Utterance {
  speaker: string;
  text: string;
  /**
   * Where this line sits in the audio, in seconds from the start. A note is
   * a recording before it is text: a fact read off a transcript has to be
   * traceable back to the moment it was said, and a line on screen has to be
   * playable. Optional because an imported document has no audio behind it.
   */
  start?: number;
  end?: number;
}

export interface TranscriptionResult {
  id: string;
  status: "completed" | "processing" | "error";
  utterances: Utterance[];
  /** The language the provider heard, when it detected one rather than being told. */
  language?: string;
  error?: string;
  /** Who actually transcribed it, and their id for the call. */
  provider?: "assemblyai" | "speechmatics" | "groq";
  providerRef?: string;
}

export interface TranscriptionProvider {
  submit(
    audioUrl: string,
    options?: {
      speakersExpected?: number;
      /**
       * The user's primary language. Not the language of the note — providers
       * detect that. This is what they fall back to when detection is unsure.
       */
      fallbackLanguage?: string;
    }
  ): Promise<{ id: string }>;
  getResult(id: string): Promise<TranscriptionResult>;
  verifyWebhook(request: Request): Promise<boolean>;
  parseWebhook(request: Request): Promise<TranscriptionResult>;
}

/**
 * A provider that hands back the transcript in the same call.
 *
 * Whisper on Groq has no job queue and no webhook: the audio goes up, the
 * transcript comes back. There is nothing to poll and nothing to call us
 * back, so the whole transcription happens inside `/api/transcribe` and the
 * submit/getResult/webhook trio below would be three empty methods.
 */
export interface SynchronousProvider {
  synchronous: true;
  transcribeNow(
    audioUrl: string,
    options?: { fallbackLanguage?: string }
  ): Promise<TranscriptionResult>;
}

export type AnyProvider = TranscriptionProvider | SynchronousProvider;

export function isSynchronous(provider: AnyProvider): provider is SynchronousProvider {
  return "synchronous" in provider && provider.synchronous === true;
}
