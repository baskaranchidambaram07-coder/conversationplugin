// The chat's half of the bridge (protocol/src/bridge.ts). It says ready to whoever framed it, then trusts only
// the origin that answers with init, and writes only to that origin.
import { type ChatMessage, fromLoader } from "@ucp/protocol/bridge";

export type Mode = "floating" | "inline" | "page";
export type Bridge = {
  /** A token signed by the host for its signed-in visitor, or null (anonymous, refused, or no answer in 10 s). */
  token(): Promise<string | null>;
  close(): void;
};

export type Events = {
  /** Once the loader answers, or at once as a full page when nothing framed the chat. */
  init(mode: Mode, signedIn: boolean): void;
  shown(): void;
  hidden(): void;
};

export function connect(win: Window, on: Events): Bridge {
  if (win.parent === win) {
    on.init("page", false);
    return { token: async () => null, close: () => {} };
  }
  let origin: string | undefined;
  let next = 1;
  const waiting = new Map<number, (token: string | null) => void>();
  const post = (message: ChatMessage) => origin && win.parent.postMessage(message, origin);
  win.addEventListener("message", (event) => {
    const message = event.source === win.parent ? fromLoader(event.data) : null;
    if (message?.type === "init" && origin === undefined) {
      origin = event.origin;
      on.init(message.mode, message.signedIn);
    }
    if (!message || event.origin !== origin) return;
    if (message.type === "token") {
      waiting.get(message.id)?.(message.token);
      waiting.delete(message.id);
    }
    if (message.type === "shown") on.shown();
    if (message.type === "hidden") on.hidden();
  });
  win.parent.postMessage({ ucp: 1, type: "ready" } satisfies ChatMessage, "*"); // carries nothing
  return {
    token: () =>
      new Promise((resolve) => {
        if (!origin) return resolve(null);
        const id = next++;
        waiting.set(id, resolve);
        post({ ucp: 1, type: "get-token", id });
        setTimeout(() => waiting.delete(id) && resolve(null), 10_000);
      }),
    close: () => post({ ucp: 1, type: "close" }),
  };
}
