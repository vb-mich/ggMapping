import path from "node:path";
import { fileURLToPath } from "node:url";

import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// The manifest derives from the one display constant (CONTRACTS §10).
import { DISPLAY_NAME } from "./src/strings";
import { CHROME } from "./src/contracts/palette";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: DISPLAY_NAME,
        short_name: DISPLAY_NAME,
        id: "jm-pwa",
        start_url: ".",
        display: "standalone",
        background_color: CHROME.background,
        theme_color: CHROME.panelBorder,
        icons: [
          { src: "icons/jm-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/jm-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,png,webmanifest}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { "@engine": path.resolve(here, "../../engine/wasm/dist/web") },
  },
  server: {
    fs: { allow: [path.resolve(here, "../..")] },
  },
  build: { target: "es2022" },
  worker: { format: "es" },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
