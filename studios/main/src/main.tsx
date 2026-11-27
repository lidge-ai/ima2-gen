import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createStudioClient } from "@ima2/studio-kit";
import { App } from "./App.tsx";
import { Studio } from "./studio/store.ts";
import { StudioProvider } from "./studio/context.tsx";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/panel.css";
import "./styles/feed.css";
import "./styles/pages.css";

/** Same id the classic UI stores, so favorites are shared between the two UIs. */
function browserId(): string {
  const existing = localStorage.getItem("ima2.browserId");
  if (existing) return existing;
  const id = Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
  localStorage.setItem("ima2.browserId", id);
  return id;
}

// The session id keeps the studio's first name: the server files this studio's jobs under it, and a new id would hide earlier jobs.
const studio = new Studio(createStudioClient({ browserId: browserId(), sessionId: "studio-higgs" }));
studio.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioProvider studio={studio}>
      <App />
    </StudioProvider>
  </StrictMode>,
);
