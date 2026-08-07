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

Hand-rolled, dependency-free, three passes, each one earned by a failure
from a real phone photo.

**First, EDGES — the way document scanners see** (the architecture mirrors
what the decompiled Clear Scanner runs on OpenCV, hand-rolled here in a few
kilobytes). True **Canny** — Gaussian smoothing, Sobel gradients, non-maximum
suppression, double threshold with hysteresis (capped, so a page dense with
print cannot raise the bar past its own boundary) — plus a **coarse
percentile edge map** as a second generator (fat bands bridge text gaps
where Canny starves). Both feed one Hough transform (2°/2 px) whose peaks
are extracted separately for near-horizontal and near-vertical lines (text
baselines cannot monopolize the slots); quads assemble from near-parallel
line pairs and are scored by cues a real document boundary has and impostors
lack: perimeter **edge support** (per side, so a missing side sinks the
quad); a **brightness step** downward when crossing outward on at least
three sides (an inner printed box and a floor seam step nowhere — such FLAT
sides are punished hard; a side onto a white shoe may step up and still be a
boundary); a **margin brighter than the scene's median** just inside every
side (relative, because a shadowed indoor sheet and a sunlit one share no
absolute number); **saturating area** (the document is the largest
boundary-consistent quad — but growth must be earned by support); **corner
finality** — a side whose line keeps riding on edges beyond its corners is a
line cut out of something longer; and **corner arrival** — both edges must
REACH each corner, so a slanted line that floats off the sheet fails at its
fake corner. The winner then competes with the color families below under
one score, and families that agree (intersection-over-union ≥ 0.75) vouch
for each other — Clear Scanner's own fusion pattern. This pass cuts handheld
sheets out of cluttered rooms — hands, keyboards, glare floors, white shoes,
and pages dense with print.

**Second, COLOR** (edges too faint, hue still separates): the background's
chromaticity is learned from the frame's border ring as **up to two
clusters** (two-means — a table often wears two lights, shade and a
sun-washed band; a single median lets the washed band bleed into the sheet).
Every pixel scores by distance to the nearest cluster, Otsu splits the
scores. A second cluster must own ≥10% of the ring and sit measurably apart,
so a sheet corner grazing the border cannot hijack the background model.

**Third, BRIGHTNESS** (a bright sheet on a dark neutral table): plain Otsu.
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
lands near 1600 px (never upscaled far beyond the photo), plus a ~256 px
thumbnail for the atlas — a few hundred KB per scan at phone resolutions.

### Encoding, after the compression review (act 1.6)

Measured on fixtures (a smooth gradient beside saturated ink on paper, and
the same with camera grain): within LOSSY WebP, raising quality 0.82 → 0.95
pays 2.4–3.6× the bytes on a photo (170 → 400 → 609 KB at 1333×1600) while
the visible artifacts barely move — ink-stroke fringing (max channel error
~91/255) and mild gradient banding (213/249 preserved transitions) come from
chroma subsampling, which no lossy quality removes. Lossless WebP (q=1.0) is
pixel-perfect and, on FLAT drawn content, comparably small (32 KB on the
fixture) — but explodes on photographs (1.6 MB). So the encoder looks before
it chooses: content whose flat-pixel ratio passes 0.3 tries lossless and
keeps it while it costs at most 2× the lossy encoding; photographs stay at
q0.82; JPEG 0.85 remains the fallback where the canvas cannot encode WebP.
**Import as is** (a capture-step checkbox, for exports whose borders are
already the image borders) bypasses the pipeline entirely: up to a 4096 px
longest edge (the mobile canvas display ceiling) the file is stored BYTE
FOR BYTE — the true zero-loss path for digital mapmaking exports; beyond
it, the downscale-and-encode pipeline takes over.

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

### The timeline (act 1.5)

The map at time T is **derived, never stored**: for each panel, the newest
scan with `created <= T` (`db.mapAt`, pure, unit-tested). The atlas carries a
timeline bar whose stops are the map's **actual updates, equally spaced** —
one stop per scan moment (`db.timelineStops`), never wall-clock distance —
with the last stop being now; scrubbing repaints the derivation, and the
past wears the Simulator's viewing-the-past colors. A play button walks the
stops automatically (0.5 s per update by default; 0.05–2 s presets on the
profile's Playback page, persisted). A **bookmark is a name on a
timestamp** — `{id, mapId, name, at}`, nothing more: ticks on the bar at
their stop, chips beneath it, tap to seek; deleting one deletes a name,
never a scan. Notes stay editable after save (the one after-save mutation a
scan allows). Rotate joined the Corners stage: a repeatable quarter turn of
the working image, the quad riding along. Tapping an empty panel on the
atlas opens the scan flow with that coordinate preset. Act 1.6 added the
Light stage's third slider — **temperature**, a plain opposed red/blue shift
that rescues yellow evening light, no auto magic — and **re-tagging**: a
panel's whole history moves to another coordinate from its detail view, all
versions together in one transaction; an occupied target asks whether the
two histories should become one, ordered by time.

**Click-to-add** offers every open position that shares a side with a
panel — the atlas draws the bounding box plus one ring, so a map grows
outward along its edges, not only into its own notches ([grid.ts](src/digitalizer/grid.ts),
pure and unit-tested, and it steps over the coordinate grid's missing zero
column: the position west of N1/E1 is N1/W1). Positions that were offered
before stay offered; diagonal-only neighbours are not, and hold the grid's
shape in silence.

**Merging is never the default action.** Moving a panel onto an occupied
coordinate only ever raises the question: the button that asked it is
replaced, the safe answer ("Choose another coordinate") takes the primary
slot where the finger already is, and the merge sits apart, marked. The
confirmation names both coordinates and how many versions each holds. Every
merge then stays **undoable for the rest of the session** — the storage
layer reports exactly which scans moved, so the undo puts back those and
never the resident ones (in memory, newest first; it does not outlive the
tab).

### What the straighten path used to do to the light (act 1.7)

A tester found that a digitally-made panel came out darker through
crop-and-straighten while "import as is" was faithful. It was true, and the
cause was one line: the rectified image's **automatic levels became the
default**, sliders at zero. Measured on a synthetic digital panel, the
default curve was a 2%/98% percentile stretch (lo=40, hi=241) that moved
every value — −40 at its worst — darkening mid-tones (90 → 63, 130 → 114,
150 → 140) while clipping paper to white (242 → 255). End to end, the
tester's mid-tone field lost up to 37 levels per channel and the paper
clipped: **(242,239,230) → (255,255,243)** and **(150,165,130) →
(123,146,93)**. Now the straighten path's default is exactly identity, so
straightening changes geometry only, and the same panel comes back
**(242,239,230)** and **(150,165,130)** — value for value. Automatic levels
did not disappear; they are what the Auto-fix button applies, deliberately.

The same investigation covered the exposure slider, which bleached paper
texture: it was a linear offset (`x += e`), so every highlight landed on the
same 255 — seven distinct texture levels collapsed to **one**. Exposure is
now a gamma curve, which holds both ends fixed and compresses what is
between them: at +60 the same seven levels stay **seven**, nothing clips,
and for gentle moves the curve matches the old offset within a level or two
— it only ever differed at the extremes, which is where it was wrong.

The Light stage also carries **Auto-fix** — the scanner look, one button,
never automatic without it. It estimates the slowly-varying illumination per
channel (shrink → blur → grow: the paper, the light, the cast) and divides
it out, so the paper itself defines white: a yellow evening, a shadow band,
and a vignette flatten in one move while ink keeps its color, because ink
differs from its local background. The sliders stack on top of the fixed
image; toggling off returns the original exactly.

### The profile

The header's `≡` opens the profile — the app's general menu and the future
home of act two's account. Two pages today: **Playback** (the timeline
speed) and **Maps** — create, rename, and delete maps (a two-step
confirmation naming the map and its scan count; deletion takes the map's
scans and bookmarks with it, in one transaction), plus the backup archive
(export current map or all, restore) which lives here and nowhere else.

### The whole-map PNG

Panels stitched at their map coordinates with a 1 px gap (app background, or
transparent by checkbox), each cell the map's **median scan aspect**, every
scan contain-fitted. Two qualities: low (thumbnails, instant) and high (full
scans, drawn one at a time). **The export honors the timeline position** —
the file is the map as it was at the selected moment, and the filename
carries the map name plus, when standing on a bookmark, its name. The
output's longest edge is capped at **4096 px**: iOS Safari's canvas ceiling
is ~16.7 million pixels (4096²) — the binding constraint among mobile
engines — so any output within the cap is safe everywhere; when the cap
engages the app says so under the export button.

### The backup archive

One ZIP (a dependency-free STORE-method writer in
[src/digitalizer/zip.ts](src/digitalizer/zip.ts)): every scan and thumbnail
blob byte-for-byte, plus `manifest.json` — maps, scan metadata, bookmarks,
archive version. **The manifest is the storage interface serialized**, and
the round trip is act two's migration rehearsal. Import validates the
manifest, restores into a **new** map (never a silent merge; the original
name is kept unless taken, then suffixed `(restored)`), preserves timestamps
and notes, remints ids, and refuses corrupt input with a sentence — in one
transaction, so a broken archive restores nothing.

### The share target: assessed and declined (for now)

A PWA `share_target` (photo shared from the gallery straight into the scan
flow) requires a `POST` handler inside the service worker. This app's worker
is *generated* (`vite-plugin-pwa` `generateSW`); shipping the handler means
switching to a hand-written worker (`injectManifest`), which touches the
tested update-prompt flow — and iOS Safari does not support `share_target`
at all, so half the phones gain nothing. A flaky share path is worse than
none: skipped, deliberately, until a conversation owns the worker rewrite.

### Tests

Unit (node): the quad math and the aspect recovery against a synthetic pinhole
camera; the warp/levels/adjust raster core on fixtures; border detection on
drawn frames; the storage layer's CRUD, version ordering, map scoping, and the
default-coordinate rule (E, S, W, N; no zero row or column) on fake-indexeddb.
camera; the warp/levels/adjust raster core, rotation included; the derived
timeline rule at t1 < t2 < t3; the zip container (round trip, a deflated
entry, hostile input); the stitch geometry with its cap; the storage layer's
CRUD, version ordering, bookmarks, the archive round trip with its
atomicity, and the v1 → v2 upgrade with data intact — all on fixtures.
E2e (Playwright, desktop + a phone-viewport project): detection lands near a
projected fixture's known corners; the manual drag path completes (mid-edge
handles and the loupe included); a sideways fixture becomes an upright scan
through Rotate; the rectified proportions match the fixture's true ones;
save → atlas → reload → still there; a second scan becomes the newest with
the first as history; the note round-trips save, reload, and an edit;
scrubbing the timeline shows the older face and bookmarks seek without
touching scans; the export honors the timeline (pixel-probed at a bookmark),
lands known coordinates in known cells with 1 px gaps, and its cap engages
on an oversized map without crashing; the archive round-trips byte-identical
blobs (SHA-256-compared) into a new map; deletion confirms with no promise
of recovery; the detector chunk loads only on first use.

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
