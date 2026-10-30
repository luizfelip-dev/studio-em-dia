import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { supabaseConnectSources } from "./src/lib/studio-environment.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const connectSources = supabaseConnectSources(env.VITE_SUPABASE_URL, env.VITE_APP_ENV);
  return {
  base: "./",
  plugins: [react(), {
    name: "studio-environment-csp",
    transformIndexHtml: (html) => html.replace("__STUDIO_CONNECT_SOURCES__", connectSources),
  }],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  };
});
