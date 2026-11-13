// The chat's calls to the gateway, all on our own origin. The session token lives only in this closure:
// never in storage, a URL or the page (D6).
import type {
  ApiError,
  Conversation,
  ConversationPage,
  Message,
  MessagePage,
  SendMessage,
  Session,
  SessionRequest,
} from "@ucp/protocol/v1";

/** Any failed call: `status` 0 means the network failed; `error` is the gateway's body when it sent one. */
export class Failure extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError | null,
  ) {
    super(error?.code ?? (status ? `HTTP ${status}` : "network"));
  }
}

const JSON_TYPE = { "content-type": "application/json" };
const before = (cursor?: string | null) => (cursor ? `?before=${encodeURIComponent(cursor)}` : "");

export type Api = ReturnType<typeof gateway>;

/**
 * hostToken() asks the host page for a signed-in visitor's token (through the bridge), or gives null.
 * A signed-in visitor's expired session is renewed once and the call replayed. An anonymous one cannot be:
 * the conversation belongs to the anonymous session that started it.
 */
export function gateway(widgetId: string, hostToken: () => Promise<string | null>, fetcher: typeof fetch = fetch) {
  let session: Promise<string> | undefined;
  let signedIn = false;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetcher(path, { ...init, credentials: "omit" });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error; // the visitor pressed stop
      throw new Failure(0, null);
    }
    if (response.ok) return response;
    const error = (await response.json().catch(() => null)) as ApiError | null;
    throw new Failure(response.status, error && typeof error.code === "string" ? error : null);
  }

  function start() {
    const attempt = (async () => {
      const host_token = await hostToken();
      signedIn = host_token !== null;
      const body: SessionRequest = { widget_id: widgetId, host_token };
      const reply = await call("/v1/sessions", { method: "POST", headers: JSON_TYPE, body: JSON.stringify(body) });
      return ((await reply.json()) as Session).token;
    })();
    session = attempt;
    attempt.catch(() => {
      if (session === attempt) session = undefined; // a failed start is tried again by the next call
    });
    return attempt;
  }

  async function authorised(path: string, init: RequestInit = {}, replay = true): Promise<Response> {
    const token = await (session ?? start());
    try {
      return await call(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` } });
    } catch (failure) {
      const expired = failure instanceof Failure && failure.error?.code === "session_expired";
      if (!expired || !signedIn || !replay) throw failure;
      start();
      return authorised(path, init, false);
    }
  }

  return {
    start,
    async conversation(): Promise<Conversation> {
      return (await authorised("/v1/conversations", { method: "POST" })).json();
    },
    /** The streamed reply; read its body with eventReader(). */
    send(conversationId: string, body: SendMessage, signal?: AbortSignal): Promise<Response> {
      return authorised(`/v1/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { ...JSON_TYPE, accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal,
      });
    },
    async message(conversationId: string, messageId: string): Promise<Message> {
      return (await authorised(`/v1/conversations/${conversationId}/messages/${messageId}`)).json();
    },
    /** The visitor's chats, most recently active first; `cursor` is the `next` of the page before. */
    async conversations(cursor?: string | null): Promise<ConversationPage> {
      return (await authorised(`/v1/conversations${before(cursor)}`)).json();
    },
    /** A page of a chat, oldest first, ending with its newest message; `cursor` reaches further back. */
    async messages(conversationId: string, cursor?: string | null): Promise<MessagePage> {
      return (await authorised(`/v1/conversations/${conversationId}/messages${before(cursor)}`)).json();
    },
  };
}
