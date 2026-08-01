# apps/pwa — the app PWA (`jm-pwa`)

Two screens, with navigation between them:

* the **Simulator** — config + deck editor, a worker-run engine, the canvas map
  in the canonical palette, the filterable record, and local save/load/export;
* **My map** — the digitalizer (act one): the digital version of the player's
  own physical map, scanned panel by panel like a document scanner and browsed
  as an atlas. Local-only by design; act two (sync) attaches behind the storage
  interface described below.

TypeScript throughout; every user-facing string lives in
[src/strings.ts](src/strings.ts), and the display name is the **single display
constant** there (CONTRACTS §10). The vocabulary law (§1) and the coordinate
convention (§2) bind both screens.

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

## My map — the digitalizer, act one

The scan flow: photograph (camera capture or gallery) → the four crop vertices
(auto-detected, always draggable) → perspective rectification → scanner-style
contrast/exposure (auto levels + a manual slider pair) → coordinate, note,
save. The atlas shows each panel's newest scan on a pinch-zoomable grid, gaps
visible; a panel's detail keeps every scan as history, newest first. Deleting
asks first, and the wording promises exactly what act one can do: gone here is
gone.

### Border detection — the choice and its size

Hand-rolled, dependency-free, two passes. First, COLOR: the table's
chromaticity is estimated from the frame's border ring (median), every pixel
is scored by its chromatic distance from that background, and Otsu splits the
scores — chromaticity survives what brightness does not: white paper on a
light wooden table, and the soft shadow band a phone at a table always casts.
Second, when color finds nothing (a neutral-colored dark table): the plain
brightness threshold. Both passes end the same way: morphological cleanup →
largest connected component → convex hull → maximum-area quad, validated
against a real invoice-on-light-wood photo and locked in by a synthetic
wood-and-shadow fixture in the unit and e2e suites.
It lives in [src/digitalizer/detect.ts](src/digitalizer/detect.ts) behind a
dynamic import, so it builds to its **own lazy chunk: ~3.6 KB (~1.5 KB gzip)**
— loaded on first use of the scan screen, never with the app shell, and
precached by the service worker so scanning works offline after the first
load. A vision library (OpenCV-class, megabytes of WASM) was considered and
declined: detection here is a convenience, not a correctness requirement — the
vertices are always draggable, and a failed detection just presents a sensible
default quad. If real-world paper defeats the threshold heuristic, the module
boundary is where a heavier detector would slot in, under the same lazy-load
law.

### Size-agnostic rectification

The scanner declares no panel size. The true proportions of the photographed
rectangle are recovered from the photo itself (Zhang–He whiteboard-scanning
estimation: principal point at the image center, focal length from the two
vanishing points; exact affine ratio for parallelograms; a naive side-length
fallback when the estimate degenerates). The rectified output's longest edge
lands near 1600 px (never upscaled far beyond the photo), encoded WebP q0.82
with a JPEG fallback where the canvas cannot encode WebP, plus a ~256 px
thumbnail for the atlas — a few hundred KB per scan at phone resolutions.

### The storage interface (what act two is reviewed against)

[src/digitalizer/db.ts](src/digitalizer/db.ts) is the whole storage law:
IndexedDB (`jm-digitalizer`), Blobs stored natively — never localStorage,
never base64. Stores:

* `maps` — `{id, name, created}`: the minimal multi-map model. A default map
  is auto-created on first use; every scan belongs to exactly one map; the
  atlas and the coordinate picker operate within the current map.
* `scans` — `{id, mapId, tx, ty, created, note, sync, mime, width, height,
  bytes, image: Blob, thumb: Blob}`. `id` is a local uuid; `sync` is always
  `"local"` in act one and is the field a sync layer moves through
  `queued → sent` without touching callers. Versions of a panel are simply
  its scans ordered by `created`, newest first.
* `outbox` — empty in act one, present on purpose: act two enqueues every
  mutation here and drains it against the backend.
* `settings` — the current map id and the recorded persistent-storage answer.

Every mutation of the archive goes through this module and nowhere else.
Persistent storage is requested once, on the first save, and the granted or
denied answer is surfaced in the footer (`persistent` / `best effort`), never
as a blocking dialog. Storage failures are typed (`unavailable`, `quota`,
`failure`) and each lands as a sentence on the screen: private-mode IndexedDB,
a full disk, and an unreadable photo are notices, never aborts.

### Tests

Unit (node): the quad math and the aspect recovery against a synthetic pinhole
camera; the warp/levels/adjust raster core on fixtures; border detection on
drawn frames; the storage layer's CRUD, version ordering, map scoping, and the
default-coordinate rule (E, S, W, N; no zero row or column) on fake-indexeddb.
E2e (Playwright, desktop + a phone-viewport project): detection lands near a
projected fixture's known corners; the manual drag path completes; the
rectified proportions match the fixture's true ones; save → atlas → reload →
still there; a second scan becomes the newest with the first as history;
deletion confirms with no promise of recovery; the detector chunk loads only
on first use.

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
