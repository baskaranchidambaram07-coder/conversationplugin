// Messages between the loader on the host page and the chat in its iframe, version 1.
// Each side drops anything that is not a version 1 message of a type it knows, so a loader and a chat
// of different releases still connect: new fields and new message types are only ever added.
// Origins are checked by the caller, against the window the message came from.

/** From the chat to the loader. `ready` goes to any origin and carries nothing; everything else is pinned. */
export type ChatMessage =
  | { ucp: 1; type: "ready" }
  | { ucp: 1; type: "get-token"; id: number }
  | { ucp: 1; type: "close" };

/**
 * From the loader to the chat. The chat pins the parent's origin from `init` and trusts no other.
 * `shown` and `hidden` follow the panel opening and closing, so the chat can take focus and pause its animations.
 */
export type LoaderMessage =
  | { ucp: 1; type: "init"; mode: "floating" | "inline"; signedIn: boolean }
  | { ucp: 1; type: "token"; id: number; token: string | null }
  | { ucp: 1; type: "shown" }
  | { ucp: 1; type: "hidden" };

type Candidate = { ucp?: unknown; type?: unknown; [field: string]: unknown };

function v1(data: unknown): data is Candidate {
  return typeof data === "object" && data !== null && (data as Candidate).ucp === 1;
}

export function fromChat(data: unknown): ChatMessage | null {
  if (!v1(data)) return null;
  const ok =
    data.type === "ready" || data.type === "close" || (data.type === "get-token" && Number.isInteger(data.id));
  return ok ? (data as ChatMessage) : null;
}

export function fromLoader(data: unknown): LoaderMessage | null {
  if (!v1(data)) return null;
  const ok =
    (data.type === "init" &&
      (data.mode === "floating" || data.mode === "inline") &&
      typeof data.signedIn === "boolean") ||
    (data.type === "token" && Number.isInteger(data.id) && (typeof data.token === "string" || data.token === null)) ||
    data.type === "shown" ||
    data.type === "hidden";
  return ok ? (data as LoaderMessage) : null;
}
