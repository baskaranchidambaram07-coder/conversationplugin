// The shared full-screen viewer (M3-T9): a table, chart, diagram or file over the whole chat, with zoom. A floating
// panel is asked to fill the window while it shows, and goes back when it closes. It is the native modal dialog, so
// focus stays inside it and Escape closes it; focus then returns to the button that opened it.
import { type CSSProperties, type KeyboardEvent, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import { Frame, InViewer } from "./frame";
import { Icon } from "./Icon";
import { strings as t } from "./strings";

export const GROW = "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7";
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const ACTUAL = ZOOMS.indexOf(1);

/** The quiet "Full screen" action in a block's tools; nothing inside the viewer itself. */
export function FullScreen({ onOpen }: { onOpen: () => void }) {
  if (useContext(InViewer)) return null;
  return (
    <button
      type="button"
      className="quiet"
      aria-haspopup="dialog"
      // Safari does not focus a button on a click; focused, it is where the viewer gives focus back.
      onClick={(event) => (event.currentTarget.focus(), onOpen())}
    >
      <Icon path={GROW} />
      {t.fullScreen}
    </button>
  );
}

/** `zoomable` is false for what already redraws to fill the viewer, as a chart does; `actions` sit in the bar before
 *  the zoom (a file's Save). */
export function Viewer(props: { title: string; onClose: () => void; zoomable?: boolean; actions?: ReactNode; children: ReactNode }) {
  const { title, onClose, zoomable = true, actions, children } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useContext(Frame);
  const [zoom, setZoom] = useState(ACTUAL);

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const grew = frame.expandable && !frame.expanded;
    if (grew) frame.expand(true);
    if (element.showModal) element.showModal();
    else element.setAttribute("open", ""); // a browser (or test page) without modal dialogs
    return () => {
      if (grew) frame.expand(false);
      opener?.focus();
    };
  }, []);

  const by = (step: number) => setZoom((now) => Math.min(ZOOMS.length - 1, Math.max(0, now + step)));
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") return event.stopPropagation(); // the dialog closes; the chat stays open
    if (!zoomable || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = { "+": 1, "=": 1, "-": -1 }[event.key];
    if (step) by(step);
    else if (event.key === "0") setZoom(ACTUAL);
    else return;
    event.preventDefault();
  };
  const level = `${Math.round(ZOOMS[zoom]! * 100)}%`;

  return (
    <dialog
      ref={dialog}
      className="viewer"
      aria-label={title}
      onClose={onClose}
      onKeyDown={keys}
      style={{ "--zoom": ZOOMS[zoom] } as CSSProperties}
    >
      <header>
        <h2 dir="auto">{title}</h2>
        {actions}
        {zoomable && (
          <div className="zoom" role="group" aria-label={t.zoom}>
            <button type="button" className="icon" aria-label={t.zoomOut} disabled={zoom === 0} onClick={() => by(-1)}>
              <Icon path="M5 12h14" />
            </button>
            <button type="button" className="level" aria-label={t.zoomReset(level)} onClick={() => setZoom(ACTUAL)}>
              {level}
            </button>
            <button type="button" className="icon" aria-label={t.zoomIn} disabled={zoom === ZOOMS.length - 1} onClick={() => by(1)}>
              <Icon path="M12 5v14M5 12h14" />
            </button>
          </div>
        )}
        <button type="button" className="icon" aria-label={t.closeViewer} onClick={onClose}>
          <Icon path="M6 6l12 12M18 6 6 18" />
        </button>
      </header>
      <div className="viewing">
        <InViewer.Provider value={true}>{children}</InViewer.Provider>
      </div>
    </dialog>
  );
}
