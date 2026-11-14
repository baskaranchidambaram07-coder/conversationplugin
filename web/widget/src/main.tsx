import "@fontsource-variable/nunito";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// The gateway serves this page at /embed/{widgetId} (M4-T3); the admin console's preview at /preview (M9-T3).
const widgetId = /^\/embed\/([A-Za-z0-9_-]{1,64})$/.exec(location.pathname)?.[1] ?? "";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App widgetId={widgetId} preview={location.pathname === "/preview"} />
  </StrictMode>,
);
