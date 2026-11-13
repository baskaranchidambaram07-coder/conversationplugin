// The chat inside the panel (M2), in the world of DESIGN.md and the composition the user picked
// (web/widget/.impeccable/surfaces/src-app-tsx.md).
import { inkOn, isColor } from "@ucp/protocol/brand";
import type { Block, Conversation, WidgetConfig } from "@ucp/protocol/v1";
import { type CSSProperties, type KeyboardEvent, type Ref, useEffect, useLayoutEffect, useRef, useState } from "react";

import { type Api, Failure, gateway } from "./chat/api";
import { type Bridge, connect, type Mode } from "./chat/bridge";
import { type Turn, turnsOf, when } from "./chat/history";
import { type Problem, problemOf } from "./chat/problem";
import { type Answer, pending } from "./chat/state";
import { recover, runTurn } from "./chat/turn";
import { CopyButton, Icon } from "./Icon";
import { BlockView } from "./render/registry";
import { strings as t } from "./strings";

const LIMIT = 4000;
const WARN_AT = 3600; // the character count appears only near the limit
const INK = "#2b241f";

type Settings = {
  title: string;
  color: string;
  logo: string | null;
  welcome: string | null;
  prompts: string[];
  notice: string;
  history: boolean;
};
type Live = { api: Api; bridge: Bridge; signedIn: boolean; conversation?: string; stop?: AbortController };
type Chats = { items: Conversation[]; next: string | null; loading: boolean; loaded: boolean; problem: Problem | null };

const NO_CHATS: Chats = { items: [], next: null, loading: false, loaded: false, problem: null };
const WIDE = "(min-width: 720px)"; // room for the list of chats beside the conversation
const LIST = "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01";
const PLUS = "M12 5v14M5 12h14";
const BACK = "M15 18l-6-6 6-6";

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
    history: config.history_enabled === true,
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
  const [away, setAway] = useState(false); // the visitor has scrolled up from the newest message
  const follow = useRef(true); // a new question always brings the view down
  const followed = useRef(0); // the content height the view last kept up with
  const [shown, setShown] = useState(0); // how often the loader has shown the chat
  const [logoFailed, setLogoFailed] = useState(false);
  const [paused, setPaused] = useState(false); // the panel is closed: nothing animates (DESIGN.md)
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLElement>(null);
  const live = useRef<Live>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [wide, setWide] = useState(() => Boolean(win.matchMedia?.(WIDE).matches));
  const [browsing, setBrowsing] = useState(false); // the list of chats covers the conversation (narrow frames)
  const [chats, setChats] = useState<Chats>(NO_CHATS);
  const [current, setCurrent] = useState<string | null>(null); // the chat on screen, once it has a question
  const [opening, setOpening] = useState<Conversation | null>(null);
  const [openFailed, setOpenFailed] = useState<Problem | null>(null);
  const [earlier, setEarlier] = useState<string | null>(null); // where the chat on screen continues further back
  const [earlierFailed, setEarlierFailed] = useState<Problem | null>(null);
  const [focusTo, setFocusTo] = useState<"input" | "chats" | "list" | null>(null);
  const keep = useRef<number | null>(null); // distance from the end to hold while earlier messages go in above
  const chatsButton = useRef<HTMLButtonElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const lastOpened = useRef<Conversation | null>(null);

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
      init(chatMode, isSignedIn) {
        state.signedIn = isSignedIn;
        setSignedIn(isSignedIn);
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

  // Escape leaves the list of chats first, then closes a floating panel.
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (browsing) hideChats();
      else if (mode === "floating") live.current?.bridge.close();
    };
    win.addEventListener("keydown", escape);
    return () => win.removeEventListener("keydown", escape);
  }, [mode, browsing]);

  useEffect(() => {
    const query = win.matchMedia?.(WIDE);
    if (!query) return;
    const change = () => setWide(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);

  const history = Boolean(settings?.history && signedIn);
  const side = history && wide; // the list stands beside the conversation
  useEffect(() => {
    if (side) void loadChats();
    else setBrowsing(false);
  }, [side]);

  // Focus moves with the view, after it is drawn: to the list's heading, back to its button, or to the question box.
  useEffect(() => {
    if (!focusTo) return;
    ({ input, chats: chatsButton, list: listTitle })[focusTo].current?.focus();
    setFocusTo(null);
  }, [focusTo]);

  // Follow the newest message unless the visitor has scrolled up to read something.
  useLayoutEffect(() => {
    // Decided from where the view is, not from scroll events, which some browsers deliver a frame late: a visitor
    // still at the end of what was there keeps following; one who scrolled up to read stays where they are.
    const box = log.current;
    if (!box) return;
    if (keep.current !== null) {
      box.scrollTop = box.scrollHeight - keep.current; // earlier messages went in above: the view stays put
      keep.current = null;
    } else if (follow.current || box.scrollTop + box.clientHeight >= followed.current - 48) {
      box.scrollTop = box.scrollHeight;
    }
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

  /** Shows one answer until it settles. Stop, a new chat or opening another chat ends the watch, not the answer. */
  async function track(session: Live, key: string, work: (signal: AbortSignal) => Promise<Answer>) {
    const stop = new AbortController();
    session.stop = stop;
    try {
      const answer = await work(stop.signal);
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
      if (side) void loadChats(); // the chat just asked in moves to the top of the list
    }
  }

  async function ask(question: string, replacing?: string) {
    const session = live.current;
    if (!session || ended) return;
    const key = newKey();
    follow.current = true;
    setTurns((all) => [
      ...all.filter((turn) => turn.key !== replacing),
      { key, question, answer: pending(), problem: null },
    ]);
    await track(session, key, async (signal) => {
      if (!session.conversation) {
        const { id } = await session.api.conversation();
        if (signal.aborted) throw new DOMException("The visitor moved on", "AbortError");
        session.conversation = id;
        setCurrent(id);
      }
      const conversation = session.conversation;
      return runTurn(session.api, conversation, question, key, signal, (next) =>
        change(key, (turn) => ({ ...turn, answer: next })),
      );
    });
  }

  async function loadChats(cursor?: string) {
    const session = live.current;
    if (!session) return;
    setChats((was) => ({ ...was, loading: true, problem: null }));
    try {
      const page = await session.api.conversations(cursor);
      setChats((was) => ({
        items: cursor ? [...was.items, ...page.conversations] : page.conversations,
        next: page.next,
        loading: false,
        loaded: true,
        problem: null,
      }));
    } catch (error) {
      setChats((was) => ({ ...was, loading: false, problem: problemOf(error) }));
    }
  }

  function showChats() {
    setBrowsing(true);
    setFocusTo("list");
    void loadChats();
  }

  function hideChats() {
    setBrowsing(false);
    setFocusTo("chats");
  }

  /** Leaves the chat on screen; its answer, if one is on the way, is still stored and found in the list later. */
  function leave() {
    const session = live.current;
    session?.stop?.abort();
    setTurns([]);
    setEarlier(null);
    setEarlierFailed(null);
    setOpenFailed(null);
    setBrowsing(false);
    setFocusTo("input");
    return session;
  }

  function newChat() {
    const session = leave();
    if (!session) return;
    // An ended session cannot carry on: a new one starts (a new anonymous visitor, or the host signs in again).
    if (ended) session.api = gateway(widgetId, () => (session.signedIn ? session.bridge.token() : Promise.resolve(null)));
    session.conversation = undefined;
    setCurrent(null);
    setOpening(null);
    setEnded(null);
  }

  async function openChat(chat: Conversation) {
    const session = leave();
    if (!session) return;
    session.conversation = chat.id;
    lastOpened.current = chat;
    setCurrent(chat.id);
    setOpening(chat);
    follow.current = true;
    try {
      const page = await session.api.messages(chat.id);
      if (session.conversation !== chat.id) return; // the visitor moved on meanwhile
      const shown = turnsOf(page.messages);
      setTurns(shown);
      setEarlier(page.next);
      setHeard(t.opened(chat.title ?? ""));
      const last = shown[shown.length - 1];
      const writing = last?.answer.status === "streaming" && last.answer.id;
      if (last && writing) {
        void track(session, last.key, (signal) =>
          recover(session.api, chat.id, writing, signal, last.answer, (next) =>
            change(last.key, (turn) => ({ ...turn, answer: next })),
          ),
        );
      }
    } catch (error) {
      if (session.conversation === chat.id) setOpenFailed(problemOf(error));
    } finally {
      if (session.conversation === chat.id) setOpening(null);
    }
  }

  async function showEarlier() {
    const session = live.current;
    const id = session?.conversation;
    if (!session || !id || !earlier) return;
    setEarlierFailed(null);
    try {
      const page = await session.api.messages(id, earlier);
      if (session.conversation !== id) return;
      const box = log.current;
      keep.current = box ? box.scrollHeight - box.scrollTop : null;
      setTurns((all) => [...turnsOf(page.messages), ...all]);
      setEarlier(page.next);
    } catch (error) {
      setEarlierFailed(problemOf(error));
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
  const list = (
    <ChatList
      chats={chats}
      current={current}
      titleRef={listTitle}
      onOpen={(chat) => void openChat(chat)}
      onNew={newChat}
      onMore={() => void loadChats(chats.next ?? undefined)}
      onRetry={() => void loadChats()}
    />
  );
  const classes = ["chat", side && "split", paused && "paused"].filter(Boolean).join(" ");
  return (
    <div className={classes} style={theme}>
      <header className="head">
        <span className="logo" aria-hidden="true">
          {settings.logo && !logoFailed ? (
            <img src={settings.logo} alt="" onError={() => setLogoFailed(true)} />
          ) : (
            initials(settings.title)
          )}
        </span>
        <h1>{settings.title}</h1>
        <div className="actions">
          {!side && !browsing && (turns.length > 0 || current) && (
            <button type="button" className="icon new" aria-label={t.startChat} onClick={newChat}>
              <Icon path={PLUS} />
            </button>
          )}
          {history && !side && (
            <button
              type="button"
              className="icon"
              ref={chatsButton}
              aria-label={browsing ? t.back : t.chats}
              aria-expanded={browsing}
              aria-controls="chats"
              onClick={browsing ? hideChats : showChats}
            >
              {browsing ? <Icon path={BACK} flip /> : <Icon path={LIST} />}
            </button>
          )}
          {mode === "floating" && (
            <button type="button" className="icon" aria-label={t.close} onClick={() => live.current?.bridge.close()}>
              <Icon path="M6 6l12 12M18 6 6 18" />
            </button>
          )}
        </div>
      </header>

      {side && list}

      {browsing ? (
        <main className="log">{list}</main>
      ) : (
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
        {opening && turns.length === 0 && <div className="ring" role="status" aria-label={t.opening} />}
        {openFailed && lastOpened.current && (
          <ProblemNote problem={openFailed} action={t.retry} onAction={() => void openChat(lastOpened.current!)} />
        )}
        {earlier &&
          (earlierFailed ? (
            <ProblemNote problem={earlierFailed} action={t.retry} onAction={() => void showEarlier()} />
          ) : (
            <button type="button" className="quiet earlier" onClick={() => void showEarlier()}>
              {t.earlier}
            </button>
          ))}
        {turns.map((turn) => (
          <TurnView
            key={turn.key}
            turn={turn}
            onRetry={ended || !turn.question ? undefined : () => void ask(turn.question, turn.key)}
          />
        ))}
        {ended && <ProblemNote problem={ended} action={ended.kind === "expired" ? t.newChat : undefined} onAction={newChat} />}
      </main>
      )}

      <footer className="foot">
        {away && !browsing && (
          <button
            type="button"
            className="latest"
            onClick={() => log.current?.scrollTo({ top: log.current.scrollHeight })}
          >
            <Icon path="M12 5v14M6 13l6 6 6-6" />
            {t.latest}
          </button>
        )}

        {!browsing && (
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
        )}
        {left <= LIMIT - WARN_AT && !browsing && (
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
  onRetry,
}: {
  turn: Turn;
  onRetry?: () => void;
}) {
  const { answer, problem } = turn;
  const working = answer.status === "pending" || (answer.status === "streaming" && !plain(answer.blocks));
  return (
    <div className="turn">
      {turn.question && (
        <p className="mine" dir="auto">
          <span className="hidden">{t.you} </span>
          {turn.question}
        </p>
      )}
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
          <CopyButton text={plain(answer.blocks)} label={t.copy} />
        )}
      </article>
    </div>
  );
}

/** The visitor's earlier chats: beside the conversation on wide frames, in its place on narrow ones. */
function ChatList({
  chats,
  current,
  titleRef,
  onOpen,
  onNew,
  onMore,
  onRetry,
}: {
  chats: Chats;
  current: string | null;
  titleRef: Ref<HTMLHeadingElement>;
  onOpen: (chat: Conversation) => void;
  onNew: () => void;
  onMore: () => void;
  onRetry: () => void;
}) {
  const items = chats.items.filter((chat) => chat.title); // a chat with no question yet has nothing to reopen
  return (
    <nav className="side" id="chats" aria-labelledby="chats-title">
      <div className="side-head">
        <h2 id="chats-title" ref={titleRef} tabIndex={-1}>
          {t.chats}
        </h2>
        <button type="button" className="secondary" onClick={onNew}>
          <Icon path={PLUS} />
          {t.startChat}
        </button>
      </div>
      {!chats.loaded && chats.loading && (
        <>
          <ul className="chats sketch" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <li key={row}>
                <span />
                <span />
              </li>
            ))}
          </ul>
          <p className="hidden" role="status">
            {t.loadingChats}
          </p>
        </>
      )}
      {chats.loaded && items.length === 0 && !chats.problem && <p className="meta empty">{t.noChats}</p>}
      {items.length > 0 && (
        <ul className="chats">
          {items.map((chat) => (
            <li key={chat.id}>
              <button type="button" aria-current={chat.id === current ? "true" : undefined} onClick={() => onOpen(chat)}>
                <span className="topic" dir="auto">
                  {chat.title}
                </span>
                <time dateTime={chat.updated_at}>{when(chat.updated_at)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
      {chats.problem && <ProblemNote problem={chats.problem} action={t.retry} onAction={chats.next && chats.loaded ? onMore : onRetry} />}
      {chats.next && !chats.problem && (
        <button type="button" className="quiet more" onClick={onMore} disabled={chats.loading}>
          {t.olderChats}
        </button>
      )}
    </nav>
  );
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
