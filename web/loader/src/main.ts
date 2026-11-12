// Build entry: runs the loader on the page that included it.
import { start } from "./index";

start(document.currentScript as HTMLScriptElement | null, window);
