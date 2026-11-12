// The embed loader. It runs on the customer's page, so it must stay tiny and must never throw into that page.
// It stores nothing on the visitor's device and adds exactly one global, `UCP`.
import { fromChat } from "@ucp/protocol/bridge";
import type { WidgetConfig } from "@ucp/protocol/v1";

export const VERSION = "0.1.0";

const WIDGET_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INK = "#2b241f"; // the world's ink; also the launcher colour when a configuration has no valid brand colour

function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The display settings the loader uses, each checked: a bad value falls back to a default, never into the page. */
export function settings(config: Partial<WidgetConfig>) {
  const title = typeof config.title === "string" ? config.title.trim().slice(0, 80) : "";
  const color =
    typeof config.brand_color === "string" && /^#[0-9a-f]{6}$/i.test(config.brand_color) ? config.brand_color : INK;
  return {
    title: title || "Chat",
    color,
    // Whichever of white or black stands out more on the brand colour, so no brand can make the icon unreadable.
    ink: contrast(color, "#ffffff") >= contrast(color, "#000000") ? "#ffffff" : "#000000",
    left: config.launcher_position === "bottom-left",
  };
}

/** On a narrow or short window (a phone, a landscape phone, 200% zoom) the open chat takes the whole screen. */
export const fullScreen = (width: number, height: number) => width < 600 || height < 520;

const EDGE = "max(24px,env(safe-area-inset-bottom))";
const SIDE = (side: string) => `max(24px,env(safe-area-inset-${side}))`;
const EASE = "cubic-bezier(.16,1,.3,1)";
const CSS = `
:host{all:initial;display:block}
.launcher{all:unset;box-sizing:border-box;position:fixed;z-index:2147483647;bottom:${EDGE};right:${SIDE("right")};
width:56px;height:56px;border-radius:50%;display:grid;place-items:center;cursor:pointer;
background:var(--brand);color:var(--ink);box-shadow:0 10px 24px -10px rgba(43,36,31,.55),0 2px 6px -2px rgba(43,36,31,.3);
transition:transform .4s cubic-bezier(.34,1.56,.64,1),box-shadow .2s ${EASE}}
@media (hover:hover){.launcher:hover{transform:translateY(-2px);box-shadow:0 14px 30px -10px rgba(43,36,31,.6),0 3px 8px -2px rgba(43,36,31,.32)}}
.launcher:active{transform:scale(.92);transition:transform .08s ease-out}
.launcher:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 7px ${INK}}
.launcher svg{width:26px;height:26px}
.launcher .x,.open .launcher .chat{display:none}
.open .launcher .x{display:block}
.panel{box-sizing:border-box;position:fixed;z-index:2147483646;right:${SIDE("right")};bottom:calc(${EDGE} + 72px);
width:min(400px,calc(100vw - 48px));height:min(640px,calc(100vh - 120px));height:min(640px,calc(100dvh - 120px));
border-radius:24px;overflow:hidden;background:#fbf3ea;border:1px solid #e7dacb;
box-shadow:0 24px 60px -24px rgba(43,36,31,.45),0 8px 20px -12px rgba(43,36,31,.25);
visibility:hidden;opacity:0;transform:translateY(12px);
transition:opacity .2s ${EASE},transform .2s ${EASE},visibility 0s .2s}
.open .panel{visibility:visible;opacity:1;transform:none;transition-delay:0s}
/* a quiet loading mark until the chat page has loaded */
.panel::before{content:"";position:absolute;inset:0;margin:auto;width:28px;height:28px;box-sizing:border-box;
border-radius:50%;border:3px solid #e7dacb;border-top-color:#6f625a}
/* it spins only while the chat is open: a closed widget runs nothing on the host page */
.open .panel::before{animation:spin .9s linear infinite}
.ready::before{display:none}
@keyframes spin{to{transform:rotate(1turn)}}
.left .launcher,.left .panel{right:auto;left:${SIDE("left")}}
iframe{display:block;width:100%;height:100%;border:0;color-scheme:normal}
.inline{height:100%}
.inline .panel{position:relative;inset:auto;width:100%;height:100%;min-height:480px;
visibility:visible;opacity:1;transform:none;box-shadow:none}
@media (max-width:599.98px),(max-height:519.98px){.w:not(.inline) .panel{inset:0;width:100%;height:100%;border:0;border-radius:0}
.open .launcher{display:none}}
@media (prefers-reduced-motion:reduce){.launcher,.launcher:hover,.launcher:active,.panel{transform:none;transition:opacity .2s,visibility 0s .2s}
.open .panel::before{animation:none}}
@media (forced-colors:active){.launcher{border:2px solid ButtonText}.panel{border:1px solid CanvasText}}`;
const ICON = (name: string, path: string) =>
  `<svg class="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
const ICONS =
  ICON("chat", "M20 11.5a7.5 7.5 0 0 1-11.1 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5z") + ICON("x", "M6 6l12 12M18 6 6 18");

export type MountOptions = {
  widgetId: string;
  /** A CSS selector. The chat is placed inside that element instead of behind a floating launcher. */
  target?: string;
  /** Returns a token signed by the host for its signed-in user. */
  getToken?: () => string | Promise<string>;
  /** Prints the set-up checklist to the console. */
  debug?: boolean;
};
type Command = "mount" | "unmount" | "open" | "close" | "toggle";
type Api = ((command: Command, options?: MountOptions) => void) & { q?: ArrayLike<unknown>[]; loaded?: boolean };
type Widget = { unmount(): void; show(open?: boolean): void };

function mount(origin: string, options: MountOptions, win: Window): Widget | undefined {
  const say = (line: string) => options.debug && console.info(`UCP: ${line}`);
  const { widgetId, target } = options;
  if (typeof widgetId !== "string" || !WIDGET_ID.test(widgetId)) {
    say(`✗ "${String(widgetId)}" is not a widget ID`);
    return undefined;
  }
  const doc = win.document;
  const inline = typeof target === "string";
  let host: HTMLElement | undefined;
  let gone = false;
  let open = inline;
  let draw: (() => void) | undefined;
  let overflow: string | undefined; // the host page's own scroll setting while a full-screen chat locks it
  let stop = () => {}; // removes the listener render() adds to the host page's window
  const release = () => {
    if (overflow !== undefined) doc.documentElement.style.overflow = overflow;
    overflow = undefined;
  };

  function render(config: Partial<WidgetConfig>) {
    let place: Element | null = doc.body;
    try {
      if (inline) place = doc.querySelector(target as string);
    } catch {
      place = null;
    }
    if (!place) return say(`✗ no element on the page matches "${target}"`);
    const { title, color, ink, left } = settings(config);
    host = doc.createElement("div");
    host.setAttribute("data-ucp", "");
    if (inline) host.style.height = "100%";
    const root = host.attachShadow({ mode: "open" });
    // Only checked colours are written into markup; the title is set as an attribute, never as HTML.
    root.innerHTML =
      `<style>${CSS}</style><div class="w${left ? " left" : ""}${inline ? " inline" : ""}" ` +
      `style="--brand:${color};--ink:${ink}"><div class="panel"></div>` +
      (inline ? "" : `<button class="launcher" type="button" aria-expanded="false">${ICONS}</button>`) +
      `</div>`;
    const frame = root.firstElementChild?.nextElementSibling as HTMLElement;
    const panel = frame.firstElementChild as HTMLElement;
    const button = root.querySelector("button");
    button?.setAttribute("aria-label", title);
    let iframe: HTMLIFrameElement | undefined;
    draw = () => {
      if (open && !iframe) {
        iframe = doc.createElement("iframe");
        iframe.src = `${origin}/embed/${widgetId}`;
        iframe.title = title;
        iframe.allow = "clipboard-write";
        iframe.addEventListener("load", () => panel.classList.add("ready"));
        panel.appendChild(iframe);
      }
      frame.classList.toggle("open", open);
      button?.setAttribute("aria-expanded", String(open));
      // shortcut: the scroll lock is decided on opening, so a window resized narrow while open stays unlocked;
      // add a resize listener if real devices show page scroll behind the full-screen chat.
      if (open && !inline && fullScreen(win.innerWidth, win.innerHeight) && overflow === undefined) {
        overflow = doc.documentElement.style.overflow;
        doc.documentElement.style.overflow = "hidden";
      }
      if (!open) release();
      if (open && !inline) iframe?.focus();
      // Focus goes back to the launcher only if it was inside the chat, never taken from elsewhere on the page.
      else if (!open && doc.activeElement === host) button?.focus();
    };
    button?.addEventListener("click", () => show(!open));
    root.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && open && !inline) show(false);
    });
    // The chat asks to close (its close button, or Escape inside it). Only our own iframe, from our origin, is heard.
    const listen = (event: MessageEvent) => {
      if (event.source === iframe?.contentWindow && event.origin === origin && fromChat(event.data)?.type === "close") {
        show(false);
      }
    };
    win.addEventListener("message", listen);
    stop = () => win.removeEventListener("message", listen);
    place.appendChild(host);
    if (open) draw();
    say("✓ configuration loaded");
  }

  function show(next = !open) {
    if (inline || next === open) return;
    open = next;
    draw?.();
  }

  const url = `${origin}/v1/widgets/${widgetId}/config`;
  win
    .fetch(url, { credentials: "omit" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<Partial<WidgetConfig>>;
    })
    .then((config) => gone || render(config))
    .catch((error: Error) => say(`✗ configuration not loaded from ${url} (${error.message})`));
  return {
    show,
    unmount() {
      gone = true;
      release();
      stop();
      host?.remove();
    },
  };
}

export function start(script: HTMLScriptElement | null, win: Window & { UCP?: unknown }): void {
  try {
    const existing = win.UCP as Api | undefined;
    // The page already uses the name for something else, or this is a second copy of the loader: leave it be.
    if ((existing !== undefined && typeof existing !== "function") || existing?.loaded || !script?.src) return;
    const origin = new URL(script.src).origin;
    const debug = script.hasAttribute("data-debug");
    let current: Widget | undefined;
    const api: Api = (command, options) => {
      try {
        if (command === "mount" && options && !current) {
          current = mount(origin, { ...options, debug: options.debug || debug }, win);
        }
        if (command === "unmount") {
          current?.unmount();
          current = undefined;
        }
        if (command === "open" || command === "close") current?.show(command === "open");
        if (command === "toggle") current?.show();
      } catch {
        // Nothing may reach the host page.
      }
    };
    api.loaded = true;
    const queued = Array.from(existing?.q ?? [], (args) => Array.from(args) as Parameters<Api>);
    win.UCP = api;
    const widgetId = script.getAttribute("data-widget-id");
    if (widgetId && !queued.some(([command]) => command === "mount")) {
      api("mount", { widgetId, target: script.getAttribute("data-target") ?? undefined });
    }
    for (const args of queued) api(...args);
  } catch {
    // Nothing may reach the host page.
  }
}
