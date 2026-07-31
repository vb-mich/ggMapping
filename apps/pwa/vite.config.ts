import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import preact from "@preact/preset-vite";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

// The manifest and the static page title derive from the one display
// constant (CONTRACTS §10) at build time.
import { DISPLAY_NAME, STRINGS } from "./src/strings";
import { CHROME } from "./src/contracts/palette";

const here = path.dirname(fileURLToPath(import.meta.url));

const pkg = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8"));
let sha = "local";
try {
  sha = execSync("git rev-parse --short HEAD", { cwd: here }).toString().trim();
} catch {
  // not a git checkout: keep "local"
}

export default defineConfig({
  define: { __JM_VERSION__: JSON.stringify(`${pkg.version}+${sha}`) },
  // Subpath hosting (e.g. GitHub Pages serves at /<repo>/): set JM_BASE there;
  // local dev and preview stay at the root.
  base: process.env.JM_BASE || "/",
  plugins: [
    preact(),
    {
      // The source index.html carries the neutral package id; the BUILT page's
      // static title is injected from the display constant (CONTRACTS §10).
      name: "jm-static-title",
      transformIndexHtml(html: string) {
        return html.replace(
          /<title>[^<]*<\/title>/,
          `<title>${DISPLAY_NAME} — ${STRINGS.tagline}</title>`,
        );
      },
    },
    VitePWA({
      registerType: "prompt",
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
        // prompt flow: never auto-activate a new worker, but do claim pages,
        // so the update button's controllerchange reload always fires
        skipWaiting: false,
        clientsClaim: true,
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
