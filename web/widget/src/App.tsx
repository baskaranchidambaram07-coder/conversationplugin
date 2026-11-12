// The chat inside the panel (M2), in the world of DESIGN.md and the composition the user picked
// (web/widget/.impeccable/surfaces/src-app-tsx.md).
import { inkOn, isColor } from "@ucp/protocol/brand";
import type { Block, WidgetConfig } from "@ucp/protocol/v1";
import { type CSSProperties, type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Api, Failure, gateway } from "./chat/api";
import { type Bridge, connect, type Mode } from "./chat/bridge";
import { type Problem, problemOf } from "./chat/problem";
import { type Answer, pending } from "./chat/state";
import { runTurn } from "./chat/turn";
import { strings as t } from "./strings";

const LIMIT = 4000;
const WARN_AT = 3600; // the character count appears only near the limit
const INK = "#2b241f";

type Settings = { title: string; color: string; logo: string | null; welcome: string | null; prompts: string[]; notice: string };
type Turn = { key: string; question: string; answer: Answer; problem: Problem | null };
type Live = { api: Api; bridge: Bridge; signedIn: boolean; conversation?: string; stop?: AbortController };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Every display setting checked, as the loader does: a bad value falls back, never reaches the page. */
export function readConfig(config: Partial<WidgetConfig>): Settings {
  const prompts = Array.isArray(config.suggested_prompts) ? config.suggested_prompts : [];
  return {
    title: text(config.title, 80) || "Chat",
    color: isColor(config.brand_color) ? config.brand_color : INK,
    logo: typeof config.logo_url === "string" && /^https:\/\/[!-~]+$/.test(config.logo_url) ? config.logo_url : null,
    welcome: text(config.welcome_message, 1000) || null,
    prompts: prompts.map((prompt) => text(prompt, 200)).filter(Boolean).slice(0, 4),
    notice: text(config.ai_notice, 500) || t.notice,
  };
}

export const plain = (blocks: Block[]) =>
  blocks
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");

const initials = (title: string) =>
  title
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

const newKey = () => `cm_${crypto.randomUUID()}`;

export function App({ widgetId, win = window }: { widgetId: string; win?: Window }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [startup, setStartup] = useState<Problem | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [ended, setEnded] = useState<Problem | null>(null);
  const [heard, setHeard] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [away, setAway] = useState(false); // the visitor has scrolled up from the newest message
  const follow = useRef(true); // a new question always brings the view down
  const followed = useRef(0); // the content height the view last kept up with
  const [shown, setShown] = useState(0); // how often the loader has shown the chat
  const [logoFailed, setLogoFailed] = useState(false);
  const [paused, setPaused] = useState(false); // the panel is closed: nothing animates (DESIGN.md)
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLElement>(null);
  const live = useRef<Live>(null);

  async function loadConfig() {
    setStartup(null);
    try {
      const response = await fetch(`/v1/widgets/${widgetId}/config`, { credentials: "omit" });
      if (!response.ok) throw new Failure(response.status, null);
      setSettings(readConfig(await response.json()));
    } catch (error) {
      setStartup(problemOf(error instanceof Failure ? error : new Failure(0, null)));
    }
  }

  useEffect(() => {
    if (live.current) return; // React's development double start must not connect twice
    const state = { signedIn: false } as Live;
    state.bridge = connect(win, {
      init(chatMode, signedIn) {
        state.signedIn = signedIn;
        setMode(chatMode);
      },
      shown() {
        setPaused(false);
        setShown((count) => count + 1);
      },
      hidden: () => setPaused(true),
    });
    state.api = gateway(widgetId, () => (state.signedIn ? state.bridge.token() : Promise.resolve(null)));
    live.current = state;
    void loadConfig();
  }, []);

  // The loader says the chat is shown, often before the configuration has arrived: focus the box once it exists.
  useEffect(() => {
    if (shown) input.current?.focus();
  }, [shown, settings]);

  useEffect(() => {
    if (mode !== "floating") return;
    const escape = (event: globalThis.KeyboardEvent) => event.key === "Escape" && live.current?.bridge.close();
    win.addEventListener("keydown", escape);
    return () => win.removeEventListener("keydown", escape);
  }, [mode]);

  // Follow the newest message unless the visitor has scrolled up to read something.
  useLayoutEffect(() => {
    // Decided from where the view is, not from scroll events, which some browsers deliver a frame late: a visitor
    // still at the end of what was there keeps following; one who scrolled up to read stays where they are.
    const box = log.current;
    if (!box) return;
    if (follow.current || box.scrollTop + box.clientHeight >= followed.current - 48) box.scrollTop = box.scrollHeight;
    follow.current = false;
    followed.current = box.scrollHeight;
  }, [turns]);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [draft, settings]);

  const busy = turns.some(({ answer }) => answer.status === "pending" || answer.status === "streaming");
  const change = (key: string, next: (turn: Turn) => Turn) =>
    setTurns((all) => all.map((turn) => (turn.key === key ? next(turn) : turn)));

  async function ask(question: string, replacing?: string) {
    const session = live.current;
    if (!session || ended) return;
    const key = newKey();
    follow.current = true;
    setTurns((all) => [
      ...all.filter((turn) => turn.key !== replacing),
      { key, question, answer: pending(), problem: null },
    ]);
    const stop = new AbortController();
    session.stop = stop;
    try {
      session.conversation ??= (await session.api.conversation()).id;
      const answer = await runTurn(session.api, session.conversation, question, key, stop.signal, (next) =>
        change(key, (turn) => ({ ...turn, answer: next })),
      );
      if (answer.status === "complete") setHeard(t.answered(plain(answer.blocks)));
      if (answer.status === "failed") {
        change(key, (turn) => ({ ...turn, problem: problemOf(new Failure(502, answer.error)) }));
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        change(key, (turn) => ({ ...turn, answer: { ...turn.answer, status: "stopped" } }));
        return;
      }
      const problem = problemOf(error);
      if (!problem.retryable) setEnded(problem);
      change(key, (turn) => ({ ...turn, answer: { ...turn.answer, status: "failed" }, problem }));
    } finally {
      if (session.stop === stop) session.stop = undefined;
    }
  }

  function send() {
    const question = draft.trim();
    if (!question || busy) return;
    setDraft("");
    void ask(question);
  }

  function enter(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter adds a line, and nothing happens while an input method is composing a character.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    send();
  }

  function startOver() {
    const session = live.current;
    if (!session) return;
    session.api = gateway(widgetId, () => (session.signedIn ? session.bridge.token() : Promise.resolve(null)));
    session.conversation = undefined;
    setTurns([]);
    setEnded(null);
    input.current?.focus();
  }

  async function copy(turn: Turn) {
    await navigator.clipboard?.writeText(plain(turn.answer.blocks)).catch(() => {});
    setCopied(turn.key);
    setTimeout(() => setCopied((current) => (current === turn.key ? null : current)), 2000);
  }

  if (!settings) {
    return (
      <div className="chat waiting">
        {startup ? (
          <ProblemNote problem={startup} action={t.retry} onAction={loadConfig} />
        ) : (
          <div className="ring" role="status" aria-label={t.loading} />
        )}
      </div>
    );
  }

  const theme = { "--brand": settings.color, "--on-brand": inkOn(settings.color) } as CSSProperties;
  const left = LIMIT - draft.length;
  return (
    <div className={paused ? "chat paused" : "chat"} style={theme}>
      <header className="head">
        <span className="logo" aria-hidden="true">
          {settings.logo && !logoFailed ? (
            <img src={settings.logo} alt="" onError={() => setLogoFailed(true)} />
          ) : (
            initials(settings.title)
          )}
        </span>
        <h1>{settings.title}</h1>
        {mode === "floating" && (
          <button type="button" className="icon" aria-label={t.close} onClick={() => live.current?.bridge.close()}>
            <Icon path="M6 6l12 12M18 6 6 18" />
          </button>
        )}
      </header>

      <main
        className="log"
        ref={log}
        onScroll={(event) => {
          const box = event.currentTarget;
          setAway(box.scrollHeight - box.scrollTop - box.clientHeight >= 48);
        }}
      >
        <p className="notice">{settings.notice}</p>
        {settings.welcome && (
          <p className="card" dir="auto">
            {settings.welcome}
          </p>
        )}
        {turns.length === 0 && settings.prompts.length > 0 && (
          <ul className="prompts">
            {settings.prompts.map((prompt) => (
              <li key={prompt}>
                <button type="button" onClick={() => void ask(prompt)} disabled={Boolean(ended)}>
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        )}
        {turns.map((turn) => (
          <TurnView
            key={turn.key}
            turn={turn}
            copied={copied === turn.key}
            onCopy={() => void copy(turn)}
            onRetry={ended ? undefined : () => void ask(turn.question, turn.key)}
          />
        ))}
        {ended && <ProblemNote problem={ended} action={ended.kind === "expired" ? t.newChat : undefined} onAction={startOver} />}
      </main>

      <footer className="foot">
        {away && (
          <button
            type="button"
            className="latest"
            onClick={() => log.current?.scrollTo({ top: log.current.scrollHeight })}
          >
            <Icon path="M12 5v14M6 13l6 6 6-6" />
            {t.latest}
          </button>
        )}

        <form
          className="compose"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) live.current?.stop?.abort();
            else send();
          }}
        >
          <label className="hidden" htmlFor="question">
            {t.input}
          </label>
          <textarea
            id="question"
            ref={input}
            rows={1}
            value={draft}
            maxLength={LIMIT}
            placeholder={t.placeholder}
            aria-describedby={left <= LIMIT - WARN_AT ? "left" : undefined}
            disabled={Boolean(ended)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={enter}
          />
          <button
            type="submit"
            className="send"
            aria-label={busy ? t.stop : t.send}
            disabled={!busy && (!draft.trim() || Boolean(ended))}
          >
            {busy ? <Icon path="M7 7h10v10H7z" filled /> : <Icon path="M12 19V5M5 12l7-7 7 7" />}
          </button>
        </form>
        {left <= LIMIT - WARN_AT && (
          <p id="left" className="count">
            {t.remaining(left)}
          </p>
        )}
        <p className="credit">{t.credit}</p>
        <div className="hidden" role="status" aria-live="polite">
          {heard}
        </div>
      </footer>
    </div>
  );
}

function TurnView({
  turn,
  copied,
  onCopy,
  onRetry,
}: {
  turn: Turn;
  copied: boolean;
  onCopy: () => void;
  onRetry?: () => void;
}) {
  const { answer, problem } = turn;
  const working = answer.status === "pending" || (answer.status === "streaming" && !plain(answer.blocks));
  return (
    <div className="turn">
      <p className="mine" dir="auto">
        <span className="hidden">{t.you} </span>
        {turn.question}
      </p>
      <article className="card answer" aria-busy={answer.status === "pending" || answer.status === "streaming"}>
        <span className="hidden">{t.answer}</span>
        {working && (
          <span className="dots" role="img" aria-label={t.working}>
            <span />
            <span />
            <span />
          </span>
        )}
        {answer.blocks.map((block, index) =>
          block ? <BlockView key={index} block={block} /> : null,
        )}
        {answer.status === "stopped" && <p className="meta">{t.stopped}</p>}
        {answer.status === "failed" && problem && (
          <ProblemNote problem={problem} action={onRetry && problem.retryable ? t.retry : undefined} onAction={onRetry} />
        )}
        {answer.status === "complete" && (
          <button type="button" className="quiet" onClick={onCopy}>
            <Icon path={copied ? "M5 12l5 5L19 8" : "M8 8h11v11H8zM5 16V5h11"} />
            {copied ? t.copied : t.copy}
          </button>
        )}
      </article>
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  const content = typeof block.text === "string" ? block.text : "";
  // Markdown shows as plain text until the rendering engine (M3) draws it.
  if (block.type === "text" || block.type === "markdown") return content ? <p className="text">{content}</p> : null;
  return <p className="text unknown">{content || t.unknownBlock}</p>;
}

function ProblemNote({ problem, action, onAction }: { problem: Problem; action?: string; onAction?: () => void }) {
  return (
    <div className="problem" role="alert">
      <p>{t.problems[problem.kind]}</p>
      {problem.reference && <p className="meta">{t.reference(problem.reference)}</p>}
      {action && onAction && (
        <button type="button" className="secondary" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  );
}

function Icon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="glyph">
      <path
        d={path}
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
