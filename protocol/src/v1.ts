// Generated from schema/v1.json by `npm run generate --workspace @ucp/protocol`. Do not edit.

export type Protocol =
  | Block
  | StreamEvent
  | ApiError
  | Conversation
  | Message
  | ConversationPage
  | MessagePage
  | WidgetConfig
  | SessionRequest
  | Session
  | SendMessage
  | Feedback
  | Project
  | ProjectName
  | ProjectPage
  | Filing
  | Pin
  | PinPage
  | VoiceConsent
  | VoiceRequest
  | VoiceReply;
export type Block = TextBlock | MarkdownBlock | FileBlock | UnknownBlock;
/**
 * Our opaque ID. Never a PF ID.
 */
export type Id = string;
export type StreamEvent =
  | MessageStarted
  | ContentBlockStarted
  | ContentBlockDelta
  | ContentBlockCompleted
  | MessageCompleted
  | MessageFailed
  | SpeechAudio;
export type Index = number;
/**
 * Opaque. Pass it as `before` for the next page.
 */
export type Cursor = string;
export type VoiceLanguage =
  | "en-GB"
  | "en-US"
  | "en-AU"
  | "en-IN"
  | "en-IE"
  | "en-NZ"
  | "en-ZA"
  | "ar-AE"
  | "de-DE"
  | "es-ES"
  | "es-US"
  | "fr-CA"
  | "fr-FR"
  | "hi-IN"
  | "it-IT"
  | "ja-JP"
  | "ko-KR"
  | "nl-NL"
  | "pt-BR"
  | "pt-PT"
  | "zh-CN";
export type VoiceRequest = VoiceStart | VoiceStop;
export type VoiceReply = VoiceHeard | VoiceFailed;

/**
 * Plain text, shown exactly as written and never interpreted. Used for what the user typed.
 */
export interface TextBlock {
  type: "text";
  text: string;
}
/**
 * Markdown. Tables, code and fenced diagram blocks travel inside it (D9).
 */
export interface MarkdownBlock {
  type: "markdown";
  text: string;
}
/**
 * A file the visitor attached to a question (M10), downloaded from
 * GET /v1/conversations/{id}/files/{file id}. Also the reply to an upload.
 */
export interface FileBlock {
  type: "file";
  id: Id;
  name: string;
  /**
   * Bytes.
   */
  size: number;
  content_type:
    | "application/pdf"
    | "image/png"
    | "image/jpeg"
    | "application/msword"
    | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
/**
 * A block type this version does not know, sent by a newer gateway. Shown as its `text`, if it has one.
 */
export interface UnknownBlock {
  type: string;
  text?: string | null;
  [k: string]: unknown;
}
/**
 * The assistant message exists. The widget shows its working state.
 */
export interface MessageStarted {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "message.started";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
}
/**
 * A block opens, with whatever it holds so far (for Markdown, empty text).
 */
export interface ContentBlockStarted {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "content_block.started";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
  index: Index;
  block: Block;
}
/**
 * Text to append to the open block.
 */
export interface ContentBlockDelta {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "content_block.delta";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
  index: Index;
  text: string;
}
/**
 * The whole block. It replaces what the deltas built, so a missed delta is repaired.
 */
export interface ContentBlockCompleted {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "content_block.completed";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
  index: Index;
  block: Block;
}
export interface MessageCompleted {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "message.completed";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
}
/**
 * The turn failed. Blocks already streamed stay on screen.
 */
export interface MessageFailed {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "message.failed";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
  error: ApiError;
}
/**
 * The body of every error response, and the payload of `message.failed`.
 */
export interface ApiError {
  code:
    | "invalid_request"
    | "sign_in_required"
    | "session_expired"
    | "forbidden"
    | "site_not_allowed"
    | "not_found"
    | "turn_in_progress"
    | "conflict"
    | "unsafe_file"
    | "rate_limited"
    | "assistant_unavailable"
    | "internal_error";
  /**
   * Our own wording. Never text from PF.
   */
  message: string;
  retryable: boolean;
  /**
   * Seconds to wait before retrying.
   */
  retry_after: number | null;
  /**
   * The correlation ID, shown to the user so support can find the request.
   */
  reference: string;
}
/**
 * A piece of the answer read aloud (M11), for a question sent with `speak`. Pieces arrive in order, after the
 * text they read. `audio` is base64 of an MP3 or WAV clip; null when it could not be voiced, so the chat reads
 * `text` with the browser's own voice.
 */
export interface SpeechAudio {
  v: 1;
  /**
   * Starts at 0 for each message and rises by one per event.
   */
  seq: number;
  type: "speech.audio";
  conversation_id: Id;
  message_id: Id;
  correlation_id: Id;
  part: Index;
  text: string;
  audio: string | null;
}
export interface Conversation {
  id: Id;
  title: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The project the chat is filed under, if any.
   */
  project_id?: Id | null;
}
export interface Message {
  id: Id;
  role: "user" | "assistant";
  status: "in_progress" | "complete" | "failed" | "stopped";
  blocks: Block[];
  error: ApiError | null;
  created_at: string;
  /**
   * The visitor's rating of an answer.
   */
  feedback?: ("like" | "dislike") | null;
  /**
   * The visitor pinned this answer to find it again.
   */
  pinned?: boolean;
}
/**
 * Reply to GET /v1/conversations: the visitor's conversations, most recently active first.
 */
export interface ConversationPage {
  conversations: Conversation[];
  /**
   * Null when there are no older conversations.
   */
  next: Cursor | null;
}
/**
 * Reply to GET /v1/conversations/{id}/messages: a page of messages, oldest first, and the page before it.
 */
export interface MessagePage {
  messages: Message[];
  /**
   * Null when this page starts the conversation.
   */
  next: Cursor | null;
}
export interface WidgetConfig {
  v: 1;
  widget_id: Id;
  title: string;
  welcome_message: string | null;
  /**
   * @maxItems 4
   */
  suggested_prompts: string[];
  /**
   * Null means the widget's own wording.
   */
  ai_notice: string | null;
  brand_color: string;
  logo_url: string | null;
  /**
   * The assistant's picture, uploaded through the admin API: the SHA-256 of an image served at /v1/images/{avatar}. The launcher and the chat show it; null shows the chat glyph.
   */
  avatar?: string | null;
  /**
   * A short line shown once beside the closed launcher, such as "Hi, I'm Eva."
   */
  greeting?: string | null;
  color_scheme: "light" | "dark" | "auto";
  launcher_position: "bottom-right" | "bottom-left";
  history_enabled: boolean;
  /**
   * Visitors may attach doc, docx, pdf, jpg, jpeg and png files to a question.
   */
  attachments_enabled?: boolean;
  /**
   * Visitors may speak questions and hear answers (M11).
   */
  voice_enabled?: boolean;
  /**
   * The languages visitors may speak and hear, the first being the default.
   *
   * @minItems 1
   * @maxItems 21
   */
  voice_languages?: [VoiceLanguage, ...VoiceLanguage[]];
  /**
   * Whether the chat may use the browser's own speech recognition: never; only where it runs on the device, so no audio leaves it; or also where the browser maker's servers recognise it.
   */
  browser_speech?: "never" | "on_device" | "allowed";
}
/**
 * Body of POST /v1/sessions. A signed-in visitor brings the token the host signed for them; anyone else, null.
 */
export interface SessionRequest {
  widget_id: Id;
  host_token: string | null;
}
/**
 * Reply to POST /v1/sessions. The token is opaque to the browser and goes back as `Authorization: Bearer`.
 */
export interface Session {
  token: string;
  /**
   * Seconds until the token expires.
   */
  expires_in: number;
}
/**
 * Body of POST /v1/conversations/{id}/messages. The reply streams StreamEvent lines, with `: ping` heartbeats.
 */
export interface SendMessage {
  /**
   * What the visitor typed: 1 to 4,000 characters, not only spaces.
   */
  text: string;
  /**
   * Our opaque ID. Never a PF ID.
   */
  client_message_id: string;
  /**
   * Files uploaded to this conversation, sent with the question: at most 5.
   *
   * @maxItems 5
   */
  attachments?: Id[];
  /**
   * Read the answer aloud in this language, as `speech.audio` events (M11).
   */
  speak?: VoiceLanguage | null;
}
/**
 * Body of PUT /v1/conversations/{id}/messages/{id}/feedback: the visitor's rating of an answer.
 */
export interface Feedback {
  rating: "like" | "dislike";
  /**
   * What could be better.
   */
  comment?: string | null;
}
/**
 * A signed-in visitor's folder of chats.
 */
export interface Project {
  id: Id;
  name: string;
  created_at: string;
  /**
   * When the project or a chat in it was last active.
   */
  updated_at: string;
}
/**
 * Body of POST /v1/projects and PATCH /v1/projects/{id}.
 */
export interface ProjectName {
  name: string;
}
/**
 * Reply to GET /v1/projects: the visitor's projects, most recently active first.
 */
export interface ProjectPage {
  projects: Project[];
}
/**
 * Body of PATCH /v1/conversations/{id}, and optionally of POST /v1/conversations: the project a chat is filed
 * under, or null for none. Signed-in visitors only.
 */
export interface Filing {
  project_id: Id | null;
}
/**
 * A pinned answer, with what was asked and the chat it is in.
 */
export interface Pin {
  conversation: Conversation;
  /**
   * What the visitor asked, as typed; null if it is not stored.
   */
  question: string | null;
  message: Message;
  pinned_at: string;
}
/**
 * Reply to GET /v1/pins: the visitor's pinned answers, the newest pin first.
 */
export interface PinPage {
  pins: Pin[];
}
/**
 * Body of POST /v1/voice/consent: the visitor accepted the voice notice before their first recording.
 */
export interface VoiceConsent {
  /**
   * The version of the notice they read.
   */
  version: number;
  /**
   * Who hears their voice: our speech service, the browser maker's servers, or only their device.
   */
  engine: "service" | "browser" | "device";
}
/**
 * The first message on the voice socket, GET /v1/voice. Binary frames of audio follow: 16 kHz, 16-bit, mono
 * little-endian PCM, at most 6,400 bytes each.
 */
export interface VoiceStart {
  type: "start";
  /**
   * The session token, sent here rather than in the address so it stays out of logs.
   */
  token: string;
  language: VoiceLanguage;
}
/**
 * The visitor stopped speaking: the gateway sends the final text and closes the socket.
 */
export interface VoiceStop {
  type: "stop";
}
/**
 * Everything heard so far, which replaces the last `partial`. `final` is the last message before closing.
 */
export interface VoiceHeard {
  type: "partial" | "final";
  text: string;
}
/**
 * The socket could not carry on; it closes after this.
 */
export interface VoiceFailed {
  type: "error";
  error: ApiError;
}
