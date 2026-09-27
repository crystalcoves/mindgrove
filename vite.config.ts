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
        // Android/ChromeOS: "Share → Mindgrove" drops shared text in as a seed, and
        // transcribes a shared voice note (e.g. from WhatsApp or a recorder app).
        // public/share-target-sw.js receives the POST.
        share_target: {
          action: `${base}share-target`,
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
            files: [{ name: "audio", accept: ["audio/*", ".m4a", ".mp3", ".wav", ".ogg", ".opus", ".aac", ".amr", ".webm", ".flac"] }],
          },
        },
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["share-target-sw.js"],
        importScripts: ["share-target-sw.js"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The speech-to-text library (voice notes) is fetched on first use; keep it for offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(@huggingface|onnxruntime-web|@huggingface\/(jinja|tokenizers))/,
            handler: "CacheFirst",
            options: { cacheName: "transformers-lib", expiration: { maxEntries: 20 } },
          },
        ],
      },
    }),
  ],
  // `npm run server` serves the API on :8080; the dev server forwards /api to it.
  server: { proxy: { "/api": "http://localhost:8080" } },
  build: {
    // three.js lives in the lazily loaded Canopy chunk.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
} as never);
