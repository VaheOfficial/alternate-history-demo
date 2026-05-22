import React from "react";
import ReactDOM from "react-dom/client";
// Self-host Inter (variable). Bundled at build time — no runtime web fetch.
import "@fontsource-variable/inter";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
