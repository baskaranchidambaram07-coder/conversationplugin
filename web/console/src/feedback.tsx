// Feedback (M10): what visitors said about a widget's answers, the newest first, read here by the widget's own
// organisation. A rating comes with the visitor's comment, whether they were public or signed in (never who), and
// the question and the answer it is about.
import { useCallback, useEffect, useState } from "react";

import { call } from "./api";
import { strings as t } from "./strings";
import { Glyph } from "./ui";

type Rating = "like" | "dislike";
type Entry = {
  id: string;
  rating: Rating;
  comment: string | null;
  visitor: "anonymous" | "signed_in";
  at: string;
  question: string;
  answer: string;
};
type Page = { counts: Record<Rating, number>; items: Entry[]; next: string | null };

const THUMB: Record<Rating, string> = {
  like: "M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM7 10l4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7",
  dislike: "M7 14V3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1zM7 14l4 7a2 2 0 0 0 3-2l-1-5h6a2 2 0 0 0 2-2.3l-1.4-7A2 2 0 0 0 17.6 3H7",
};
const FILTERS = ["all", "like", "dislike"] as const;
const moment = (at: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));

export function FeedbackView({ widgetId, onProblem }: { widgetId: string; onProblem: (error: unknown) => void }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      setLoading(true);
      try {
        const query = new URLSearchParams(filter === "all" ? {} : { rating: filter });
        if (before) query.set("before", before);
        const found = await call<Page>("GET", `/widgets/${widgetId}/feedback?${query}`);
        setPage((was) => (before && was ? { ...found, items: [...was.items, ...found.items] } : found));
      } catch (error) {
        onProblem(error);
      } finally {
        setLoading(false);
      }
    },
    [widgetId, filter, onProblem],
  );

  useEffect(() => {
    setPage(null);
    void load();
  }, [load]);

  const total = page ? page.counts.like + page.counts.dislike : 0;
  return (
    <section className="card stop" aria-label={t.feedback}>
      <header>
        <h2 id="stop-title" tabIndex={-1}>
          {t.feedback}
        </h2>
        <p>{t.feedbackIntro}</p>
      </header>
      {page && total > 0 && <p className="tally">{t.tally(page.counts.like, page.counts.dislike)}</p>}
      <div className="theme filter" role="group" aria-label={t.feedbackFilter}>
        {FILTERS.map((one) => (
          <button key={one} type="button" className="quiet" aria-pressed={filter === one} onClick={() => setFilter(one)}>
            {t.feedbackShown[one]}
          </button>
        ))}
      </div>
      {!page ? (
        <div className="ring" role="status" aria-label={t.loading} />
      ) : page.items.length === 0 ? (
        <p className="note">{filter === "all" ? t.noFeedback : t.noFeedbackOfKind}</p>
      ) : (
        <ul className="feedback">
          {page.items.map((entry) => (
            <li key={entry.id}>
              <p className="rated">
                <Glyph path={THUMB[entry.rating]} />
                <b>{t.rated[entry.rating]}</b>
                <span>
                  {t.visitorKind[entry.visitor]} · <time dateTime={entry.at}>{moment(entry.at)}</time>
                </span>
              </p>
              {entry.comment ? (
                <blockquote dir="auto">{entry.comment}</blockquote>
              ) : (
                <p className="note">{t.noComment}</p>
              )}
              <dl>
                <dt>{t.askedQuestion}</dt>
                <dd dir="auto">{entry.question || t.questionGone}</dd>
              </dl>
              <details>
                <summary>{t.showAnswer}</summary>
                <p className="answer" dir="auto" tabIndex={0}>
                  {entry.answer}
                </p>
              </details>
            </li>
          ))}
        </ul>
      )}
      {page?.next && (
        <button type="button" className="secondary" disabled={loading} onClick={() => void load(page.next!)}>
          {t.olderFeedback}
        </button>
      )}
    </section>
  );
}
