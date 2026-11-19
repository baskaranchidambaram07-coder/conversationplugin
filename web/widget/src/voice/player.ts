// Speaking (M11): an answer's pieces, read aloud in order as they arrive. A piece with audio plays through Web Audio;
// one without (no speech service, or it failed) is read by the browser's own voice.
import type { SpeechAudio } from "@ucp/protocol/v1";

export type Playing = "speaking" | "paused" | "idle";

type Synthesis = Pick<SpeechSynthesis, "speak" | "cancel" | "pause" | "resume" | "getVoices">;

export class Player {
  private queue: Pick<SpeechAudio, "text" | "audio">[] = [];
  private running = false;
  private stopped = false;
  private source: AudioBufferSourceNode | null = null;
  private wake: (() => void) | null = null;
  state: Playing = "idle";

  constructor(
    private readonly context: AudioContext | undefined,
    private readonly language: string,
    private readonly onState: (state: Playing) => void,
    private readonly synthesis: Synthesis | undefined = globalThis.speechSynthesis,
  ) {}

  push(piece: Pick<SpeechAudio, "text" | "audio">) {
    if (this.stopped) return;
    this.queue.push(piece);
    void this.run();
  }

  pause() {
    if (this.state !== "speaking") return;
    this.synthesis?.pause();
    void this.context?.suspend();
    this.set("paused");
  }

  resume() {
    if (this.state !== "paused") return;
    this.synthesis?.resume();
    void this.context?.resume();
    this.set(this.running ? "speaking" : "idle");
  }

  /** Stops reading and drops what is left of this answer. */
  stop() {
    this.stopped = true;
    this.queue = [];
    try {
      this.source?.stop();
    } catch {
      // it had not started
    }
    this.synthesis?.cancel();
    this.wake?.();
    void this.context?.resume();
    this.set("idle");
  }

  private set(state: Playing) {
    if (state === this.state) return;
    this.state = state;
    this.onState(state);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    if (this.state !== "paused") this.set("speaking");
    while (this.queue.length && !this.stopped) {
      const piece = this.queue.shift()!;
      try {
        await (piece.audio && this.context ? this.play(piece.audio, this.context) : this.say(piece.text));
      } catch {
        await this.say(piece.text).catch(() => {}); // a clip that cannot be decoded is read by the browser instead
      }
    }
    this.running = false;
    if (this.state === "speaking") this.set("idle");
  }

  private async play(audio: string, context: AudioContext) {
    const bytes = Uint8Array.from(atob(audio), (character) => character.charCodeAt(0));
    const buffer = await context.decodeAudioData(bytes.buffer);
    if (this.stopped) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.source = source;
    await new Promise<void>((done) => {
      this.wake = done;
      source.onended = () => done();
      source.start();
    });
    this.source = null;
  }

  private say(text: string) {
    const synthesis = this.synthesis;
    if (!synthesis || typeof SpeechSynthesisUtterance === "undefined") return Promise.resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.language;
    const voices = synthesis.getVoices();
    const language = this.language.split("-")[0];
    utterance.voice = voices.find((voice) => voice.lang === this.language) ?? voices.find((voice) => voice.lang.startsWith(`${language}-`)) ?? null;
    return new Promise<void>((done) => {
      this.wake = done;
      utterance.onend = utterance.onerror = () => done();
      synthesis.speak(utterance);
    });
  }
}
