import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { startUpdates } from "./lib/update";
import App from "./App";
import { useStore } from "./store/store";
import "./styles.css";

startUpdates();

// Dev-only handle for browser tests and debugging.
if (import.meta.env.DEV) (window as unknown as { __mindgrove: typeof useStore }).__mindgrove = useStore;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
