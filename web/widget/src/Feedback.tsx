// Helpful or not, under a finished answer (M2-T5, M4-T10). A thumb saves at once; a small card under it then asks,
// optionally, what was good or could be better. Inline, not floating: the conversation scrolls and would clip it.
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";
import { strings as t } from "./strings";

export type Rating = "like" | "dislike";
/** Saves a rating (null takes it back), with a comment when given. Rejects when it could not be saved. */
export type Rate = (rating: Rating | null, comment?: string) => Promise<void>;

const THUMB = {
  like: "M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7",
  dislike:
    "M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1zM7 14l4 7a2 2 0 0 0 3-2l-1-5h6a2 2 0 0 0 2-2.3l-1.4-7A2 2 0 0 0 17.6 3H7",
};
const LIMIT = 1000;

/** `say` speaks through the chat's one polite live region. */
export function Feedback({ initial, rate, say }: { initial: Rating | null; rate: Rate; say: (text: string) => void }) {
  const [rating, setRating] = useState(initial);
  const [asking, setAsking] = useState(false);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "thanks" | "failed">("idle");
  const thumbs = { like: useRef<HTMLButtonElement>(null), dislike: useRef<HTMLButtonElement>(null) };
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Not on a touch screen: focusing would raise the keyboard over the chat for a comment that is optional.
    if (asking && !window.matchMedia?.("(pointer: coarse)").matches) field.current?.focus();
  }, [asking]);

  useEffect(() => {
    if (state !== "thanks") return;
    const timer = setTimeout(() => setState("idle"), 4000);
    return () => clearTimeout(timer);
  }, [state]);

  async function choose(next: Rating) {
    const was = rating;
    const taken = was === next ? null : next; // the chosen thumb again takes the rating back
    setRating(taken);
    setAsking(taken !== null);
    setComment("");
    setState("idle");
    try {
      await rate(taken);
    } catch {
      setRating(was);
      setAsking(false);
      setState("failed");
      say(t.feedbackFailed);
    }
  }

  async function send() {
    if (!rating) return;
    setState("sending");
    try {
      await rate(rating, comment.trim());
      setAsking(false);
      setState("thanks");
      say(t.feedbackThanks);
      thumbs[rating].current?.focus();
    } catch {
      setState("failed");
      say(t.feedbackFailed);
    }
  }

  function close() {
    setAsking(false);
    setState("idle");
    if (rating) thumbs[rating].current?.focus();
  }

  function keys(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.stopPropagation(); // the card closes, not the whole chat
    close();
  }

  return (
    <>
      {(["like", "dislike"] as const).map((kind) => (
        <button
          key={kind}
          ref={thumbs[kind]}
          type="button"
          className="quiet thumb"
          aria-label={t.rate[kind]}
          aria-pressed={rating === kind}
          onClick={() => void choose(kind)}
        >
          <Icon path={THUMB[kind]} filled={rating === kind} />
        </button>
      ))}
      <span className="rated">
        {state === "thanks" ? t.feedbackThanks : state === "failed" && !asking ? t.feedbackFailed : ""}
      </span>
      {asking && rating && (
        <form
          className="ask"
          onKeyDown={keys}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={`why-${rating}`}>{t.feedbackAsk[rating]}</label>
          <textarea
            id={`why-${rating}`}
            ref={field}
            rows={2}
            maxLength={LIMIT}
            value={comment}
            placeholder={t.feedbackOptional}
            onChange={(event) => setComment(event.target.value)}
          />
          {state === "failed" && <p className="meta">{t.feedbackFailed}</p>}
          <div className="ask-acts">
            <button type="submit" className="secondary" disabled={!comment.trim() || state === "sending"}>
              {t.feedbackSend}
            </button>
            <button type="button" className="quiet" onClick={close}>
              {t.feedbackClose}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
