import { createContext } from "react";

/** The answer's own Markdown, for a block that needs the rest of it: whether a fence has closed, what a table's
 *  chart should be. */
export const Source = createContext("");
