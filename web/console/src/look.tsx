// The Look station (M9-T3): how the chat looks on the customer's pages, beside a live preview that is the chat
// itself (web/widget, at /preview on the console's own address), sent the draft's settings as they are typed.
// Colours are judged with the same rules the loader and the chat use (@ucp/protocol/brand).
import { contrast, inkOn, isColor } from "@ucp/protocol/brand";
import { useEffect, useRef, useState } from "react";

import { call } from "./api";
import { Field } from "./editors";
import { strings as t } from "./strings";

export type Look = {
  title?: string;
  welcome_message?: string | null;
  suggested_prompts?: string[];
  ai_notice?: string | null;
  brand_color?: string;
  logo_url?: string | null;
  avatar?: string | null;
  greeting?: string | null;
  color_scheme?: "light" | "dark" | "auto";
  launcher_position?: "bottom-right" | "bottom-left";
  history_enabled?: boolean;
  attachments_enabled?: boolean;
};

const LIGHT = "#ffffff"; // the chat's composer, where the send button sits, in the light scheme
const NIGHT = "#30302e"; // and in the dark
const QUESTIONS = 4;
const SIDE = 256; // px: the picture as stored, twice the largest place it is shown

/** A picture as the launcher shows it: cropped to a centred square, SIDE px, as WebP where the browser can make it
 *  (JPEG elsewhere). Drawn on a canvas, so whatever was chosen, even an SVG, is sent as plain pixels. */
export async function squared(file: File): Promise<Blob> {
  let read = await new Promise<string>((done, fail) => {
    const reader = new FileReader(); // a data: address, which the console's content policy allows for images
    reader.onload = () => done(String(reader.result));
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml") {
    // An SVG with only a viewBox has no size of its own, so it is given SIDE square to draw at.
    const sized = (await file.text()).replace(/<svg\b([^>]*)>/, (whole, attributes: string) =>
      /\swidth=/.test(attributes) ? whole : `<svg width="${SIDE}" height="${SIDE}"${attributes}>`,
    );
    read = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  }
  const image = new Image();
  image.src = read;
  await image.decode();
  const [width, height] = [image.naturalWidth || SIDE, image.naturalHeight || SIDE];
  const side = Math.min(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIDE;
  canvas.getContext("2d")?.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  const as = (type: string, quality: number) => new Promise<Blob | null>((done) => canvas.toBlob(done, type, quality));
  const webp = await as("image/webp", 0.86);
  const picture = webp?.type === "image/webp" ? webp : await as("image/jpeg", 0.88);
  if (!picture) throw new Error("the picture could not be drawn");
  return picture;
}

/** Uploads a picture to the tenant's images; answers its digest. */
export async function upload(tenant: string, file: File): Promise<string> {
  const { digest } = await call<{ digest: string }>("POST", `/tenants/${tenant}/images`, await squared(file));
  return digest;
}

/** What the button colour does on the chat: the text on it, and how it stands out in each scheme. */
export function colourNotes(colour: string): { text: string; warnings: string[] } {
  if (!isColor(colour)) return { text: "", warnings: [t.colourRule] };
  const ink = inkOn(colour);
  const text = t.textOn(ink === "#ffffff" ? t.white : t.black, contrast(colour, ink).toFixed(1));
  const warnings = [];
  if (contrast(colour, LIGHT) < 3) warnings.push(t.faintOnLight); // WCAG's line for a control
  if (contrast(colour, NIGHT) < 3) warnings.push(t.creamOnDark);
  return { text, warnings };
}

export function LookEditor(props: {
  value: Look;
  tenant: string;
  signedIn: boolean;
  onChange: (look: Look) => void;
  readOnly: boolean;
}) {
  const { value, tenant, signedIn, onChange, readOnly } = props;
  const [picturing, setPicturing] = useState<"sending" | "failed" | null>(null);
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
                  while (next.length && !next.at(-1)) next.pop(); // an emptied question keeps its place; saving drops it
                  change({ suggested_prompts: next });
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
              value={isColor(colour) ? colour.toLowerCase() : "#1f1e1d"}
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
      <Field label={t.picture} hint={t.pictureHint}>
        {(id) => (
          <div className="inline picture">
            <span className="avatar" aria-hidden="true">
              {value.avatar && <img src={`/v1/images/${value.avatar}`} alt="" />}
            </span>
            <input
              id={id}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = ""; // the same file can be chosen again
                if (!file) return;
                setPicturing("sending");
                upload(tenant, file).then(
                  (avatar) => {
                    setPicturing(null);
                    change({ avatar });
                  },
                  () => setPicturing("failed"),
                );
              }}
            />
            <label htmlFor={id} className="secondary">
              {value.avatar ? t.replacePicture : t.choosePicture}
            </label>
            {value.avatar && (
              <button type="button" className="quiet" onClick={() => change({ avatar: null })}>
                {t.removePicture}
              </button>
            )}
            <p className={picturing === "failed" ? "problem" : "hint"} role="status">
              {picturing === "sending" ? t.sendingPicture : picturing === "failed" ? t.pictureFailed : ""}
            </p>
          </div>
        )}
      </Field>
      <Field label={t.greeting} hint={t.greetingHint}>
        {(id) => (
          <input
            id={id}
            type="text"
            maxLength={120}
            value={value.greeting ?? ""}
            onChange={(event) => change({ greeting: event.target.value || null })}
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
      <label className="check">
        <input
          type="checkbox"
          checked={Boolean(value.attachments_enabled)}
          onChange={(event) => change({ attachments_enabled: event.target.checked })}
        />
        <span>{t.attachments}</span>
      </label>
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
    const config = { v: 1, widget_id: widgetId, ...look, suggested_prompts: look.suggested_prompts?.filter(Boolean) };
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
