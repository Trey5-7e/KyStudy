import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import "./app/app.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("KYSTUDY_ROOT_ELEMENT_MISSING");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
