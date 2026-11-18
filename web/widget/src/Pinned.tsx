// Pinned answers (signed-in visitors): a pin under an answer, and a page of every pinned answer under its question.
// Opening one goes back to its chat and shows the answer.
import type { Pin } from "@ucp/protocol/v1";
import { type Ref, useState } from "react";

import { when } from "./chat/history";
import { Icon } from "./Icon";
import { strings as t } from "./strings";

export const PIN = "M9 3h6M10 3v6l-3 4h10l-3-4V3M12 13v8";

/** An answer's Markdown as one line of plain words, for a short excerpt. */
export function excerpt(markdown: string): string {
  return markdown
    .replace(/^\s*```.*$/gm, " ") // fence lines
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "") // heading, quote and list markers
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images keep their words
    .replace(/[*_`~]+/g, "") // emphasis and code marks
    .replace(/\|/g, " ") // table bars
    .replace(/\s+/g, " ")
    .trim();
}

/** Pins or unpins one answer at once; a failure puts it back and says so. */
export function PinButton({
  pinned,
  toggle,
  say,
}: {
  pinned: boolean;
  toggle: (pinned: boolean) => Promise<void>;
  say: (text: string) => void;
}) {
  const [on, setOn] = useState(pinned);
  async function flip() {
    const next = !on;
    setOn(next);
    try {
      await toggle(next);
      say(next ? t.pinnedNow : t.unpinnedNow);
    } catch {
      setOn(!next);
      say(t.actionFailed);
    }
  }
  return (
    <button type="button" className="quiet thumb" aria-label={t.pin} aria-pressed={on} onClick={() => void flip()}>
      <Icon path={PIN} filled={on} />
    </button>
  );
}

/** Every pinned answer, the newest pin first: what was asked, the start of the answer, and its chat. */
export function PinnedPage({
  pins,
  failed,
  titleRef,
  onOpen,
  onUnpin,
  onRetry,
}: {
  pins: Pin[] | null;
  failed: boolean;
  titleRef: Ref<HTMLHeadingElement>;
  onOpen: (pin: Pin) => void;
  onUnpin: (pin: Pin) => Promise<void>;
  onRetry: () => void;
}) {
  const [refused, setRefused] = useState<string | null>(null);

  async function unpin(pin: Pin) {
    setRefused(null);
    try {
      await onUnpin(pin);
    } catch {
      setRefused(pin.message.id);
    }
  }

  return (
    <section className="view" aria-labelledby="view-title">
      <div className="view-head">
        <h2 id="view-title" ref={titleRef} tabIndex={-1}>
          {t.pinned}
        </h2>
      </div>
      {failed ? (
        <div className="problem" role="alert">
          <p>{t.actionFailed}</p>
          <button type="button" className="secondary" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      ) : pins === null ? (
        <p className="meta" role="status">
          {t.loadingPins}
        </p>
      ) : pins.length === 0 ? (
        <p className="meta empty">{t.noPins}</p>
      ) : (
        <ul className="pins">
          {pins.map((pin) => (
            <li key={pin.message.id}>
              <button type="button" className="pin-open" onClick={() => onOpen(pin)}>
                {pin.question && (
                  <span className="asked" dir="auto">
                    {pin.question}
                  </span>
                )}
                <span className="excerpt" dir="auto">
                  {excerpt(pin.message.blocks.map((block) => (typeof block?.text === "string" ? block.text : "")).join(" "))}
                </span>
                <span className="where">
                  <span dir="auto">{pin.conversation.title}</span>
                  <time dateTime={pin.pinned_at}>{when(pin.pinned_at)}</time>
                </span>
              </button>
              <button type="button" className="quiet thumb" aria-label={t.unpin} onClick={() => void unpin(pin)}>
                <Icon path={PIN} filled />
              </button>
              {refused === pin.message.id && (
                <p className="meta" role="alert">
                  {t.actionFailed}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
