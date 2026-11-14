import { type RefObject, useLayoutEffect, useState } from "react";

/** An element's width, measured and kept up to date. Drawings are sized by it, because the chat's content policy
 *  allows no inline style to size them by. `ready` re-measures once the element exists. */
export function useRoom(frame: RefObject<HTMLElement | null>, ready: unknown) {
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    setRoom(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setRoom(element.clientWidth));
    watch.observe(element);
    return () => watch.disconnect();
  }, [frame, ready]);
  return room;
}
