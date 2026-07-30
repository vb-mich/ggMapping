# CONTRACTS.md — the shared law of jerrymapping-app

Contract version: **1.0.0** · State schema: **1** · Event schema: **1** · World lineage: **v0.4**

This document binds every conversation and every component of this mono-repo: the C++
engine, the WASM build, the PWA, the dice roller, the helper tool, and the digitalizer.
Nothing in `/engine`, `/apps`, or `/tools` may contradict it. Changes here bump the
contract version and must state their migration story.

Authority chain: `docs/0-Jerrymapping-the-game.md` (the handbook, beta 0.1) defines the
game; `docs/FORK_NOTES.md` defines this lineage's deltas and dials; `reference/sim.py`
(the frozen v0.4 oracle) defines byte-exact behavior until succession (§9). Where prose
and oracle disagree, the oracle wins until the fork notes say otherwise.

---

## 1. Vocabulary law

The words are **panel**, **age**, **era**, **rework**, **unit**, **rung**. The words
*tile* and *visit* are banned from every log line, event name, schema key, CLI surface,
and UI string, in any case. CI enforces this over the rendered log (§8.4). The card that
grows the map is **addpanel** end to end: config key, CLI flag, engine identifier, log
text.

Naming note carried from the oracle: the *completed* set is called `atlas` and the
*archived* set is called `binder` (§6). The log phrase for archival is
`panel N COMPLETE, to the Atlas` — that sentence is frozen by byte-identity and refers
to entering the **binder**. New surfaces (UI, tools) should say "archived" and keep
`atlas`/`binder` as the schema keys.

## 2. Coordinate convention

### 2.1 Panels
Panels live on a cartesian grid with **no zero row or column**: x grows East, y grows
North. A panel is `(tx, ty)` with `tx, ty ∈ {…,-2,-1,1,2,…}`. Its display name is
`{N|S}{|ty|}/{E|W}{|tx|}` — north/south part first, then east/west, joined by `/`:
`(−1, 2)` is `N2/W1`, `(1, −1)` is `S1/E1`.

### 2.2 Units
Units live on a single global integer grid `(gx, gy)` with **x growing East and y
growing South** (screen order). A panel of geometry `W×H` (canon 5×6) owns the block:

```
tile_index tx→txi:  txi = tx−1 if tx>0 else tx
tile_index ty→tyi:  tyi = −ty  if ty>0 else −ty−1
origin(tx,ty) = (txi·W, tyi·H)
panel_of(gx,gy): txi = floor(gx/W), tyi = floor(gy/H)
                 tx = txi+1 if txi≥0 else txi ;  ty = −(tyi+1) if tyi≥0 else −tyi
```

Inside a panel, units are addressed **r/c, 1-based**: `r` counts rows **from the north
edge** (1..H), `c` counts columns **from the west edge** (1..W).
`unit_at(panel, r, c) = origin + (c−1, r−1)`; `rc_of(g) = (gy−oy+1, gx−ox+1)`.

Directions: `DIRS = N, NE, E, SE, S, SW, W, NW` = `(0,−1),(1,−1),(1,0),(1,1),(0,1),
(−1,1),(−1,0),(−1,−1)` (indices 0..7). Side neighbors are indices 0,2,4,6. Chebyshev
distance `cheb(a,b) = max(|ax−bx|, |ay−by|)` is the game's "counting units in any
direction".

### 2.3 Rungs and people
Rungs 0..7: `verydeep, deep, medium, shallow, coastal, plain, hills, mountains`.
WATER = {0,1,2,3}; HEIGHTS = {6,7}. People kinds: `farm_lo, farm_hi, rural, urb_lo,
urb_md, urb_hi`; densities 0,0,1,2,3,4. Marks: `sunken, marsh, volcano, canyon, ruins,
star`.

## 3. The portable RNG (PCG32, the v0.4 contract)

One generator, one specification, so every port is bit-exact. Restated from FORK_NOTES:

* **PCG32**, 64-bit state, multiplier `6364136223846793005`, fixed stream:
  increment `(54 << 1) | 1 = 109`.
* **Seeding**: `state = 0`; advance once; `state += seed (mod 2^64)`; advance once.
* **Advance/output**: `old = state; state = old·mul + inc (mod 2^64);
  xorshifted = ((old >> 18) xor old) >> 27` as 32 bits; `rot = old >> 59`;
  `output = rotr32(xorshifted, rot)`.
* **bounded(n)** uniform in 0..n−1: threshold `t = 2^32 mod n`; draw `r` until `r ≥ t`;
  return `r mod n`. **die(n)** = `1 + bounded(n)`.
* **shuffle**: Fisher–Yates **from the top**: for `i` from `len−1` down to `1`,
  `j = bounded(i+1)`, swap `a[i], a[j]`.
* **chance**: per-mille integer `m` computed **once at config time**
  (percents allow one decimal: `m = percent × 10`); hit iff
  `next() < (m << 32) / 1000` with integer division. The engine is float-free.

**Official test vectors** — asserted before anything else builds on the RNG:

| vector | expected |
|---|---|
| seed 42, first 8 raw u32 | 2707161783, 2068313097, 3122475824, 2211639955, 3215226955, 3421331566, 3217466285, 2167406445 |
| seed 42, first 8 die(6) | 4, 4, 3, 2, 2, 5, 6, 4 |
| seed 8065818, first 4 raw u32 | 2259990538, 1539960839, 2586682155, 529441677 |

## 4. The Decider

Every die, pick, and chance flows through one interface. The engine never touches the
RNG directly.

```cpp
struct Decider {
  virtual int  die(int n, const char* purpose) = 0;          // 1..n
  virtual int  pick(int count, const char* purpose) = 0;     // 0..count-1, count >= 2
  virtual bool chance(int permille, const char* purpose) = 0;
  virtual void shuffle_deck(size_t len, uint32_t* out_perm,
                            const char* purpose) = 0;        // permutation of 0..len-1
};
```

Rules:

* **Single-candidate picks are silent.** A pick over one candidate consumes no
  randomness, produces no decision record, and no event. (Oracle: `pick`.)
* **Candidate ordering is the engine's job.** Before any pick the engine sorts the
  candidate list exactly as CPython sorts the corresponding tuples: integers ascending;
  tuples lexicographic component-wise; units as `(gx, gy)`; panels as `(tx, ty)`;
  `(unit, aux)` pairs by unit (auxes never compared — first components are unique).
  The Decider only ever supplies an index into that sorted list.
* **AutoDecider** implements §3 verbatim: `die → 1+bounded(n)`, `pick → bounded(count)`,
  `chance → chance_permille(m)`, `shuffle_deck → Fisher–Yates from the top`. Its whole
  hidden state is the PCG32 64-bit state, serialized in the save (§6).
* **ScriptedDecider** replays a recorded decision list in order. Each replayed record
  must match the requested `kind` and `domain`; mismatch or exhaustion is a hard error
  (the run has diverged from the script). This is the helper tool's re-roll machinery:
  edit one record, replay the rest.

**Decision record** (JSON, one per Decider call):

```json
{ "i": 172, "kind": "die|pick|chance|shuffle",
  "purpose": "wobble", "domain": 6, "result": 5 }
```

`domain` is `n` for die, `count` for pick, `permille` for chance, `len` for shuffle.
`result` is the integer result, `true/false` for chance, or the permutation array for
shuffle. `purpose` strings are fixed by the oracle (they appear verbatim in log lines)
and are part of this contract: `row`, `column`, `first rung`, `dominant tie`,
`rework dominant`, `away direction`, `fill spot`, `wobble`, `wobble (choice)`,
`heading`, `heading (choice)`, `len`, `length`, `length (choice)`, `grow`,
`foundation`, `farm intensity`, `anomaly`, `islets`, `nudge {what}`,
`ridge seed (choice)`, `free class (choice)`, `free seed (choice)`, `basin start`,
`extend run`, `extend entry`, `place {kind}`, `people base`, `riser`, `living city`,
`lead city`, `panel position`, `archive`, `deck` (shuffles).

## 5. The event stream

The engine emits **structured events**; the text log is **one renderer** of that stream
and must stay byte-compatible with the oracle. Every event:

```json
{ "seq": 481, "kind": "paint", "panel": [ -1, 2 ] | null,
  "unit": [ -3, -8 ] | null, "payload": { … } }
```

`seq` is the global event sequence number. Events inside an age's action list also
carry `payload.step` — the 1-based **step number** printed as `    {step}. …`. The
step counter resets to 0 at each age start; the free-panel event (§5.3) deliberately
continues the previous age's counter, exactly as the oracle does.

### 5.1 Kind catalog and exact text templates

Framing (no step number):

| kind | payload | template |
|---|---|---|
| `run_start` | seed, eras | `=== THE ENDLESS MAP, simulator run ===` ⏎ `seed: {seed}  eras: {eras}` |
| `era_start` | era | `--- era {era} ---` |
| `age_start` | era, age, panel, card | `[e{era} a{age:02d}] panel {panel} \| {CARD}` (card uppercased) |
| `free_panel` | era | `[e{era}] stack empty: a panel is added for free` |
| `addpanel_wake` | — | `    the Add Panel card joins the back of the deck` |
| `era_summary` | era, ages, painted, rung_counts[8], done, panels, archived, cliffs, merges, archive_on | `=== era {era}: ages {ages} \| painted {n} \| water {w:.0f}% coastal {c:.0f}% plain {p:.0f}% hills {h:.0f}% mtn {m:.0f}% \| done {done}/{panels} panels \| `(`archived {a} \| ` when archive_on)`cliffs {cl} merges {mg}` |
| `final_report` | — | the FINAL METRICS block, rendered from state (§6.6) |

Decision echoes (no step number; emitted by the engine right after the Decider call):

| kind | payload | template |
|---|---|---|
| `die` | n, value, purpose | `    d{n}={value} ({purpose})` |
| `choice` | count, purpose | `    choice among {count} ({purpose})` |
| `chance` | permille, hit, purpose | `    chance {purpose}: {yes\|no}` |

Age notes (no step number):

| kind | payload | template |
|---|---|---|
| `calm` | — | `    calm: nothing` |
| `work` | quota, mood | `    work {quota}, mood {mood}` |
| `card_skip` | card, reason | `    {card}: {reason}` (empty current panel; else becomes numbered `skip_embellish`) |
| `stroke_note` | label, cause, detail | `    {label}: first unit not legal, ends` · `    {label}: ends at map edge, heading {D}` · `    {label}: merges into {rung}, ends` · `    {label}: blocked by {anomaly\|rung}, ends` · `    {label}: no legal rung ahead, ends` |
| `extend_run` | length, cls, side | `    extend: run len {length} ({water\|heights}) on {D} border` |
| `work_follows` | panel | `    the work follows the new panel {panel}` |
| `foundation` | which | `    found hamlet` · `    found village` · `    found town` |
| `upgrade` | kind | `    upgrade to {kind}` |
| `sprawl` | — | `    cannot climb, sprawls` |
| `city_lives` | — | `    the city lives: climb or sprawl` |
| `cliff` | — | `    CLIFF` |
| `cycle_complete` | — | `    the deck completed its cycle` |
| `anomaly_result` | name | `    anomaly: {name}` |
| `panel_archived` | panel | `    panel {panel} COMPLETE, to the Atlas` |
| `panel_stays` | panel | `    panel {panel} full, stays in play` |
| `panel_returns` | panel, filled, area | `    panel to back of stack ({filled}/{area})` |

Numbered actions (carry `payload.step`; template prefix `    {step}. `):

| kind | payload | template body |
|---|---|---|
| `paint` | unit, rung, why | `paint r{r}c{c} {panel} {rung} ({why})` |
| `trace` | unit, label | `rework r{r}c{c} {panel} ({label})` |
| `shore_heal` | unit | `the shore forgets its sea at r{r}c{c} {panel}: coastal -> plain` |
| `hold` | what ∈ land/town/settled/city_shore | `the land holds: embellish` · `the town holds: embellish` · `settled: embellish` · `the city holds the shore: embellish` |
| `rework_change` | unit, from, to | `rework r{r}c{c}: {from} -> {to}` (unreachable in this lineage: semi is always on) |
| `homes_lost` | unit | `the ground gives way, the homes are lost at r{r}c{c} {panel}` (unreachable, as above) |
| `full_embellish` | n | `the panel is full: embellish {n} units` (unreachable: alive is always on) |
| `crumble` | unit | `the city crumbles at r{r}c{c} {panel}` |
| `mark` | unit, name | `mark {name} at r{r}c{c} {panel}` |
| `people` | unit, kind, why? | `people {kind} at r{r}c{c} {panel}` (+ ` ({why})` when why present) |
| `anomaly_strike` | — | `the anomaly strikes the homes` |
| `volcano_ring` | — | `the volcano raises its ring: the land around becomes hills` |
| `new_panel` | panel, sum | `new panel {panel} (sum {sum})` |
| `deck_shuffled` | — | `the deck is shuffled` |
| `skip_embellish` | card, reason, spirit | `{card}: {reason}: embellish, {spirit}` |

Spirit strings: extend `trace your richest border`; basin `ripple the water`; ridge and
greatridge `shade the slopes`; freestroke `any flourish`; settlement
`the town celebrates` (or `leave a waymark` for "no legal home"); anomaly
`mark the strange`; default `any flourish`.

### 5.2 Renderer law
The percentage fields of `era_summary` and the final report are formatted exactly as
CPython formats IEEE-754 doubles with `:.0f`/`:.1f` (round-half-even on the binary
value, two-step arithmetic: `count/total` rounded, then `×100` rounded). The C++
renderer reproduces this with an integer-only binary64 emulation; no float types exist
in the engine. Everything else is pure integer text.

### 5.3 Ordering quirks frozen by the oracle
* The free-panel event and its `new_panel` action fire **before** the age header of the
  age that triggered them, and `new_panel` continues the **previous** age's step
  counter.
* `deck_shuffled` fires after the age's fill (its step counter is the current age's).
* The era-cycle marker is the first card drawn each cycle; while addpanel sleeps, the
  marker's reappearance triggers `cycle_complete` + shuffle; once addpanel wakes, the
  marker retires silently. Card identity, not equality: two cards with the same kind
  and work are distinct (uids, §6).

## 6. The state schema (save/load/resume, bit-exact)

One JSON document holds the complete world. Loading it and stepping must be
byte-identical to never having stopped (log continuation included). Save points are
**age boundaries** (after the age's post-bookkeeping, including any era rollover).

```json
{
  "schema": "jerrymap-state",
  "version": 1,
  "lineage": "v0.4",

  "config": {
    "panel_w": 5, "panel_h": 6,
    "deck": [["extend",4],["basin",3],["ridge",1],["greatridge",1],
             ["settlement",3],["calm",4],["anomaly",1],["freestroke",2]],
    "wake_era": 2, "alive": true, "semi": true, "fragile": true,
    "addpanel_copies": 1, "work_spread": true,
    "work_overrides": {}, "mood_overrides": {},
    "archive_permille": 0,
    "stroke_die": 4, "stroke_add": 1,
    "greatridge_die": 0, "greatridge_add": 0,
    "extend_cap": 4
  },

  "rng": { "algo": "pcg32/stream54", "state": "18446744073709551615" },

  "time": { "seed": 42, "eras_wanted": 20,
            "era": 3, "age_in_era": 7, "ages_total": 57 },

  "world": {
    "panels":  [[-2,-1,30], [-2,1,17]],
    "base":    [[-10,-12,5]],
    "wild":    [[-3,4]],
    "marks":   [[-3,4,"volcano"]],
    "people":  [[-4,6,"rural"], [-4,5,"urb_lo"]],
    "embellish":       [[-4,6,2]],
    "embellish_panel": [[-2,1,3]],
    "atlas":   [[-1,1]],
    "binder":  [],
    "stack":   [[1,2],[-1,-2]]
  },

  "deck": {
    "order": [{"kind":"calm","work":6,"uid":11}],
    "marker_uid": null,
    "woken": true,
    "next_uid": 21
  },

  "chronicle": {
    "era_rows": ["era 1: ages 25 | …"],
    "metrics": {"cliffs":0,"nudges":0,"merges":0,"free_panels":0,"fills":0,
                "stroke_units":0,"reworks":0,"crumbles":0,"embellish":0},
    "skips": {"anomaly": 2},
    "firsts": {"urban low": 2},
    "genesis_panels": [[-1,2],[1,2],[-2,1],[-1,1],[1,1],[2,1],
                       [-2,-1],[-1,-1],[1,-1],[2,-1],[-1,-2],[1,-2]],
    "genesis_coverage": {"num": 355, "den": 360},
    "completed_per_era": {"4": 1},
    "added_per_era": {"2": 3}
  },

  "carry": { "step": 14, "panel": [1, 2] }
}
```

### 6.1 Ordering rules
* `world.people` is **insertion-ordered and the order is semantic** (settlement
  component enumeration depends on it; Python-dict semantics: deletion preserves the
  rest, re-insertion appends at the end). Serializers must write it in that order and
  loaders must rebuild it in that order.
* `deck.order` and `world.stack` are draw/rotation order: index 0 is drawn next.
* Every other collection is serialized sorted (units by `(gx,gy)`, panels by
  `(tx,ty)`) purely for canonical files; their order is not semantic.

### 6.2 Sets and maps
`base` maps unit→rung. `wild` is the anomaly set; `marks` maps unit→mark name (marks
imply wild membership but the two are stored separately, exactly as the oracle keeps
them — a `set_mark` adds to both; lone island / crater lake / trench / mesa /
archipelago add only to `wild`). `atlas` = panels that have ever completed; `binder` =
archived panels (out of rotation forever; still part of the world for every rule).

### 6.3 Numbers
`rng.state` is a decimal string (u64 does not fit safely in JSON numbers). All other
values fit in 32 bits. `archive_permille` is the integer per-mille (§3); the CLI's
percent input is converted once at config time. `greatridge_die: 0` means "not set"
(the handbook's chosen length applies).

### 6.4 Genesis
A new world seeds 12 panels for 5×6 geometry (three per quadrant, the handbook's
layout, in stack order): `(-1,2),(1,2),(-2,1),(-1,1),(1,1),(2,1),(-2,-1),(-1,-1),
(1,-1),(2,-1),(-1,-2),(1,-2)`; any other geometry seeds 4: `(-1,1),(1,1),(-1,-1),
(1,-1)`. The deck is built in the fixed kind order of `config.deck` with per-copy work
spread (±1 at the ends when the average −1 ≥ 3 and copies ≥ 2), then shuffled once.

### 6.5 Stepping
`step()` executes exactly one **age**: free-panel refill if the stack is empty, draw,
age header, card instruction, fill/rework quota, city-lives check, completion/archival,
stack return, deck return, marker/shuffle bookkeeping, and — every 25th age of an era —
the era summary, era increment, addpanel wake, and next era header. `run()` is
`step()` until `era > eras_wanted`.

`carry` holds the two per-age transients the oracle leaks across age boundaries
(§5.3): the action-step counter (a pre-age free-panel event continues the previous
age's numbering) and the previous current panel (a skip before any panel is current
falls back to it). `panel` is null before the first age. Every other transient is
quiescent at age boundaries and is not saved.

### 6.6 The final report
Rendered from state at run end: the FINAL METRICS header, all `era_rows`, totals,
rung shares (`:.1f`), aggregates, genesis coverage (era-3 num/den, `:.0f`), skips,
cliffs/nudges/merges/free panels, people tally, deck size + composed count,
embellishment totals, city firsts + reworks + crumbles. Byte-frozen by the gate.

## 7. The CLI contract

`jerrymap` (native) and the WASM harness accept the reference's flags with the
reference's defaults:

```
--eras N (8)  --seed N (random 1..10^7)  --out DIR (runs)  --tile WxH (5x6)
--addpanel N (1 in this lineage)  --archive-chance P (0, percent, one decimal)
--stroke-die N (4)  --stroke-add N (1)
--greatridge-die N (unset)  --greatridge-add N (0)  --extend-cap N (4)
--work k=v,…  --mood k=v,…
--snapshots --alive --semi --no-patina --flat-work --fragile
--living-deck --ld-start --ld-add --ld-retire --ld-shuffle --ld-floor --ld-ceiling
```

`--flat-work` disables the work spread. `--alive`, `--semi`, `--fragile` are accepted
and inert (this lineage hard-enables all three). The living-deck family is accepted
and inert (machinery removed from play). `--snapshots`/`--no-patina` affect only PNG
rendering, which the C++ CLI does not do. Output: `{out}/seed{seed}_log.txt` — all
event-rendered lines, then the final report — **LF line endings always**; stdout gets
`seed {seed}` and the report. `--save FILE` / `--load FILE` / `--record FILE` /
`--replay FILE` are engine extensions (state §6, decisions §4) and additive only.

## 8. The gate

### 8.1 Oracle matrix
Byte-identity of `seed{N}_log.txt`, Python vs native C++ vs WASM:

| cell | seed | eras | dials |
|---|---|---|---|
| base-11 | 11 | 20 | none |
| base-42 | 42 | 20 | none |
| base-303 | 303 | 20 | none |
| long-42 | 42 | 40 | none |
| dial-archive | 42 | 20 | `--archive-chance 25` |
| dial-stroke | 42 | 20 | `--stroke-die 6 --stroke-add 2` |
| dial-greatridge | 42 | 20 | `--greatridge-die 6 --greatridge-add 2` |
| dial-extendcap | 42 | 20 | `--extend-cap 0` |

### 8.2 CI
Every commit: build native, run Python and native over the full matrix, byte-compare;
build WASM, run the Node harness over the same matrix, byte-compare against both.
Line endings are normalized only for logs produced by Python on Windows hosts; the
C++/WASM logs must be LF-pure.

### 8.3 Additional proofs (also CI)
* **Scripted-decider**: record an auto run's decisions, replay through
  ScriptedDecider, byte-identical log.
* **Save-load-resume**: save at a mid-run age boundary, load, run to the end; the
  concatenated log equals the uninterrupted run's, and the final states serialize
  identically.
* **Vocabulary**: no `tile`, no `visit`, any case, over every rendered log of the
  matrix.
* **Dial suites** carried from the reference: all-defaults equals the no-dial baseline
  byte-for-byte; each dialed cell differs from baseline (the dial is live); RNG
  vectors first.

### 8.4 Succession
`/reference` is frozen. Python retires as oracle only when the full matrix is green in
native **and** WASM; after succession `/reference` remains as history and the C++
engine becomes the oracle of record, with this document as its specification.

## 9. Versioning

* **Contract version** (this file): semver. Renderer/text changes are **major** (they
  break byte-identity with the oracle and require a lineage bump).
* **State schema version**: integer; loaders reject unknown versions.
* **Event schema version**: integer; additive payload fields are minor.
* **World lineage**: `v0.4` — the PCG32 dialect. A lineage bump means old seeds speak
  a different world; it never changes saved-state replayability within its lineage.
