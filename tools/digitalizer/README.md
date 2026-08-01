# tools/digitalizer — the panel digitalizer

**Act one ships as the My map screen of the PWA** — see
[apps/pwa](../../apps/pwa/README.md#my-map--the-digitalizer-act-one). The
player photographs a worked panel; the app detects the borders (four
always-draggable vertices), rectifies the perspective, adjusts contrast and
exposure, and files the scan by panel coordinate (CONTRACTS §2) with every
earlier scan kept as history. Local-only: IndexedDB, no backend, no network.

The storage interface in
[apps/pwa/src/digitalizer/db.ts](../../apps/pwa/src/digitalizer/db.ts) is the
seam the next acts build on (local ids, a sync status per scan, an outbox
store, a minimal multi-map model):

* **Act two — sync**: accounts and cloud copies of the archive behind that
  interface, without changing its callers.
* **Later, the original ambition**: recognition — turning scans into world
  state (units, elevations, people overlays, anomaly marks) emitting documents
  in the CONTRACTS §6 state schema, so a digitalized world loads into the
  engine like any saved one. Nothing in act one prejudges this; the canonical
  rectified scans are exactly what a recognizer would consume.
