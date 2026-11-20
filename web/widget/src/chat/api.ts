// The chat's calls to the gateway, all on our own origin. The session token lives only in this closure:
// never in storage, a URL or the page (D6).
import type { FileBlock } from "../Attachments";
import type {
  ApiError,
  Conversation,
  ConversationPage,
  Feedback,
  Message,
  MessagePage,
  Pin,
  PinPage,
  Project,
  ProjectPage,
  SendMessage,
  Session,
  SessionRequest,
  VoiceConsent,
  VoiceLanguage,
  VoiceStart,
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

  /** Uploads a file to a chat, reporting its progress from 0 to 1: fetch cannot report an upload's progress. */
  async function upload(conversationId: string, file: File, onProgress: (done: number) => void, replay = true): Promise<FileBlock> {
    const token = await (session ?? start());
    const reply = await new Promise<{ status: number; text: string }>((resolve) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/v1/conversations/${conversationId}/files?name=${encodeURIComponent(file.name)}`);
      request.setRequestHeader("authorization", `Bearer ${token}`);
      request.setRequestHeader("content-type", file.type || "application/octet-stream");
      request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
      request.onload = () => resolve({ status: request.status, text: request.responseText });
      request.onerror = () => resolve({ status: 0, text: "" });
      request.send(file);
    });
    let body: unknown = null;
    try {
      body = JSON.parse(reply.text);
    } catch {
      // not JSON: reported by status alone
    }
    if (reply.status === 201) return body as FileBlock;
    const error = body && typeof (body as ApiError).code === "string" ? (body as ApiError) : null;
    if (error?.code === "session_expired" && signedIn && replay) {
      start();
      return upload(conversationId, file, onProgress, false);
    }
    throw new Failure(reply.status, error);
  }

  return {
    start,
    upload,
    /** A file sent with a question, to show or save. */
    async download(conversationId: string, fileId: string): Promise<Blob> {
      return (await authorised(`/v1/conversations/${conversationId}/files/${fileId}`)).blob();
    },
    /** A new chat, inside a project when one is named. */
    async conversation(projectId?: string): Promise<Conversation> {
      const filed = projectId ? { headers: JSON_TYPE, body: JSON.stringify({ project_id: projectId }) } : {};
      return (await authorised("/v1/conversations", { method: "POST", ...filed })).json();
    },
    /** Files a chat under a project, or under none with null. */
    async file(conversationId: string, projectId: string | null): Promise<Conversation> {
      const body = JSON.stringify({ project_id: projectId });
      return (await authorised(`/v1/conversations/${conversationId}`, { method: "PATCH", headers: JSON_TYPE, body })).json();
    },
    async projects(): Promise<Project[]> {
      return ((await (await authorised("/v1/projects")).json()) as ProjectPage).projects;
    },
    async createProject(name: string): Promise<Project> {
      const init = { method: "POST", headers: JSON_TYPE, body: JSON.stringify({ name }) };
      return (await authorised("/v1/projects", init)).json();
    },
    async renameProject(projectId: string, name: string): Promise<Project> {
      const init = { method: "PATCH", headers: JSON_TYPE, body: JSON.stringify({ name }) };
      return (await authorised(`/v1/projects/${projectId}`, init)).json();
    },
    async deleteProject(projectId: string): Promise<void> {
      await authorised(`/v1/projects/${projectId}`, { method: "DELETE" });
    },
    /** A project's chats, most recently active first. shortcut: the newest 50; page on when someone keeps more. */
    async projectChats(projectId: string): Promise<Conversation[]> {
      const page = (await (await authorised(`/v1/conversations?project=${projectId}&limit=50`)).json()) as ConversationPage;
      return page.conversations;
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
    /** Rates an answer, or takes the rating back with null. */
    async rate(conversationId: string, messageId: string, feedback: Feedback | null): Promise<void> {
      const path = `/v1/conversations/${conversationId}/messages/${messageId}/feedback`;
      const put = feedback && { method: "PUT", headers: JSON_TYPE, body: JSON.stringify(feedback) };
      await authorised(path, put ?? { method: "DELETE" });
    },
    /** Pins an answer, or unpins it. */
    async pin(conversationId: string, messageId: string, pinned: boolean): Promise<void> {
      const path = `/v1/conversations/${conversationId}/messages/${messageId}/pin`;
      await authorised(path, { method: pinned ? "PUT" : "DELETE" });
    },
    /** Records that the visitor accepted the voice notice for one way of listening (M11). */
    async consent(body: VoiceConsent): Promise<void> {
      await authorised("/v1/voice/consent", { method: "POST", headers: JSON_TYPE, body: JSON.stringify(body) });
    },
    /** The voice socket, open and started for the language: audio frames go in, what is heard comes back. The
     *  token goes in its first message, never in its address. */
    async voice(language: VoiceLanguage, place: Location = location): Promise<WebSocket> {
      const token = await (session ?? start());
      const socket = new WebSocket(`${place.protocol === "https:" ? "wss" : "ws"}://${place.host}/v1/voice`);
      socket.binaryType = "arraybuffer";
      await new Promise<void>((opened, failed) => {
        socket.onopen = () => opened();
        socket.onerror = () => failed(new Failure(0, null));
      });
      const begin: VoiceStart = { type: "start", token, language };
      socket.send(JSON.stringify(begin));
      return socket;
    },
    async pins(): Promise<Pin[]> {
      return ((await (await authorised("/v1/pins")).json()) as PinPage).pins;
    },
    /** A page of a chat, oldest first, ending with its newest message; `cursor` reaches further back. */
    async messages(conversationId: string, cursor?: string | null): Promise<MessagePage> {
      return (await authorised(`/v1/conversations/${conversationId}/messages${before(cursor)}`)).json();
    },
  };
}
