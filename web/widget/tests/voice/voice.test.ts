import { expect, test, vi } from "vitest";

import { readConfig } from "../../src/App";
import { Endpointer } from "../../src/voice/endpoint";
import { Player, type Playing } from "../../src/voice/player";
import { firstLanguage } from "../../src/voice/start";

test("the first language is the visitor's last choice, else their browser's, else the widget's default", () => {
  const offered = ["en-GB", "en-US", "hi-IN"] as const;
  expect(firstLanguage([...offered], ["fr-FR"], null)).toBe("en-GB");
  expect(firstLanguage([...offered], ["hi-IN", "en-US"], null)).toBe("hi-IN");
  expect(firstLanguage([...offered], ["en-us"], null)).toBe("en-US"); // exactly, whatever the case
  expect(firstLanguage([...offered], ["en-AU"], null)).toBe("en-GB"); // the same language in another region
  expect(firstLanguage([...offered], ["en-US"], "hi-IN")).toBe("hi-IN");
  expect(firstLanguage([...offered], ["en-US"], "fr-FR")).toBe("en-US"); // a remembered choice no longer offered
});

test("listening ends 0.8 s after speech, or after 8 s of none, or at the 60 s the gateway takes", () => {
  const ended = (levels: number[], endpointer = new Endpointer()) => levels.findIndex((level) => endpointer.push(level, 100));
  const quiet = (n: number) => Array<number>(n).fill(0.003);
  const loud = (n: number) => Array<number>(n).fill(0.2);
  expect(ended([...quiet(3), ...loud(10), ...quiet(20)])).toBe(3 + 10 + 7); // the 8th quiet frame: 800 ms
  expect(ended([...loud(10), ...quiet(5), ...loud(5), ...quiet(20)])).toBe(10 + 5 + 5 + 7); // a pause is not the end
  expect(ended(quiet(100))).toBe(79); // nothing said in 8 s
  expect(ended([...loud(1), ...quiet(100)])).toBe(79); // a click is not speech: still nothing said in 8 s
  expect(ended(loud(700))).toBe(599);
});

test("a widget's voice settings are read as the loader reads its own: anything wrong means no voice", () => {
  expect(readConfig({ voice_enabled: true, voice_languages: ["hi-IN", "xx-XX" as never, "hi-IN"] }).voice).toEqual({
    languages: ["hi-IN"],
    browser: "on_device",
  });
  expect(readConfig({ voice_enabled: true, voice_languages: ["en-GB"], browser_speech: "allowed" }).voice?.browser).toBe("allowed");
  expect(readConfig({ voice_enabled: true, voice_languages: [] as never }).voice).toBeNull();
  expect(readConfig({ voice_enabled: "yes" as never, voice_languages: ["en-GB"] }).voice).toBeNull();
  expect(readConfig({}).voice).toBeNull();
});

/** Web Audio and the browser's voice, as far as the player uses them, each clip lasting until the test ends it. */
function stage() {
  const ends: (() => void)[] = [];
  const said: string[] = [];
  const context = {
    decodeAudioData: vi.fn(async () => ({})),
    createBufferSource: () => {
      const source = { buffer: null, onended: null as null | (() => void), connect: vi.fn(), stop: vi.fn(), start: () => ends.push(() => source.onended?.()) };
      return source;
    },
    destination: {},
    suspend: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
  } as unknown as AudioContext;
  const synthesis = {
    speak: (utterance: SpeechSynthesisUtterance) => {
      said.push(utterance.text);
      ends.push(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent));
    },
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [{ lang: "en-GB", name: "British" }] as SpeechSynthesisVoice[],
  };
  return { context, synthesis, said, next: async () => { ends.shift()?.(); await new Promise((done) => setTimeout(done, 0)); } };
}

test("the player reads pieces in order: clips through Web Audio, pieces without audio in the browser's voice", async () => {
  vi.stubGlobal("SpeechSynthesisUtterance", class { lang = ""; voice = null; onend: (() => void) | null = null; onerror = null; constructor(readonly text: string) {} });
  const { context, synthesis, said, next } = stage();
  const states: Playing[] = [];
  const player = new Player(context, "en-GB", (state) => states.push(state), synthesis);
  player.push({ text: "First.", audio: "UklGRg==" });
  player.push({ text: "Second.", audio: null });
  await new Promise((done) => setTimeout(done, 0));
  expect(states).toEqual(["speaking"]);
  expect(said).toEqual([]); // the clip plays first
  await next();
  expect(said).toEqual(["Second."]);
  player.pause();
  expect(synthesis.pause).toHaveBeenCalled();
  expect(context.suspend).toHaveBeenCalled();
  player.resume();
  await next();
  expect(states).toEqual(["speaking", "paused", "speaking", "idle"]);

  player.push({ text: "Third.", audio: null });
  await new Promise((done) => setTimeout(done, 0));
  player.stop();
  player.push({ text: "Never read.", audio: null });
  expect(synthesis.cancel).toHaveBeenCalled();
  expect(said).toEqual(["Second.", "Third."]);
  expect(player.state).toBe("idle");
  vi.unstubAllGlobals();
});
