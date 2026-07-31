# apps/pwa — the simulator PWA (`jm-pwa`)

The first screen of the app: the **Simulator** — config + deck editor, a worker-run
engine, the canvas map in the canonical palette, the filterable record, and local
save/load/export. TypeScript throughout; every user-facing string lives in
[src/strings.ts](src/strings.ts), and the display name is the **single display
constant** there (CONTRACTS §10).

## Framework choice

**Preact (with signals) on Vite, `vite-plugin-pwa` for the installable shell.**
Preact delivers a complete component model in ~4 KB gzipped — the whole framework
costs less than a tenth of the engine's WASM binary, honoring the small-footprint
constraint while keeping a mainstream, typed, testable component idiom (JSX,
hooks, and a first-class signals store that needs no extra state library). Vite
emits fully static output (no server rendering, no backend — the engine is
client-side WASM and all files stay local), gives module workers and WASM assets
first-class treatment, and its PWA plugin generates the manifest and offline
service worker from one config whose values derive from the display constant and
the canonical palette. The same toolchain drives the tests (Vitest for unit and
engine-smoke tests, Playwright for the e2e flows), so the app is testable at
every layer without a second build system.

## The rules boundary

The app speaks **only** the `jm_*` WASM API and the CONTRACTS surfaces:

* worlds are the §6 state schema — saved and loaded verbatim;
* the record is the §5 structured event stream; every log line shown is
  **engine-rendered text** carried on the events — the app only groups and
  filters (by era, age, panel);
* the map is drawn from **engine state** (never from log text) in the §2.4
  canonical palette, patina rule included;
* the deck editor edits the §6 config (per-kind copies, work averages, moods);
  the printed work numbers it shows come from an engine deck preview, and
  chapter 10's recommendations render as **soft warnings**, never blocks.

No rules logic in the app, ever. No network calls: everything is local.

## Building

The engine must exist first (built into `engine/wasm/dist/web/`):

```bash
bash ../../engine/wasm/build.sh web
```

Then:

```bash
npm install
npm run dev       # dev server
npm run build     # typecheck + static bundle in dist/
npm run test      # unit + engine smoke (needs the web engine built)
npm run e2e       # Playwright end-to-end (builds and serves the app)
```
