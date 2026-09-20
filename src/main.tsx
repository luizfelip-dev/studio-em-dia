import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "../app/globals.css";

const reloadGuardKey = "studio-em-dia:asset-reload";

function recoverFromOutdatedAssets(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) return;
  if (sessionStorage.getItem(reloadGuardKey) === "1") {
    sessionStorage.removeItem(reloadGuardKey);
    return;
  }
  sessionStorage.setItem(reloadGuardKey, "1");
  window.location.reload();
}

window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  recoverFromOutdatedAssets(event.payload);
});
window.addEventListener("unhandledrejection", (event) => recoverFromOutdatedAssets(event.reason));
window.addEventListener("load", () => window.setTimeout(() => sessionStorage.removeItem(reloadGuardKey), 5_000), { once: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
