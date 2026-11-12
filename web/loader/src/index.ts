// The embed loader. It runs on the customer's page, so it must stay tiny and must never throw into that page.
// It stores nothing on the visitor's device and adds exactly one global, `UCP`.
import type { WidgetConfig } from "@ucp/protocol/v1";

export const VERSION = "0.1.0";

const WIDGET_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type MountOptions = {
  widgetId: string;
  /** A CSS selector. The chat is placed inside that element instead of behind a floating launcher. */
  target?: string;
  /** Returns a token signed by the host for its signed-in user. */
  getToken?: () => string | Promise<string>;
  /** Prints the set-up checklist to the console. */
  debug?: boolean;
};
type Command = "mount" | "unmount";
type Api = ((command: Command, options?: MountOptions) => void) & { q?: ArrayLike<unknown>[]; loaded?: boolean };
type Widget = { unmount(): void };

function mount(origin: string, options: MountOptions, win: Window): Widget | undefined {
  const say = (line: string) => options.debug && console.info(`UCP: ${line}`);
  const { widgetId } = options;
  if (typeof widgetId !== "string" || !WIDGET_ID.test(widgetId)) {
    say(`✗ "${String(widgetId)}" is not a widget ID`);
    return undefined;
  }
  let host: HTMLElement | undefined;
  let gone = false;
  const url = `${origin}/v1/widgets/${widgetId}/config`;
  win
    .fetch(url, { credentials: "omit" })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<WidgetConfig>;
    })
    .then(() => {
      if (gone) return;
      host = win.document.createElement("div");
      host.setAttribute("data-ucp", "");
      host.attachShadow({ mode: "open" });
      win.document.body.appendChild(host);
      say("✓ configuration loaded");
    })
    .catch((error: Error) => say(`✗ configuration not loaded from ${url} (${error.message})`));
  return {
    unmount() {
      gone = true;
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
