import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { installBrowserPreviewBackend } from "./preview/browserPreviewBackend";
import "./styles/tokens.css";
import "./styles/reset.css";
import "./styles/primitives.css";
import "./styles/app-shell.css";
import "./styles/utilities.css";
import "./app/app.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("KYSTUDY_ROOT_ELEMENT_MISSING");
}

installBrowserPreviewBackend();

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
