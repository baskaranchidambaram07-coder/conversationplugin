// The Look station (M9-T3): how the chat looks on the customer's pages, beside a live preview that is the chat
// itself (web/widget, at /preview on the console's own address), sent the draft's settings as they are typed.
// Colours are judged with the same rules the loader and the chat use (@ucp/protocol/brand).
import { contrast, inkOn, isColor } from "@ucp/protocol/brand";
import { useEffect, useRef, useState } from "react";

import { Field } from "./editors";
import { strings as t } from "./strings";

export type Look = {
  title?: string;
  welcome_message?: string | null;
  suggested_prompts?: string[];
  ai_notice?: string | null;
  brand_color?: string;
  logo_url?: string | null;
  color_scheme?: "light" | "dark" | "auto";
  launcher_position?: "bottom-right" | "bottom-left";
  history_enabled?: boolean;
};

const CREAM = "#fbf3ea"; // the chat's light ground
const NIGHT = "#1c1815"; // its dark ground (DESIGN.md, Dark scheme)
const QUESTIONS = 4;

/** What the button colour does on the chat: the text on it, and how it stands out in each scheme. */
export function colourNotes(colour: string): { text: string; warnings: string[] } {
  if (!isColor(colour)) return { text: "", warnings: [t.colourRule] };
  const ink = inkOn(colour);
  const text = t.textOn(ink === "#ffffff" ? t.white : t.black, contrast(colour, ink).toFixed(1));
  const warnings = [];
  if (contrast(colour, CREAM) < 1.5) warnings.push(t.faintOnLight);
  if (contrast(colour, NIGHT) < 1.5) warnings.push(t.creamOnDark);
  return { text, warnings };
}

export function LookEditor(props: { value: Look; signedIn: boolean; onChange: (look: Look) => void; readOnly: boolean }) {
  const { value, signedIn, onChange, readOnly } = props;
  const change = (changes: Look) => onChange({ ...value, ...changes });
  const questions = [...(value.suggested_prompts ?? [])];
  const slots = questions.length < QUESTIONS ? [...questions, ""] : questions;
  const colour = value.brand_color ?? "";
  const notes = colourNotes(colour);

  return (
    <fieldset className="editor" disabled={readOnly}>
      <legend className="hidden">{t.station.look}</legend>
      <Field label={t.title}>
        {(id) => <input id={id} type="text" maxLength={80} value={value.title ?? ""} onChange={(event) => change({ title: event.target.value })} />}
      </Field>
      <Field label={t.welcome} hint={t.welcomeHint}>
        {(id) => (
          <textarea
            id={id}
            rows={3}
            maxLength={1000}
            value={value.welcome_message ?? ""}
            onChange={(event) => change({ welcome_message: event.target.value || null })}
          />
        )}
      </Field>
      <fieldset>
        <legend>{t.questions}</legend>
        <p className="hint">{t.questionsHint}</p>
        <ol className="questions">
          {slots.map((question, index) => (
            <li key={index}>
              <input
                type="text"
                maxLength={200}
                aria-label={t.question(index + 1)}
                value={question}
                onChange={(event) => {
                  const next = [...slots];
                  next[index] = event.target.value;
                  change({ suggested_prompts: next.filter(Boolean) }); // an emptied question is dropped
                }}
              />
            </li>
          ))}
        </ol>
      </fieldset>
      <Field label={t.colour} hint={t.colourHint}>
        {(id) => (
          <div className="inline colour">
            <input
              type="color"
              aria-label={t.colourPicker}
              value={isColor(colour) ? colour.toLowerCase() : "#2b241f"}
              onChange={(event) => change({ brand_color: event.target.value.toUpperCase() })}
            />
            <input
              id={id}
              type="text"
              spellCheck={false}
              maxLength={7}
              value={colour}
              aria-invalid={!isColor(colour)}
              aria-describedby={`${id}-notes`}
              onChange={(event) => change({ brand_color: event.target.value.trim() })}
            />
            <div id={`${id}-notes`} className="notes" aria-live="polite">
              {notes.text && <p className="good">{notes.text}</p>}
              {notes.warnings.map((warning) => (
                <p key={warning} className="warn">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        )}
      </Field>
      <Field label={t.logo} hint={t.logoHint}>
        {(id) => (
          <input
            id={id}
            type="url"
            spellCheck={false}
            placeholder="https://"
            value={value.logo_url ?? ""}
            onChange={(event) => change({ logo_url: event.target.value.trim() || null })}
          />
        )}
      </Field>
      <Field label={t.notice} hint={t.noticeHint}>
        {(id) => (
          <input id={id} type="text" maxLength={500} value={value.ai_notice ?? ""} onChange={(event) => change({ ai_notice: event.target.value || null })} />
        )}
      </Field>
      <div className="grid">
        <fieldset>
          <legend>{t.scheme}</legend>
          <ul className="choices">
            {(["light", "dark", "auto"] as const).map((scheme) => (
              <li key={scheme} className={value.color_scheme === scheme ? "chosen" : undefined}>
                <label>
                  <input type="radio" name="scheme" checked={value.color_scheme === scheme} onChange={() => change({ color_scheme: scheme })} />
                  <span>
                    <b>{t.schemes[scheme]}</b>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <fieldset>
          <legend>{t.corner}</legend>
          <ul className="choices">
            {(["bottom-right", "bottom-left"] as const).map((corner) => (
              <li key={corner} className={value.launcher_position === corner ? "chosen" : undefined}>
                <label>
                  <input type="radio" name="corner" checked={value.launcher_position === corner} onChange={() => change({ launcher_position: corner })} />
                  <span>
                    <b>{t.corners[corner]}</b>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </div>
      {signedIn && (
        <label className="check">
          <input type="checkbox" checked={Boolean(value.history_enabled)} onChange={(event) => change({ history_enabled: event.target.checked })} />
          <span>{t.history}</span>
        </label>
      )}
    </fieldset>
  );
}

/** The chat itself, drawn with the draft's settings. Nothing in it is published, fetched or sent. */
export function Preview({ look, widgetId }: { look: Look; widgetId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  const shown = look.color_scheme === "auto" || !look.color_scheme ? scheme : look.color_scheme;

  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.origin === location.origin && event.data?.type === "preview-ready") setReady(true);
    };
    addEventListener("message", heard);
    return () => removeEventListener("message", heard);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const config = { v: 1, widget_id: widgetId, ...look };
    frame.current?.contentWindow?.postMessage({ ucp: 1, type: "preview", config, scheme: shown }, location.origin);
  }, [ready, look, shown, widgetId]);

  return (
    <figure className="preview">
      <div className="panel">
        <iframe ref={frame} src="/preview" title={t.previewTitle} tabIndex={-1} />
      </div>
      <figcaption>
        <span>{t.previewCaption}</span>
        {(look.color_scheme === "auto" || !look.color_scheme) && (
          <span className="toggle" role="group" aria-label={t.previewScheme}>
            {(["light", "dark"] as const).map((one) => (
              <button key={one} type="button" className="quiet" aria-pressed={scheme === one} onClick={() => setScheme(one)}>
                {t.schemes[one]}
              </button>
            ))}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
