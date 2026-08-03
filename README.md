# jerrymapping-app

The Jerrymapping mono-repo: a byte-exact digital lineage of the vbDeck system
(`docs/0-Jerrymapping-the-game.md`, beta 0.1).

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
  current twin is `reference/sim_v09.py` (lineage **v0.9** — the depth erratum
  and the rename ledger, Add Panel as the working panel, the fields as canon,
  and the **community's deck** as the starting deck: 22 cards, Add Panel ×2
  joining at the end of era one). Earlier lineages' fixtures live in
  `reference/history-v0.4/`, `history-v0.5/`, `history-v0.7/` and
  `history-v0.8/`.

## Layout

| path | what |
|---|---|
| `docs/` | the handbook, the fork notes, and **CONTRACTS.md** |
| `reference/` | the frozen Python v0.4 founding document (`sim.py`) and its seed-42 sample log — history; the oracle role passed to `/engine` at succession |
| `engine/` | the C++20 headless engine, its CLI, and tests (no floats, no globals) |
| `engine/wasm/` | Emscripten bindings and the Node identity harness |
| `apps/pwa/` | the PWA shell (`jm-pwa`): the Simulator — config, deck editor, worker-run engine, canvas map, record, local files |
| `tools/dice/` | the dice roller (stub — future conversation) |
| `tools/helper/` | the helper tool: decision records and re-rolls (stub — future conversation) |
| `tools/digitalizer/` | the map digitalizer (stub — future conversation) |
| `scripts/` | the identity-gate harness (Python vs native vs WASM) |

## The gate

Cross-language byte-identity over the oracle matrix (CONTRACTS §8), nine cells: seeds
11/42/303 at 20 eras, seed 42 at 40 eras, four single-dial cells at seed 42/20 eras,
and the combined-dials cell (all four dials at once). CI runs the full matrix — the
Python twin (`reference/sim_v09.py`) vs native C++ vs WASM — on every commit,
permanently (see Succession above). An experimental dial (CONTRACTS §11) would add
its own cells, reported separately and never mixed into the canon result; none is
live — the fields dial was promoted into canon in v0.8 and removed.

## Building

Native (any C++20 compiler; no dependencies):

```
g++ -std=c++20 -O2 -o jerrymap engine/cli/main.cpp engine/src/*.cpp -Iengine/include
```

Tests, WASM, and the identity harness: see `engine/README.md` and
`scripts/run_gate.py`.
