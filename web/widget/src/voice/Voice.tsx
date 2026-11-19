// The voice bar (M11), loaded on the first press of a voice button. Dictation puts the words in the question box for
// the visitor to send (M11-T2); a voice conversation sends each question when the visitor stops speaking, reads the
// answer aloud with pause and stop (M11-T3), then listens again. Every word stays in the chat as text.
import type { SpeechAudio, VoiceLanguage } from "@ucp/protocol/v1";
import { type RefObject, useEffect, useId, useRef, useState } from "react";

import type { Api } from "../chat/api";
import { Icon } from "../Icon";
import { strings as t } from "../strings";
import {
  type Engine,
  hasRecognizer,
  type Listening,
  listenInBrowser,
  listenWithService,
  onDevice,
  VoiceProblem,
} from "./listen";
import { Player, type Playing } from "./player";
import { firstLanguage, rememberedLanguage, rememberLanguage } from "./start";

const consented = new Set<Engine>(); // what the visitor accepted on this page; each is also recorded on the gateway
let serviceDown = false; // the gateway said it has no speech service: the browser's own recogniser, if allowed, instead

export type VoiceProps = {
  mode: "dictation" | "conversation";
  api: Api;
  languages: VoiceLanguage[];
  browserSpeech: "never" | "on_device" | "allowed";
  context: AudioContext | undefined;
  answering: boolean; // an answer is on its way
  failed: boolean; // the last answer failed: the conversation pauses, the problem shows in the chat
  sink: RefObject<((piece: SpeechAudio) => void) | null>; // where the chat sends the answer's spoken pieces
  onHeard: (text: string) => void; // dictation: the words so far
  onDone: (text: string | null) => void; // dictation: the words to keep, or null to keep none
  onAsk: (question: string, language: VoiceLanguage) => void; // conversation: ask, and read the answer aloud
  onClose: () => void;
};

type Phase =
  | { kind: "starting" }
  | { kind: "consent"; engine: Engine }
  | { kind: "listening"; engine: Engine }
  | { kind: "answering" }
  | { kind: "idle"; note?: string }
  | { kind: "problem"; problem: VoiceProblem["kind"] };

const LEVELS = [0.55, 1, 0.75, 0.4]; // the bars' share of the loudness, so they move unevenly
const MIC =
  "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM19 11a7 7 0 0 1-14 0M12 18v3";
const PAUSE = "M9 6v12M15 6v12";
const PLAY = "M8 5.5v13l10-6.5z";
const SKIP = "M7 7h10v10H7z";
const CROSS = "M6 6l12 12M18 6L6 18";
const CHECK = "M5 12l5 5L19 8";

/** A language's name as visitors say it: "British English", "Hindi (India)". */
const named = new Intl.DisplayNames(["en"], {
  type: "language",
  languageDisplay: "dialect",
});
const nameOf = (code: VoiceLanguage) => named.of(code) ?? code;

export default function VoiceBar(props: VoiceProps) {
  const {
    mode,
    api,
    languages,
    browserSpeech,
    context,
    answering,
    failed,
    sink,
  } = props;
  const [language, setLanguage] = useState(() =>
    firstLanguage(languages, navigator.languages ?? [], rememberedLanguage()),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "starting" });
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [playing, setPlaying] = useState<Playing>("idle");
  const [choosing, setChoosing] = useState(false);
  const listening = useRef<Listening | null>(null);
  const player = useRef<Player | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const asking = useId();

  async function engineFor(code: VoiceLanguage): Promise<Engine> {
    if (browserSpeech !== "never" && hasRecognizer() && (await onDevice(code)))
      return "device";
    if (serviceDown && browserSpeech === "allowed" && hasRecognizer())
      return "browser";
    return "service";
  }

  async function start(code = language) {
    listening.current?.cancel();
    listening.current = null;
    setHeard("");
    setLevel(0);
    setChoosing(false);
    const engine = await engineFor(code);
    if (consented.has(engine)) listen(engine, code);
    else setPhase({ kind: "consent", engine });
  }

  async function accept(engine: Engine) {
    setPhase({ kind: "starting" });
    try {
      await api.consent({ version: 1, engine }); // recorded before any recording (M11-T2)
    } catch {
      return setPhase({ kind: "problem", problem: "unavailable" });
    }
    consented.add(engine);
    listen(engine, language);
  }

  function listen(engine: Engine, code: VoiceLanguage) {
    setPhase({ kind: "listening", engine });
    const options = {
      language: code,
      onText: (text: string) => {
        setHeard(text);
        if (latest.current.mode === "dictation") latest.current.onHeard(text);
      },
      onLevel: setLevel,
    };
    const now =
      engine !== "service"
        ? listenInBrowser({ ...options, local: engine === "device" })
        : context
          ? listenWithService(api, context, options)
          : listenInBrowser({ ...options, local: false });
    listening.current = now;
    now.result.then(
      (text) => {
        if (listening.current !== now) return; // stopped, or started again
        listening.current = null;
        if (latest.current.mode === "dictation")
          return latest.current.onDone(text);
        if (!text.trim())
          return setPhase({ kind: "idle", note: t.voiceNothing });
        ask(text, code);
      },
      (problem: unknown) => {
        if (listening.current !== now) return;
        listening.current = null;
        const kind =
          problem instanceof VoiceProblem ? problem.kind : "unavailable";
        if (kind === "unavailable" && engine === "service") {
          serviceDown = true;
          if (browserSpeech === "allowed" && hasRecognizer())
            return void start(code);
        }
        setPhase({ kind: "problem", problem: kind });
      },
    );
  }

  function ask(question: string, code: VoiceLanguage) {
    const reading = new Player(context, code, setPlaying);
    player.current = reading;
    sink.current = (piece) => reading.push(piece);
    setPhase({ kind: "answering" });
    latest.current.onAsk(question, code);
  }

  // Once the answer has arrived and been read, listen again; after a failure, wait for the visitor.
  useEffect(() => {
    if (phase.kind !== "answering" || answering || playing !== "idle") return;
    sink.current = null;
    if (failed) setPhase({ kind: "idle" });
    else void start();
  }, [phase.kind, answering, playing, failed]);

  useEffect(() => {
    void start();
    // Nothing is recorded from a hidden page: dictation keeps what it heard; a conversation sends nothing.
    const hidden = () => {
      if (!document.hidden || !listening.current) return;
      if (latest.current.mode === "dictation") listening.current.finish();
      else {
        listening.current.cancel();
        listening.current = null;
        setPhase({ kind: "idle", note: t.voiceHidden });
      }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      listening.current?.cancel();
      listening.current = null;
      player.current?.stop();
      sink.current = null;
    };
  }, []);

  function end() {
    listening.current?.cancel();
    listening.current = null;
    player.current?.stop();
    sink.current = null;
    if (mode === "dictation") props.onDone(null);
    else props.onClose();
  }

  function choose(code: VoiceLanguage) {
    setLanguage(code);
    rememberLanguage(code);
    setChoosing(false);
    if (phase.kind === "listening") void start(code);
  }

  const speaking = phase.kind === "answering" && playing !== "idle";
  const state =
    phase.kind === "starting"
      ? t.voiceStarting
      : phase.kind === "listening"
        ? t.voiceListening
        : phase.kind === "answering"
          ? playing === "paused"
            ? t.voicePaused
            : speaking
              ? t.voiceSpeaking
              : t.voiceThinking
          : phase.kind === "idle"
            ? (phase.note ?? t.voiceReady)
            : phase.kind === "problem"
              ? t.voiceProblems[phase.problem]
              : "";
  const moving =
    phase.kind === "listening" || (speaking && playing === "speaking");
  const levelled = phase.kind === "listening" && level > 0; // the bars follow the microphone, where it is ours
  const words =
    phase.kind === "listening" && mode === "conversation" ? heard : "";

  if (phase.kind === "consent") {
    return (
      <div
        className={`voice-bar consent ${mode}`}
        role="group"
        aria-labelledby={asking}
      >
        <p id={asking} className="voice-ask">
          {t.voiceConsentTitle}
        </p>
        <p className="voice-note">{t.voiceConsent[phase.engine]}</p>
        <div className="voice-actions">
          <button
            type="button"
            className="secondary"
            onClick={() => void accept(phase.engine)}
          >
            {t.voiceContinue}
          </button>
          <button type="button" className="quiet" onClick={end}>
            {t.voiceCancel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`voice-bar ${mode}`}
      role="group"
      aria-label={t.voice}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          end();
        }
      }}
    >
      <span
        className={moving && !levelled ? "levels moving" : "levels"}
        aria-hidden="true"
      >
        {LEVELS.map((share, i) => (
          <i
            key={i}
            style={
              levelled
                ? {
                    blockSize: `${Math.round(30 + Math.min(1, level * 6 * share) * 70)}%`,
                  }
                : undefined
            }
          />
        ))}
      </span>
      <p className={words ? "voice-state heard" : "voice-state"}>
        <span>{words || state}</span>
      </p>
      <span className="hidden" role="status">
        {state}
      </span>
      <span className="voice-controls">
        {languages.length > 1 &&
          (phase.kind === "listening" || phase.kind === "idle") && (
            <button
              type="button"
              className="quiet language"
              aria-expanded={choosing}
              aria-label={t.voiceLanguage(nameOf(language))}
              onClick={() => setChoosing(!choosing)}
            >
              {nameOf(language)}
            </button>
          )}
        {phase.kind === "listening" && mode === "dictation" && (
          <button
            type="button"
            className="secondary"
            onClick={() => listening.current?.finish()}
          >
            {t.voiceDone}
          </button>
        )}
        {speaking && (
          <>
            <button
              type="button"
              className="voice-icon"
              aria-label={playing === "paused" ? t.voiceResume : t.voicePause}
              onClick={() =>
                playing === "paused"
                  ? player.current?.resume()
                  : player.current?.pause()
              }
            >
              <Icon
                path={playing === "paused" ? PLAY : PAUSE}
                filled={playing === "paused"}
              />
            </button>
            <button
              type="button"
              className="voice-icon"
              aria-label={t.voiceSkip}
              onClick={() => player.current?.stop()}
            >
              <Icon path={SKIP} />
            </button>
          </>
        )}
        {phase.kind === "idle" && mode === "conversation" && (
          <button
            type="button"
            className="secondary"
            onClick={() => void start()}
          >
            <Icon path={MIC} />
            {t.voiceSpeak}
          </button>
        )}
        {phase.kind === "problem" &&
          phase.problem !== "denied" &&
          phase.problem !== "no-microphone" && (
            <button
              type="button"
              className="secondary"
              onClick={() => void start()}
            >
              {t.voiceRetry}
            </button>
          )}
        <button
          type="button"
          className="voice-icon"
          aria-label={mode === "dictation" ? t.voiceCancel : t.voiceEnd}
          onClick={end}
        >
          <Icon path={CROSS} />
        </button>
      </span>
      {choosing && (
        <ul className="options voice-languages" aria-label={t.voiceLanguages}>
          {languages.map((code) => (
            <li key={code}>
              <button
                type="button"
                aria-pressed={code === language}
                onClick={() => choose(code)}
              >
                {nameOf(code)}
                {code === language && <Icon path={CHECK} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
