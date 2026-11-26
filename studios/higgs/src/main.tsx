import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Studio } from "./studio/store.ts";
import { StudioProvider } from "./studio/context.tsx";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/panel.css";
import "./styles/feed.css";
import "./styles/pages.css";

const studio = new Studio();
studio.start();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudioProvider studio={studio}>
      <App />
    </StudioProvider>
  </StrictMode>,
);
