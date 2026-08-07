# jerrymapping-app

The Jerrymapping mono-repo: a byte-exact digital lineage of the vbDeck system
(`docs/books/0-Jerrymapping-the-game.md`, beta 0.1).

**The law of this repo is [docs/CONTRACTS.md](docs/CONTRACTS.md).** Every component —
engine, apps, tools — conforms to it: the state schema, the Decider interface, the
event stream, the coordinate convention, and the PCG32 contract.

## Succession (v0.4-succession)

The full oracle matrix went green in native **and** WASM, so per CONTRACTS §8.4 the
succession is enacted, tagged `v0.4-succession`:

* **The C++ engine (`/engine`) is the reference implementation of record.**
* **`reference/sim.py` is frozen as the founding document** — history, not oracle;
  it keeps defining the v0.4 lineage's byte-exact behavior as written.
* **The three-way identity gate (Python, native, WASM) remains in CI permanently**
  as the twin-implementation review: every rules change lands in the Python twin
  and the C++ engine together and must pass the matrix byte-identically. The
  current twin is `reference/sim_v10.py` (lineage **v0.10** — the depth
  erratum and the rename ledger, Add Panel as the working panel, the fields as
  canon, the community's deck, and the **Great Ridge floor**: its length range
  is 5..10, so it can no longer come out shorter than a lucky Ridge). Earlier
  lineages' fixtures live in `reference/history-v0.4/`, `history-v0.5/`,
  `history-v0.7/`, `history-v0.8/` and `history-v0.9/`.

## Layout

| path | what |
|---|---|
| `docs/` | the fork notes, **CONTRACTS.md**, and the books under `docs/books/` |
| `reference/` | the frozen Python v0.4 founding document (`sim.py`) and its seed-42 sample log — history; the oracle role passed to `/engine` at succession |
| `engine/` | the C++20 headless engine, its CLI, and tests (no floats, no globals) |
| `engine/wasm/` | Emscripten bindings, the Node identity harness, and `prebuilt/` — the **committed** web-flavor engine the app ships, so static hosts build without emsdk (CI asserts it matches the sources) |
| `apps/pwa/` | the PWA shell (`jm-pwa`): the Simulator (config, deck editor, worker-run engine, canvas map, record, local files), My map (the digitalizer), and the Rulebook — a library of the game's books (the distilled Player's Handbook, default, and the Master Manual the simulator is built from), each rendered from its own file in `docs/books/` imported at build time, so the deployed app ships the exact books this repo carries. Books are listed explicitly in `src/rulebook/book.ts` — never globbed — so an internal document can't leak into the player app; adding a book is one import and one entry, and per-book identity/outline/figure tests cover it automatically. Parser: `marked` (+`github-slugger` for GitHub-identical anchors) — ~12.6 KB gzip of the reader's lazy chunk (30.7 KB gzip total with the book text and screen); chosen over `markdown-it` (~3× the gzip) since GFM tables are core in both and the sanitization edge is moot for a trusted build-time import. The reader chunk loads only on the Rulebook route; the shell bundle stays book-free (asserted in `tests/bundle.test.ts`), ~39.4 KB gzip. The book's figures ship from `docs/books/img/` (Obsidian `![[name\|width]]` embeds resolved at build time; `tests/book-images.test.ts` fails CI on a reference without its file), ~2.3 MB of images emitted with the reader's assets and precached for offline reading. |
| `tools/dice/` | the dice roller (stub — future conversation) |
| `tools/helper/` | the helper tool: decision records and re-rolls (stub — future conversation) |
| `tools/digitalizer/` | the map digitalizer (stub — future conversation) |
| `scripts/` | the identity-gate harness (Python vs native vs WASM) |

## The gate

Cross-language byte-identity over the oracle matrix (CONTRACTS §8), nine cells: seeds
11/42/303 at 20 eras, seed 42 at 40 eras, four single-dial cells at seed 42/20 eras,
and the combined-dials cell (all four dials at once). CI runs the full matrix — the
Python twin (`reference/sim_v10.py`) vs native C++ vs WASM — on every commit,
permanently (see Succession above). An experimental dial (CONTRACTS §11) would add
its own cells, reported separately and never mixed into the canon result; none is
live — the fields dial was promoted into canon in v0.8 and removed.

## Building

Native (any C++20 compiler; no dependencies):

```
g++ -std=c++20 -O2 -o jerrymap engine/cli/main.cpp engine/src/*.cpp -Iengine/include
```

Tests, WASM, and the identity harness: see `engine/README.md` and
`scripts/run_gate.py`. The app itself needs no toolchain beyond Node — it
consumes the committed engine at `engine/wasm/prebuilt/`; after an engine
change, `bash engine/wasm/build.sh web` refreshes it (commit the result — the
browser-smoke fails CI if the artifact lags the sources).
