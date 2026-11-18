// The chat inside the panel (M2), in the world of DESIGN.md and the composition the user picked
// (web/widget/.impeccable/surfaces/src-app-tsx.md).
import { contrast, inkOn, isColor } from "@ucp/protocol/brand";
import type { Block, Conversation, Pin, Project, WidgetConfig } from "@ucp/protocol/v1";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ACCEPT, CLIP, type FileBlock, isPicture, type Pending, PendingChip, refusal, SentChip } from "./Attachments";
import { type Api, Failure, gateway } from "./chat/api";
import { type Bridge, connect, type Mode } from "./chat/bridge";
import { type Turn, turnsOf } from "./chat/history";
import { type Problem, problemOf } from "./chat/problem";
import { type Answer, pending, textOf } from "./chat/state";
import { recover, runTurn } from "./chat/turn";
import { Feedback, type Rate } from "./Feedback";
import { CopyButton, Icon } from "./Icon";
import { PIN, PinButton, PinnedPage } from "./Pinned";
import { ChatRows, FOLDER, ProjectPage, ProjectPicker, ProjectsPage } from "./Projects";
import { BlockView } from "./render/registry";
import { strings as t } from "./strings";

const LIMIT = 4000;
const WARN_AT = 3600; // the character count appears only near the limit
const INK = "#1f1e1d";

/** The brand on the dark composer: a colour under 3:1 against it (WCAG's line for a control) gives way to the light
 *  ink, so the send button always stands out. */
export const forDark = (color: string) => (contrast(color, "#30302e") >= 3 ? color : "#f5f4ef");

type Settings = {
  title: string;
  color: string;
  logo: string | null;
  picture: string | null;
  welcome: string | null;
  prompts: string[];
  notice: string;
  history: boolean;
  attachments: boolean;
};
/** `project`: where the next new chat is filed, when it is started from a project's page. */
type Live = {
  api: Api;
  bridge: Bridge;
  signedIn: boolean;
  conversation?: string;
  starting?: Promise<string>; // the chat being started on the gateway, shared by everyone who needs it meanwhile
  project?: string;
  stop?: AbortController;
};
type Chats = { items: Conversation[]; next: string | null; loading: boolean; loaded: boolean; problem: Problem | null };
/** What the conversation's place holds: the chat, or (signed in) the projects, or one project. */
type View = { kind: "chat" } | { kind: "projects" } | { kind: "project"; project: Project } | { kind: "pinned" };
const CHAT: View = { kind: "chat" };

const NO_CHATS: Chats = { items: [], next: null, loading: false, loaded: false, problem: null };
const WIDE = "(min-width: 720px)"; // room for the list of chats beside the conversation
const LIST = "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01";
const PLUS = "M12 5v14M5 12h14";
const BACK = "M15 18l-6-6 6-6";
const GROW = "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7";
const SHRINK = "M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7";

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Every display setting checked, as the loader does: a bad value falls back, never reaches the page. */
export function readConfig(config: Partial<WidgetConfig>): Settings {
  const prompts = Array.isArray(config.suggested_prompts) ? config.suggested_prompts : [];
  return {
    title: text(config.title, 80) || "Chat",
    color: isColor(config.brand_color) ? config.brand_color : INK,
    logo: typeof config.logo_url === "string" && /^https:\/\/[!-~]+$/.test(config.logo_url) ? config.logo_url : null,
    // The assistant's picture, uploaded through the admin API and served on this address by its SHA-256.
    picture: typeof config.avatar === "string" && /^[0-9a-f]{64}$/.test(config.avatar) ? `/v1/images/${config.avatar}` : null,
    welcome: text(config.welcome_message, 1000) || null,
    prompts: prompts.map((prompt) => text(prompt, 200)).filter(Boolean).slice(0, 4),
    notice: text(config.ai_notice, 500) || t.notice,
    history: config.history_enabled === true,
    attachments: config.attachments_enabled === true,
  };
}

export const plain = (blocks: Block[]) =>
  blocks.map(textOf).filter(Boolean).join("\n\n");

const initials = (title: string) =>
  title
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

const newKey = () => `cm_${crypto.randomUUID()}`;

/** `preview`: the admin console's live preview (M9-T3). The settings come by message from the console that framed
 *  this page, on the same address only; nothing is fetched and nothing can be sent. */
export function App({ widgetId, win = window, preview = false }: { widgetId: string; win?: Window; preview?: boolean }) {
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
  const [paused, setPaused] = useState(false); // the panel is closed: nothing animates (DESIGN.md)
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLElement>(null);
  const live = useRef<Live>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [expandable, setExpandable] = useState(false); // the loader can fill the window with this chat
  const [expanded, setExpanded] = useState(false);
  const [wide, setWide] = useState(() => Boolean(win.matchMedia?.(WIDE).matches));
  const [browsing, setBrowsing] = useState(false); // the list of chats covers the conversation (narrow frames)
  const [chats, setChats] = useState<Chats>(NO_CHATS);
  const [current, setCurrent] = useState<string | null>(null); // the chat on screen, once it has a question
  const [opening, setOpening] = useState<Conversation | null>(null);
  const [openFailed, setOpenFailed] = useState<Problem | null>(null);
  const [earlier, setEarlier] = useState<string | null>(null); // where the chat on screen continues further back
  const [earlierFailed, setEarlierFailed] = useState<Problem | null>(null);
  const [focusTo, setFocusTo] = useState<"input" | "chats" | "list" | "view" | null>(null);
  const keep = useRef<number | null>(null); // distance from the end to hold while earlier messages go in above
  const chatsButton = useRef<HTMLButtonElement>(null);
  const listTitle = useRef<HTMLHeadingElement>(null);
  const viewTitle = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<View>(CHAT);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsFailed, setProjectsFailed] = useState(false);
  const [projectChats, setProjectChats] = useState<Conversation[] | null>(null);
  const [projectChatsFailed, setProjectChatsFailed] = useState(false);
  const [filed, setFiled] = useState<string | null>(null); // the project the chat on screen is filed under
  const [pins, setPins] = useState<Pin[] | null>(null);
  const [pinsFailed, setPinsFailed] = useState(false);
  const [found, setFound] = useState<string | null>(null); // a pinned answer just opened: shown and focused once
  const [attached, setAttached] = useState<Pending[]>([]); // files in the composer, for the next question
  const [attachNote, setAttachNote] = useState<string | null>(null); // why the last file could not be attached
  const [dropping, setDropping] = useState(false); // files are being dragged over the chat
  const picker = useRef<HTMLInputElement>(null);
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
    if (preview) {
      const shown = (event: MessageEvent) => {
        const data = event.data as { ucp?: number; type?: string; config?: Partial<WidgetConfig>; scheme?: string } | null;
        if (event.source !== win.parent || event.origin !== win.location.origin || data?.ucp !== 1 || data.type !== "preview") return;
        win.document.documentElement.dataset.scheme = data.scheme === "dark" ? "dark" : "light";
        setSettings(readConfig(data.config ?? {}));
        setMode("inline");
      };
      win.addEventListener("message", shown);
      win.parent.postMessage({ ucp: 1, type: "preview-ready" }, win.location.origin);
      return () => win.removeEventListener("message", shown);
    }
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
      layout(canExpand, isExpanded) {
        setExpandable(canExpand);
        setExpanded(isExpanded);
      },
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

  // A signed-in visitor's projects: their names label the chat on screen and the filing control.
  useEffect(() => {
    if (history) void loadProjects();
  }, [history]);

  // Focus moves with the view, after it is drawn: to the list's heading, back to its button, to a page's heading, or
  // to the question box.
  useEffect(() => {
    if (!focusTo) return;
    ({ input, chats: chatsButton, list: listTitle, view: viewTitle })[focusTo].current?.focus();
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

  // A pinned answer just opened: brought into view and focused, after the rule above has followed the newest message.
  useLayoutEffect(() => {
    const answer = found && log.current?.querySelector<HTMLElement>(`[data-answer="${found}"]`);
    if (!answer) return;
    answer.scrollIntoView?.({ block: "start" }); // a long answer is read from its top
    answer.focus({ preventScroll: true });
  }, [found, turns]);

  useLayoutEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }, [draft, settings]);

  const busy = turns.some(({ answer }) => answer.status === "pending" || answer.status === "streaming");
  const uploading = attached.some((file) => !file.block && !file.problem);
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

  /** The chat on screen, started on the gateway first if it has no question yet (in its project, if it has one).
   *  Files chosen together all wait for the one start, so they land in the same chat. */
  function chatOf(session: Live): Promise<string> {
    if (session.conversation) return Promise.resolve(session.conversation);
    if (!session.starting) {
      const starting: Promise<string> = session.api.conversation(session.project).then((started) => {
        if (session.starting === starting) {
          // still the chat on screen: the visitor has not moved on meanwhile
          session.conversation = started.id;
          setCurrent(started.id);
          setFiled(started.project_id ?? null);
        }
        return started.id;
      });
      session.starting = starting;
      void starting.catch(() => {}).finally(() => {
        if (session.starting === starting) session.starting = undefined; // a failed start is tried again next time
      });
    }
    return session.starting;
  }

  async function ask(question: string, replacing?: string, files: FileBlock[] = []) {
    const session = live.current;
    if (!session || ended) return;
    const key = newKey();
    follow.current = true;
    setTurns((all) => [
      ...all.filter((turn) => turn.key !== replacing),
      { key, question, ...(files.length ? { files } : {}), answer: pending(), problem: null },
    ]);
    await track(session, key, async (signal) => {
      const conversation = await chatOf(session);
      if (signal.aborted) throw new DOMException("The visitor moved on", "AbortError");
      const ids = files.map((file) => file.id);
      return runTurn(session.api, conversation, question, key, signal, (next) => change(key, (turn) => ({ ...turn, answer: next })), ids);
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
    if (session) session.starting = undefined; // a chat still starting is not this one any more
    setTurns([]);
    setEarlier(null);
    setEarlierFailed(null);
    setOpenFailed(null);
    setBrowsing(false);
    setView(CHAT);
    setFound(null);
    setAttached([]); // they were uploaded to the chat being left
    setAttachNote(null);
    setFocusTo("input");
    return session;
  }

  /** A fresh chat; started from a project's page, it is filed there. */
  function newChat(project?: string) {
    const session = leave();
    if (!session) return;
    // An ended session cannot carry on: a new one starts (a new anonymous visitor, or the host signs in again).
    if (ended) session.api = gateway(widgetId, () => (session.signedIn ? session.bridge.token() : Promise.resolve(null)));
    session.conversation = undefined;
    session.project = project;
    setFiled(project ?? null);
    setCurrent(null);
    setOpening(null);
    setEnded(null);
  }

  /** Opens an earlier chat at its newest page; `reveal` names an answer to show (a pin), reached through earlier
   *  pages if need be. */
  async function openChat(chat: Conversation, reveal?: string) {
    const session = leave();
    if (!session) return;
    session.conversation = chat.id;
    session.project = undefined;
    lastOpened.current = chat;
    setCurrent(chat.id);
    setFiled(chat.project_id ?? null);
    setOpening(chat);
    follow.current = true;
    try {
      const page = await session.api.messages(chat.id);
      let shown = turnsOf(page.messages);
      let next = page.next;
      // shortcut: at most 20 pages back (400 messages); a jump by message would replace this for longer chats
      for (let pages = 0; reveal && next && pages < 20 && !shown.some(({ answer }) => answer.id === reveal); pages++) {
        const older = await session.api.messages(chat.id, next);
        shown = [...turnsOf(older.messages), ...shown];
        next = older.next;
      }
      if (session.conversation !== chat.id) return; // the visitor moved on meanwhile
      setTurns(shown);
      setEarlier(next);
      setFound(reveal ?? null);
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

  /** Rating one of the answers in the chat on screen. */
  const rater =
    (messageId: string): Rate =>
    async (rating, comment) => {
      const session = live.current;
      if (!session?.conversation) throw new Failure(0, null);
      await session.api.rate(session.conversation, messageId, rating && { rating, comment: comment || null });
    };

  // Projects (signed-in visitors). Each change updates what is on screen from the gateway's reply.

  async function loadProjects() {
    const session = live.current;
    if (!session) return;
    setProjectsFailed(false);
    try {
      setProjects(await session.api.projects());
    } catch {
      setProjectsFailed(true);
    }
  }

  function showProjects() {
    setBrowsing(false);
    setView({ kind: "projects" });
    setFocusTo("view");
    void loadProjects();
  }

  // Pinned answers (signed-in visitors)

  async function showPinned() {
    const session = live.current;
    if (!session) return;
    setBrowsing(false);
    setView({ kind: "pinned" });
    setFocusTo("view");
    setPinsFailed(false);
    try {
      setPins(await session.api.pins());
    } catch {
      setPinsFailed(true);
    }
  }

  async function unpinFromPage(pin: Pin) {
    await live.current!.api.pin(pin.conversation.id, pin.message.id, false);
    setPins((all) => all?.filter((each) => each.message.id !== pin.message.id) ?? null);
    setHeard(t.unpinnedNow);
  }

  /** A file sent with a question in the chat on screen. */
  const fetchFile = async (id: string) => {
    const session = live.current;
    if (!session?.conversation) throw new Failure(0, null);
    return session.api.download(session.conversation, id);
  };

  /** Pinning one of the answers in the chat on screen. */
  const pinner = (messageId: string) => async (pinned: boolean) => {
    const session = live.current;
    if (!session?.conversation) throw new Failure(0, null);
    await session.api.pin(session.conversation, messageId, pinned);
  };

  async function openProject(project: Project) {
    const session = live.current;
    if (!session) return;
    setBrowsing(false);
    setView({ kind: "project", project });
    setFocusTo("view");
    setProjectChats(null);
    setProjectChatsFailed(false);
    try {
      const found = await session.api.projectChats(project.id);
      setProjectChats(found.filter((chat) => chat.title)); // a chat with no question yet has nothing to reopen
    } catch {
      setProjectChatsFailed(true);
    }
  }

  async function createProject(name: string) {
    const project = await live.current!.api.createProject(name);
    setProjects((all) => [project, ...(all ?? [])]);
    return project;
  }

  async function renameProject(project: Project, name: string) {
    const renamed = await live.current!.api.renameProject(project.id, name);
    setProjects((all) => all?.map((each) => (each.id === renamed.id ? renamed : each)) ?? null);
    setView({ kind: "project", project: renamed });
    setFocusTo("view");
  }

  async function deleteProject(project: Project) {
    await live.current!.api.deleteProject(project.id);
    setProjects((all) => all?.filter((each) => each.id !== project.id) ?? null);
    if (filed === project.id) setFiled(null);
    showProjects();
  }

  /** Files the chat on screen under a project, or under none. */
  async function fileChat(projectId: string | null) {
    const session = live.current;
    if (!session?.conversation) throw new Failure(0, null);
    const moved = await session.api.file(session.conversation, projectId);
    setFiled(moved.project_id ?? null);
    setHeard(projectId ? t.filed(projects?.find((each) => each.id === projectId)?.name ?? "") : t.unfiled);
  }

  // Attachments (M10): uploaded as soon as they are chosen, into the chat on screen, then sent with the question.

  const changeFile = (key: string, next: Partial<Pending>) =>
    setAttached((all) => all.map((file) => (file.key === key ? { ...file, ...next } : file)));

  async function attach(chosen: File[]) {
    const session = live.current;
    if (!session || ended || !chosen.length) return;
    setAttachNote(null);
    let count = attached.filter((file) => !file.problem).length;
    for (const file of chosen) {
      const refused = refusal(file, count);
      if (refused) {
        setAttachNote(refused);
        continue;
      }
      count += 1;
      const key = newKey();
      const picture = isPicture(file.name) ? URL.createObjectURL(file) : null;
      const shown: Pending = { key, name: file.name, size: file.size, picture, progress: 0, block: null, problem: null };
      setAttached((all) => [...all, shown]);
      void (async () => {
        try {
          const conversation = await chatOf(session);
          const block = await session.api.upload(conversation, file, (progress) => changeFile(key, { progress }));
          changeFile(key, { block, progress: 1 });
        } catch (error) {
          const refusedThere = error instanceof Failure && error.error?.code === "invalid_request";
          const note = refusedThere ? t.fileRefused(file.name) : t.problems[problemOf(error).kind];
          changeFile(key, { problem: note });
          setAttachNote(note);
        }
      })();
    }
  }

  function removeFile(key: string) {
    setAttached((all) => all.filter((file) => file.key !== key));
    setAttachNote(null);
    setFocusTo("input");
  }

  function send() {
    const question = draft.trim();
    if (!question || busy || uploading) return;
    setDraft("");
    const files = attached.flatMap((file) => (file.block ? [file.block] : []));
    setAttached([]);
    setAttachNote(null);
    if (view.kind === "project") newChat(view.project.id); // asked on a project's page: a new chat filed there
    void ask(question, undefined, files);
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

  const dark = forDark(settings.color);
  const theme = {
    "--brand": `light-dark(${settings.color}, ${dark})`,
    "--on-brand": `light-dark(${inkOn(settings.color)}, ${inkOn(dark)})`,
  } as CSSProperties;
  const left = LIMIT - draft.length;
  const list = (
    <ChatList
      chats={chats}
      current={current}
      titleRef={listTitle}
      onOpen={(chat) => void openChat(chat)}
      onNew={() => newChat()}
      onProjects={showProjects}
      onPinned={() => void showPinned()}
      place={view.kind}
      onMore={() => void loadChats(chats.next ?? undefined)}
      onRetry={() => void loadChats()}
    />
  );
  // A wide frame (the chat filling a page, or the window) is laid out as a conversation app; an empty chat there
  // holds its welcome, composer and suggested questions in the middle of the screen.
  const chatting = view.kind === "chat";
  const empty = chatting && turns.length === 0 && !opening && !openFailed && !browsing;
  const classes = ["chat", side && "split", wide && "page", empty && "empty", paused && "paused"]
    .filter(Boolean)
    .join(" ");
  const mark = <Mark settings={settings} />;
  const prompts = turns.length === 0 && settings.prompts.length > 0 && (
    <ul className="prompts">
      {settings.prompts.map((prompt) => (
        <li key={prompt}>
          <button type="button" onClick={() => void ask(prompt)} disabled={Boolean(ended) || preview}>
            {prompt}
          </button>
        </li>
      ))}
    </ul>
  );
  const attaching = settings.attachments && chatting && !browsing && !ended;
  const carriesFiles = (event: DragEvent) => attaching && !preview && event.dataTransfer.types.includes("Files");
  return (
    <div
      className={classes}
      style={theme}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault(); // the browser would otherwise open the file in place of the chat
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDropping(false);
        void attach([...event.dataTransfer.files]);
      }}
    >
      <header className="head">
        {mark}
        <h1>{settings.title}</h1>
        <div className="actions">
          {!side && !browsing && (turns.length > 0 || current || !chatting) && (
            <button type="button" className="icon new" aria-label={t.startChat} onClick={() => newChat()}>
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
          {mode === "floating" && expandable && (
            <button
              type="button"
              className="icon"
              aria-label={expanded ? t.shrink : t.expand}
              onClick={() => live.current?.bridge.expand(!expanded)}
            >
              <Icon path={expanded ? SHRINK : GROW} />
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
      ) : view.kind === "pinned" ? (
        <main className="log">
          <PinnedPage
            pins={pins}
            failed={pinsFailed}
            titleRef={viewTitle}
            onOpen={(pin) => void openChat(pin.conversation, pin.message.id)}
            onUnpin={unpinFromPage}
            onRetry={() => void showPinned()}
          />
        </main>
      ) : view.kind === "projects" ? (
        <main className="log">
          <ProjectsPage
            projects={projects}
            failed={projectsFailed}
            titleRef={viewTitle}
            onOpen={(project) => void openProject(project)}
            onCreate={async (name) => void openProject(await createProject(name))}
            onRetry={() => void loadProjects()}
          />
        </main>
      ) : view.kind === "project" ? (
        <main className="log">
          <ProjectPage
            key={view.project.id}
            project={view.project}
            chats={projectChats}
            failed={projectChatsFailed}
            titleRef={viewTitle}
            onBack={showProjects}
            onOpenChat={(chat) => void openChat(chat)}
            onRename={(name) => renameProject(view.project, name)}
            onDelete={() => deleteProject(view.project)}
          />
        </main>
      ) : (
      <main
        className="log"
        ref={log}
        onScroll={(event) => {
          const box = event.currentTarget;
          setAway(box.scrollHeight - box.scrollTop - box.clientHeight >= 48);
        }}
      >
        {history && current && (
          <ProjectPicker
            projects={projects}
            filed={filed}
            onChoose={fileChat}
            onCreate={async (name) => fileChat((await createProject(name)).id)}
          />
        )}
        {(settings.welcome || empty) && (
          <div className="intro">
            {mark}
            <p className="welcome" dir="auto">
              {settings.welcome ?? settings.title}
            </p>
          </div>
        )}
        {!(wide && empty) && prompts}
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
            mark={mark}
            onRetry={ended || !turn.question ? undefined : () => void ask(turn.question, turn.key, turn.files)}
            rate={turn.answer.id ? rater(turn.answer.id) : undefined}
            pin={history && turn.answer.id ? pinner(turn.answer.id) : undefined}
            found={turn.answer.id !== null && turn.answer.id === found}
            say={setHeard}
            fetchFile={fetchFile}
          />
        ))}
        {ended && <ProblemNote problem={ended} action={ended.kind === "expired" ? t.newChat : undefined} onAction={() => newChat()} />}
      </main>
      )}

      <footer className="foot">
        {away && !browsing && chatting && (
          <button
            type="button"
            className="latest"
            aria-label={t.latest}
            onClick={() => log.current?.scrollTo({ top: log.current.scrollHeight })}
          >
            <Icon path="M12 5v14M6 13l6 6 6-6" />
          </button>
        )}

        {attachNote && (
          <p className="attach-note" role="alert">
            {attachNote}
          </p>
        )}
        {!browsing && (chatting || view.kind === "project") && (
        <form
          className={dropping ? "compose dropping" : "compose"}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) live.current?.stop?.abort();
            else send();
          }}
        >
          {attached.length > 0 && (
            <ul className="files" aria-label={t.attached(attached.length)}>
              {attached.map((file) => (
                <PendingChip key={file.key} file={file} onRemove={() => removeFile(file.key)} />
              ))}
            </ul>
          )}
          {attaching && (
            <>
              <input
                ref={picker}
                type="file"
                className="hidden"
                tabIndex={-1}
                aria-hidden="true"
                accept={ACCEPT}
                multiple
                onChange={(event) => {
                  void attach([...(event.target.files ?? [])]);
                  event.target.value = ""; // the same file can be chosen again
                }}
              />
              <button
                type="button"
                className="clip"
                aria-label={t.attach}
                disabled={preview}
                onClick={() => picker.current?.click()}
              >
                <Icon path={CLIP} />
              </button>
            </>
          )}
          <label className="hidden" htmlFor="question">
            {t.input}
          </label>
          <textarea
            id="question"
            ref={input}
            rows={1}
            value={draft}
            maxLength={LIMIT}
            placeholder={
              preview ? t.previewPlaceholder : view.kind === "project" ? t.askInProject(view.project.name) : t.placeholder
            }
            aria-describedby={left <= LIMIT - WARN_AT ? "left" : undefined}
            disabled={Boolean(ended) || preview}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={enter}
            onPaste={(event) => {
              const pasted = [...event.clipboardData.files];
              if (!attaching || !pasted.length) return;
              event.preventDefault();
              void attach(pasted);
            }}
          />
          <button
            type="submit"
            className="send"
            aria-label={busy ? t.stop : t.send}
            disabled={!busy && (!draft.trim() || Boolean(ended) || uploading)}
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
        {wide && empty && prompts}
        <p className="notice">{settings.notice}</p>
        <p className="credit">{t.credit}</p>
        <div className="hidden" role="status" aria-live="polite">
          {heard}
        </div>
      </footer>
    </div>
  );
}

/** Who answers: the assistant's picture, else the customer's logo, else the title's initials. An
 *  image that cannot load gives way to the next. */
function Mark({ settings }: { settings: Settings }) {
  const [failed, setFailed] = useState<string[]>([]);
  const source = [settings.picture, settings.logo].find((url) => url && !failed.includes(url));
  return (
    <span className={source && source === settings.logo ? "mark logo" : "mark"} aria-hidden="true">
      {source ? <img src={source} alt="" onError={() => setFailed([...failed, source])} /> : initials(settings.title)}
    </span>
  );
}

function TurnView({
  turn,
  mark,
  onRetry,
  rate,
  pin,
  found,
  say,
  fetchFile,
}: {
  turn: Turn;
  mark: ReactNode;
  onRetry?: () => void;
  rate?: Rate;
  pin?: (pinned: boolean) => Promise<void>;
  found: boolean;
  say: (text: string) => void;
  fetchFile: (id: string) => Promise<Blob>;
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
      {turn.files && (
        <ul className="files sent" aria-label={t.attached(turn.files.length)}>
          {turn.files.map((file) => (
            <SentChip key={file.id} block={file} fetchFile={fetchFile} />
          ))}
        </ul>
      )}
      <article
        className={found ? "answer found" : "answer"}
        aria-busy={answer.status === "pending" || answer.status === "streaming"}
        data-answer={answer.id ?? undefined}
        tabIndex={found ? -1 : undefined}
      >
        {mark}
        <div className="said">
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
            <div className="acts">
              <CopyButton text={plain(answer.blocks)} label={t.copy} />
              {rate && <Feedback initial={answer.feedback} rate={rate} say={say} />}
              {pin && <PinButton pinned={answer.pinned} toggle={pin} say={say} />}
            </div>
          )}
        </div>
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
  onProjects,
  onPinned,
  place,
}: {
  chats: Chats;
  current: string | null;
  titleRef: Ref<HTMLHeadingElement>;
  onOpen: (chat: Conversation) => void;
  onNew: () => void;
  onMore: () => void;
  onRetry: () => void;
  onProjects: () => void;
  onPinned: () => void;
  place: View["kind"];
}) {
  const items = chats.items.filter((chat) => chat.title); // a chat with no question yet has nothing to reopen
  const projectsOpen = place === "projects" || place === "project";
  return (
    <nav className="side" id="chats" aria-labelledby="chats-title">
      <ul className="places">
        <li>
          <button type="button" aria-current={projectsOpen ? "page" : undefined} onClick={onProjects}>
            <Icon path={FOLDER} />
            {t.projects}
          </button>
        </li>
        <li>
          <button type="button" aria-current={place === "pinned" ? "page" : undefined} onClick={onPinned}>
            <Icon path={PIN} />
            {t.pinned}
          </button>
        </li>
      </ul>
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
      {items.length > 0 && <ChatRows chats={items} current={place === "chat" ? current : null} onOpen={onOpen} />}
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
