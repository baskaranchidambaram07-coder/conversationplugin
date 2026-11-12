// Generated from schema/v1.json by `npm run generate --workspace @ucp/protocol`. Do not edit.

export type Protocol =
  Block | StreamEvent | ApiError | Conversation | Message | WidgetConfig | SessionRequest | Session | SendMessage;
export type Block = TextBlock | MarkdownBlock | UnknownBlock;
export type StreamEvent =
  MessageStarted | ContentBlockStarted | ContentBlockDelta | ContentBlockCompleted | MessageCompleted | MessageFailed;
/**
 * Our opaque ID. Never a PF ID.
 */
export type Id = string;
export type Index = number;

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
    | "session_expired"
    | "forbidden"
    | "site_not_allowed"
    | "not_found"
    | "turn_in_progress"
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
export interface Conversation {
  id: Id;
  title: string | null;
  created_at: string;
  updated_at: string;
}
export interface Message {
  id: Id;
  role: "user" | "assistant";
  status: "in_progress" | "complete" | "failed" | "stopped";
  blocks: Block[];
  error: ApiError | null;
  created_at: string;
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
  color_scheme: "light" | "dark" | "auto";
  launcher_position: "bottom-right" | "bottom-left";
  history_enabled: boolean;
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
}
