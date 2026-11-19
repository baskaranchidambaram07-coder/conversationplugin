import { createContext } from "react";

/** What the chat's frame can do: fill the window (a floating panel on a large screen), and whether it does now. The
 *  full-screen viewer (Viewer.tsx) uses it; it lives apart so the chat's first load does not carry the viewer. */
export const Frame = createContext<{ expandable: boolean; expanded: boolean; expand: (on: boolean) => void }>({
  expandable: false,
  expanded: false,
  expand: () => {},
});

/** True inside the viewer, so a block drawn there shows whole and leaves out its own "Full screen". */
export const InViewer = createContext(false);
