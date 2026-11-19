// Listening (M11): the visitor's voice into words, by one of three engines.
// - device: the browser's own recogniser, run on the device (Chrome 139 and later, desktop), so no audio leaves it;
// - service: our gateway's speech service, over the voice socket, with the microphone captured here;
// - browser: the browser's own recogniser on its maker's servers, where the widget allows it.
import type { ApiError, VoiceLanguage, VoiceReply } from "@ucp/protocol/v1";

import type { Api } from "../chat/api";
// A file of our own, never inlined as a data: address, which the chat's content policy would refuse to run.
import WORKLET from "./capture.worklet.js?url&no-inline";
import { Endpointer } from "./endpoint";

export type Engine = "device" | "service" | "browser";

/** Why listening stopped short, in the words the chat shows. */
export class VoiceProblem extends Error {
  constructor(readonly kind: "denied" | "no-microphone" | "unavailable" | "busy" | "ended" | "lost") {
    super(kind);
  }
}

export type Listening = {
  /** Everything heard, once the visitor stops (it may be empty). */
  result: Promise<string>;
  /** Stop listening now and keep what was heard. */
  finish(): void;
  /** Stop listening and keep nothing. */
  cancel(): void;
};

type Options = { language: VoiceLanguage; onText: (text: string) => void; onLevel?: (level: number) => void };

// The browser's recogniser, where there is one (Chrome, Edge and Safari; prefixed in some).
type Results = ArrayLike<ArrayLike<{ transcript: string }>>;
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  onresult: ((event: { results: Results }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type Recognizer = (new () => Recognition) & {
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

const recognizer = (): Recognizer | undefined => {
  const found = globalThis as { SpeechRecognition?: Recognizer; webkitSpeechRecognition?: Recognizer };
  return found.SpeechRecognition ?? found.webkitSpeechRecognition;
};

export const hasRecognizer = () => Boolean(recognizer());

/** Whether the browser can recognise this language on the device now, with nothing to download. */
export async function onDevice(language: VoiceLanguage): Promise<boolean> {
  const Found = recognizer();
  if (!Found?.available) return false;
  try {
    return (await Found.available({ langs: [language], processLocally: true })) === "available";
  } catch {
    return false;
  }
}

export function listenInBrowser(options: Options & { local: boolean }): Listening {
  const Found = recognizer();
  if (!Found) return failed(new VoiceProblem("unavailable"));
  const recognition = new Found();
  recognition.lang = options.language;
  recognition.interimResults = true;
  recognition.continuous = false; // it stops by itself when the visitor stops speaking
  if (options.local) recognition.processLocally = true;
  let heard = "";
  let problem: VoiceProblem | null = null;
  const result = new Promise<string>((resolve, reject) => {
    recognition.onresult = (event) => {
      heard = Array.from(event.results, (alternatives) => alternatives[0]?.transcript ?? "").join("").trim();
      options.onText(heard);
    };
    recognition.onerror = (event) => {
      const kinds: Record<string, VoiceProblem["kind"]> = { "not-allowed": "denied", "audio-capture": "no-microphone" };
      if (event.error !== "no-speech" && event.error !== "aborted") problem = new VoiceProblem(kinds[event.error] ?? "unavailable");
    };
    recognition.onend = () => (problem ? reject(problem) : resolve(heard));
  });
  try {
    recognition.start();
  } catch {
    return failed(new VoiceProblem("unavailable"));
  }
  return { result, finish: () => recognition.stop(), cancel: () => recognition.abort() };
}

const loaded = new WeakSet<AudioContext>();

/** The microphone, 16 kHz PCM in 100 ms frames with their loudness, until the returned function stops it. */
async function capture(context: AudioContext, onFrame: (pcm: ArrayBuffer, level: number) => void, onLost: () => void) {
  if (!navigator.mediaDevices?.getUserMedia) throw new VoiceProblem("no-microphone");
  let stream: MediaStream;
  try {
    const audio = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    stream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (error) {
    const name = (error as Error).name;
    throw new VoiceProblem(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no-microphone");
  }
  try {
    if (!loaded.has(context)) {
      await context.audioWorklet.addModule(WORKLET);
      loaded.add(context);
    }
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "ucp-capture");
    const silent = context.createGain();
    silent.gain.value = 0; // pulled through to the output, so it runs, but never heard
    node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => onFrame(event.data.pcm, event.data.level);
    source.connect(node).connect(silent).connect(context.destination);
    stream.getAudioTracks()[0]?.addEventListener("ended", onLost); // the permission withdrawn, or the device gone
    return () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error instanceof VoiceProblem ? error : new VoiceProblem("unavailable");
  }
}

const KINDS: Partial<Record<ApiError["code"], VoiceProblem["kind"]>> = { rate_limited: "busy", session_expired: "ended" };

export function listenWithService(api: Api, context: AudioContext, options: Options): Listening {
  let socket: WebSocket | null = null;
  let stopCapture = () => {};
  let finished = false;
  let cancelled = false;
  let lost = false;
  const endpoint = new Endpointer();

  const finish = () => {
    if (finished) return;
    finished = true;
    stopCapture();
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "stop" }));
  };

  const result = (async () => {
    try {
      socket = await api.voice(options.language);
    } catch {
      throw new VoiceProblem("unavailable");
    }
    const open = socket;
    if (cancelled) {
      open.close();
      return "";
    }
    const heard = new Promise<string>((resolve, reject) => {
      let last = "";
      open.onmessage = (event: MessageEvent<string>) => {
        const reply = JSON.parse(event.data) as VoiceReply;
        if (reply.type === "error") return reject(new VoiceProblem(KINDS[reply.error.code] ?? "unavailable"));
        last = reply.text;
        if (reply.type === "final") resolve(last);
        else options.onText(last);
      };
      open.onclose = () => (lost ? reject(new VoiceProblem("lost")) : resolve(last));
    });
    try {
      stopCapture = await capture(
        context,
        (pcm, level) => {
          options.onLevel?.(level);
          if (!finished && open.readyState === WebSocket.OPEN) open.send(pcm);
          if (endpoint.push(level, 100)) finish();
        },
        () => {
          lost = true;
          finish();
        },
      );
    } catch (error) {
      open.close();
      throw error;
    }
    if (finished) stopCapture();
    return heard;
  })();

  return {
    result,
    finish,
    cancel() {
      cancelled = finished = true;
      stopCapture();
      socket?.close();
    },
  };
}

function failed(problem: VoiceProblem): Listening {
  return { result: Promise.reject(problem), finish() {}, cancel() {} };
}
