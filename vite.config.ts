import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// BASE_PATH lets the GitHub Pages workflow serve from /<repo>/.
const base = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Mindgrove",
        short_name: "Mindgrove",
        description: "A living tree of your thoughts.",
        theme_color: "#05070c",
        background_color: "#05070c",
        display: "standalone",
        start_url: base,
        scope: base,
        // Android/ChromeOS: "Share → Mindgrove" drops the shared text in as a seed.
        share_target: { action: base, method: "GET", params: { title: "title", text: "text", url: "url" } },
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    // three.js lives in the lazily loaded Canopy chunk.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
} as never);
