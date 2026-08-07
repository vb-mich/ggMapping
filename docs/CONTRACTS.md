# CONTRACTS.md — the shared law of jerrymapping-app

Contract version: **6.0.0** · State schema: **1** · Event schema: **3** · World lineage: **v0.10**

This document binds every conversation and every component of this mono-repo: the C++
engine, the WASM build, the PWA, the dice roller, the helper tool, and the digitalizer.
Nothing in `/engine`, `/apps`, or `/tools` may contradict it. Changes here bump the
contract version and must state their migration story.

Authority chain: `docs/books/0-Jerrymapping-the-game.md` (the handbook, beta 0.1, amended by
the v0.5 depth erratum, the v0.7 amendments, the v0.8 fields promotion and the
v0.9 community deck) defines the game;
`docs/FORK_NOTES.md` defines this lineage's deltas and dials; the **C++ engine is the
reference of record** (succession, §8.4), and
`reference/sim_v10.py` is the **living twin** whose byte-identity the gate proves —
every rules increment lands in both, and the matrix must be green three ways before
the increment is law. `reference/sim.py` is the frozen v0.4 founding document,
history. Where prose and implementations disagree, the twin-proven engine wins until
the fork notes say otherwise.

---

## 1. Vocabulary law — total since v0.5

The words are **panel**, **age**, **era**, **rework**, **unit**, **elevation**. The
words *tile*, *visit*, and *rung* are banned — any case, no exemptions remaining —
from every rendered output: every log line, the metrics footer, and every UI string.
CI enforces this over every rendered log of the matrix and over the app's string
tables. The ban governs **output text** and, since event schema 3, the event
payload keys (`era_summary.elevation_counts`, `paint.elevation` — renamed at
5.0.0 with no consumer, closing the rename ledger's schema side). The CLI flag
became `--panel` at 5.1.0, when the v0.9.1 package shipped the twin speaking
it — the condition this section set. **The rename ledger is closed.** Only
code identifiers keep their historical names, exactly as
the twin itself does. The card that grows the map is **addpanel** end to end: config
key, CLI flag, engine identifier, log text.

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

### 2.4 The canonical palette

Extracted from the frozen reference's renderer; the one true palette for **every**
renderer of this lineage (PNG, canvas, print). Colors are `#RRGGBB` (`#RRGGBBAA`
where an alpha is stated).

Rungs 0..7:

| rung | color | rung | color |
|---|---|---|---|
| verydeep | `#14364F` | coastal | `#E8D18F` |
| deep | `#205E82` | plain | `#8FBE6E` |
| medium | `#4193BC` | hills | `#B3A15E` |
| shallow | `#A7D5E4` | mountains | `#77573F` |

People overlays (cover the unit's interior):

| kind | color | kind | color |
|---|---|---|---|
| farm_lo | `#C9DFA0` | urb_lo | `#D3D3D3` |
| farm_hi | `#5E8F45` | urb_md | `#A6A6A6` |
| rural | `#C7A472` | urb_hi | `#6B6B6B` |

Farm overlays carry furrow lines `#00000055`; rural carries a house block `#6B4E2E`.

Marks: marsh reeds `#2E5E50`; volcano triangle `#C0392B`; canyon stroke `#5A3E22`;
ruins cross `#555555`; star `#B8860B`. A base unit marked `sunken` renders `#7FAF9C`
in place of its rung color (the mark tints the base; all other marks draw on top).

Chrome: map background `#F3EFE7`; unpainted unit `#FFFFFF` with outline `#D8D2C6`;
painted unit outline `#00000022`; panel border `#4A4238`.

### 2.5 The patina rule — law for every renderer

The rework marks are the one thing a renderer must *decide* rather than read, so
the decision is law here and not renderer taste. It binds the reference render,
the app canvas, the PNG export, and any future one.

**Placement.** A rework recorded against a **unit** (`embellish[u]`) is drawn on
that unit. A flourish from an instruction that could not execute is recorded
against the **panel** (`embellish_panel[t]`) with no unit — on a real map the
player chooses where it goes — so the renderer chooses:

1. the candidates are the panel's **painted** units only (`u ∈ base`), never
   blank ground: a mark on blank ground is drawn over nothing and lost;
2. ordered **richest first** — by existing unit-level mark count descending —
   then by `(gx, gy)`;
3. handed out **round-robin**: the unit at index `i mod count` takes the `i`-th
   flourish, for `i` in `0 … n−1`.

Panels are disjoint, so the order in which panels are processed cannot change
the result. The engine only records a panel-level flourish while the panel has
painted ground, so the candidate list is never empty and no mark is ever
dropped.

**One implementation.** The engine computes this map — `patina_map` /
`jm_patina(state_json)`, a pure derivation over a §6 document — and renderers
**consume** it rather than recompute it. The Python twin implements it
independently, as the twin regime requires; `scripts/run_render_checks.py`
proves the two maps agree unit for unit and that neither draws on blank ground
or drops a mark (§8.6).

**Drawing.** Up to `min(marks, 3)` dots at relative offsets `(0.30, 0.34)`,
`(0.68, 0.52)`, `(0.44, 0.74)` of the unit square, radius `max(1, unit_px / 10)`,
colored the unit's rendered base color darkened per-channel by
`floor(channel × 0.55)`.

*History: before v0.7.1 the panel-level flourishes were spread over **all** the
panel's units from index zero, so every panel's first flourish landed on its
top-left unit, painted or not — a corner bias, with the occasional mark drawn on
blank ground and silently lost. Renders made before that fix differ from later
ones in mark placement, and only in that.*

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
and are part of this contract: `row`, `column`, `first elevation`, `dominant tie`,
`rework dominant`, `away direction`, `fill spot`, `wobble`, `wobble (choice)`,
`heading`, `heading (choice)`, `len`, `length`, `length (choice)`, `grow`,
`foundation`, `farm intensity`, `anomaly`, `islets`, `nudge {what}`,
`ridge seed (choice)`, `free class (choice)`, `free seed (choice)`, `basin start`,
`deepen field` (ch. 9),
`extend run`, `extend entry`, `place {kind}`, `people base`, `riser`, `living city`,
`lead city`, `panel position`, `archive`, `deck` (shuffles).

### 4.1 The definitive decision taxonomy (5.3.0, extracted at the seam)

The complete decision surface of lineage v0.9, enumerated from the engine's
Decider call sites — the set a UI that presents decisions must cover, one for
one. **A consumer must fail loudly on a purpose it does not know**; guessing a
shape forks the rules by accident. `{what}` and `{kind}` are the dynamic
labels listed beneath the table.

Dice (`kind: die`; the UI shape is the book's triple: enter my roll / roll for
me / choose the outcome — handbook "Rolling dice", the free-choice note):

| purpose | die | where |
|---|---|---|
| `row` | d`H` (d6 canon) | landing a rolled unit (die-sized heights) |
| `column` | d10 halved for the canon 5-wide panel; d`W` when W is die-sized | landing a rolled unit |
| `first elevation` | d6 | first paint with no painted side neighbor |
| `wobble` | d6 | every stroke step (rolled strokes) |
| `heading` | d8 | basin strokes (two sites) |
| `len` | d`stroke_die` + `stroke_add` | basin, free stroke, extend carry |
| `length` | d`greatridge_die` + `greatridge_add` | great ridge, rolled mode only |
| `foundation` | d6 | settlement founding |
| `grow` | d6 | settlement growth |
| `farm intensity` | d4 | founding farmland |
| `anomaly` | d12 | the anomaly table |
| `islets` | d4 | archipelago |

Choices (`kind: pick`; the engine sorts candidates — §4 ordering rule — and
the Decider answers with an index into that order). The **payload** column is
the candidate encoding the witness carries (§4.2):

| purpose | payload | meaning |
|---|---|---|
| `row (choice)` / `column (choice)` | int | 1..H / 1..W, non-die geometry |
| `wobble (choice)` | int | 1..6, the ridge's steered wobble |
| `nudge {what}` | unit | nearest legal homes for a rolled unit |
| `fill spot` | unit | most-neighbored empties, tied |
| `dominant tie` / `rework dominant` | int | tied dominant elevations |
| `away direction` | int | 4 (coastal) or 6 (hills), away from plain |
| `ridge seed (choice)` / `free seed (choice)` | unit | legal seeds |
| `heading (choice)` | int | 0..7 = N NE E SE S SW W NW (§2.2) |
| `length (choice)` | int | 2..5 ridge, 4..10 great ridge |
| `basin start` | `{unit, facing?}` | in-panel water, or border water with its facing entry |
| `extend run` | int + ctx `{length, side, water, units[]}` | tied border runs |
| `extend entry` | `{unit, outside}` | tied middlemost entries into the run |
| `free class (choice)` | int | 0 water, 1 heights |
| `place {kind}` | `{unit, needs_paint, legal[]}` | legal homes; `legal` = paintable bases when the unit is blank |
| `people base` | int | tied base elevations under a placed overlay |
| `riser` | unit | tied top-density risers |
| `deepen field` | unit | the settlement's low fields (ch. 9) |
| `living city` / `lead city` | int + ctx `{units[]}` | tied settlement components |
| `panel position` | panel | tied nearest open positions |

`{what}` ∈ `basin seed`, `home`, and the twelve anomaly names (`lone island`,
`sunken land`, `crater lake`, `archipelago`, `marsh`, `trench`, `mesa`,
`oasis`, `volcano`, `canyon`, `old ruins`, `wonder`). `{kind}` ∈ `farm_lo`,
`farm_hi`, `rural`.

Chance (`kind: chance`): `archive` only, domain = `archive_permille`.
Shuffle (`kind: shuffle`): `deck` only — genesis deck build and each
cycle-complete shuffle; domain = deck size, result = the permutation.

**Latitude note (the Helper's honesty rule).** Every record in this taxonomy
is an open decision: picks are the player's by law (the ridge's steering,
every tie), and dice are player-optional by the handbook's free-choice note.
A proposal answering any of them with the simulator's policy is therefore
**taste, never rules**, and wears the suggestion mark — while everything that
never reaches the Decider (single-candidate picks, computed consequences) is
rules and wears none.

### 4.2 The candidate witness (5.3.0)

Right before a multi-candidate pick the engine offers the sorted candidate
list to the Decider as JSON: `{"cands": [...], "ctx"?}` — encodings per the
taxonomy table (`unit` → `[gx, gy]`, `panel` → `[tx, ty]`, ints as numbers,
struct candidates as objects whose tappable unit is always under `"unit"`).
`ctx` rows, where present, align one for one with the candidate rows. The
witness is a **side channel**: it consumes no randomness, emits no event,
renders no text, and exists only when the decider asks for it
(`wants_offer()`); AutoDecider and ScriptedDecider never do, which the gate
proves on every commit. Single-candidate picks remain silent — no record, no
witness (§4).

### 4.3 The frontier machinery (5.3.0, the Helper's seam)

`FrontierDecider` is ScriptedDecider's law — kind and domain must match,
divergence is a hard error — with one difference: **exhaustion is not an
error but the age's next open question**, surfaced as a sentinel carrying
kind, purpose, domain, and the witnessed candidates. `PolicyFallbackDecider`
replays the same way but answers past the script's end with the simulator's
own policy (an AutoDecider carried by explicit state), recording every fresh
answer beside its candidates — proposal mode. Neither reports an RNG state
into saved documents: a Helper world's state document carries rng `"0"`
whichever mode wrote it, so **the two modes cannot diverge in what they
write**. The FFI face: `jm_helper_create(config, seed, eras, script)` and
`jm_helper_age(state, script, mode ∈ {guided, propose, replay}, policy_state)`
return one JSON document — `status: "question"` (the sentinel plus the
partial age's events), `"closed"` (the §6 state, the age's events, records
consumed), or `"error"`. `jm_rng_seed` / `jm_roll` / `jm_perm` expose the §3
RNG so no second PCG32 implementation grows in an app.

## 5. The event stream

The engine emits **structured events**; the text log is **one renderer** of that stream
and must stay byte-compatible with the oracle. Every event:

```json
{ "seq": 481, "kind": "paint", "panel": [ -1, 2 ] | null,
  "unit": [ -3, -8 ] | null, "payload": { … } }
```

`seq` is the global event sequence number. Events inside an age's action list also
carry `payload.step` — the 1-based **step number** printed as `    {step}. …`.

**Every numbered event names a place.** The envelope's `unit` is set whenever the
step happened to a unit — including the embellishments (`hold`), `anomaly_strike`
and `volcano_ring`, whose *text* names no unit but whose engine effect is a unit's;
`panel` is set for the steps that belong to a panel rather than a unit
(`skip_embellish`, `full_embellish`, `new_panel`, and `deck_shuffled`, which
belongs to the age and carries the age's panel). Renderers can therefore place
every numbered step, one for one with the record. This populates fields the
envelope always had; no log text changes, which the gate proves. The
step counter resets to 0 at each age start; the free-panel event (§5.3) deliberately
continues the previous age's counter, exactly as the oracle does.

### 5.1 Kind catalog and exact text templates

Framing (no step number):

| kind | payload | template |
|---|---|---|
| `run_start` | seed, eras | `=== JERRYMAPPING, simulator run ===` ⏎ `seed: {seed}  eras: {eras}` |
| `era_start` | era | `--- era {era} ---` |
| `age_start` | era, age, panel, card | `[e{era} a{age:02d}] panel {panel} \| {CARD}` (card uppercased); on an **Add Panel age** `panel` is null and the subject reads `the new panel` (§5.3) |
| `free_panel` | era | `[e{era}] stack empty: a panel is added for free` |
| `addpanel_wake` | — | `    the Add Panel card joins the back of the deck` |
| `era_summary` | era, ages, painted, elevation_counts[8], done, panels, archived, cliffs, merges, archive_on | `=== era {era}: ages {ages} \| painted {n} \| water {w:.0f}% coastal {c:.0f}% plain {p:.0f}% hills {h:.0f}% mtn {m:.0f}% \| done {done}/{panels} panels \| `(`archived {a} \| ` when archive_on)`cliffs {cl} merges {mg}` |
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
| `stroke_note` | label, cause, detail | `    {label}: first unit not legal, ends` · `    {label}: ends at map edge, heading {D}` · `    {label}: merges into {name}, ends` · `    {label}: blocked by {name}, ends` · `    {label}: no legal step ahead, ends` |
| `extend_run` | length, cls, side | `    extend: run len {length} ({water\|heights}) on {D} border` |
| `work_follows` | panel | `    the current working panel is the new panel {panel}` |
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
| `field_deepens` | unit | `the field deepens at r{r}c{c} {panel}` |
| `paint` | unit, elevation, why | `paint r{r}c{c} {panel} {rung} ({why})` — schema 3 renamed the payload key from `rung`; the template's `{rung}` placeholder names the byte-frozen color word, which is log text and rides lineage bumps, not the schema |
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
| `new_panel` | panel, score | `new panel {panel} (score {score})` — `score = tx² + ty²`, the book's distance score (ch. 9). Event schema 2 renamed this payload from `sum`, which held a Manhattan total the placement never used (v0.6.1 erratum). |
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

**New event text is integer-only.** The soft-float emulator exists solely to
reproduce the frozen v0.4 surfaces above; it never grows. Any event kind or payload
field added after contract 1.0.0 must format its numbers with integer arithmetic
only — no new float-formatted surfaces, ever.

### 5.3 Ordering quirks frozen by the oracle

**The Add Panel age (v0.7, handbook ch. 6 note 3).** When an Add Panel card is
drawn, step 2 is skipped: the panel this card places **is** the working panel.
The age's anatomy, in order:

1. `age_start` with **no panel** — the header reads `[eN aNN] the new panel | ADDPANEL`;
2. `new_panel` (numbered action 1) with the placement score;
3. `work` — the quota note;
4. `work_follows` (`the current working panel is the new panel {panel}`), then the
   fills, numbered from 2.

What must **not** appear: no `city_lives` (a newborn panel has no settlement), no
`panel_stays`, no `panel_archived`, no `panel_returns`. The front of the Stack is
not popped, not cycled, and is visited next age; the new panel entered the back of
the Stack once, at placement. If no open position exists the card skips, and the age
carries the skip note and the quota note alone.

* The free-panel event and its `new_panel` action fire **before** the age header of the
  age that triggered them, and `new_panel` continues the **previous** age's step
  counter.
* `deck_shuffled` fires after the age's fill (its step counter is the current age's).
* **The cycle marker, v0.5 (the depth erratum):** the first card played of the game —
  and the first played after each shuffle — becomes the marker. When the marked card
  is played again, `cycle_complete` + shuffle fire and the marker clears; the deck
  shuffles once per cycle, for the whole game. addpanel carries **no shuffle rider**.
  Card identity, not equality: two cards with the same kind and work are distinct
  (uids, §6).

## 6. The state schema (save/load/resume, bit-exact)

One JSON document holds the complete world. Loading it and stepping must be
byte-identical to never having stopped (log continuation included). Save points are
**age boundaries** (after the age's post-bookkeeping, including any era rollover).

```json
{
  "schema": "jerrymap-state",
  "version": 1,
  "lineage": "v0.9",

  "config": {
    "panel_w": 5, "panel_h": 6,
    "deck": [["extend",1],["basin",3],["ridge",1],["greatridge",1],
             ["settlement",4],["calm",7],["anomaly",1],["freestroke",2]],
    "wake_era": 2, "alive": true, "semi": true, "fragile": true,
    "addpanel_copies": 2, "work_spread": true,
    "work_overrides": {}, "mood_overrides": {},
    "archive_permille": 0,
    "stroke_die": 4, "stroke_add": 1,
    "greatridge_die": 0, "greatridge_add": 0,
    "extend_cap": 4,
    "max_panels": 0
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

### 6.3 Numbers and lineage
`rng.state` is a decimal string (u64 does not fit safely in JSON numbers). All other
values fit in 32 bits. Loaders reject unknown schema versions **and foreign
lineages**: a world resumed under different rules would silently speak the wrong
dialect (§9). `archive_permille` is the integer per-mille (§3); the CLI's
percent input is converted once at config time. `greatridge_die: 0` means "not set"
(the handbook's chosen length applies).

A **retired dial key** is not a foreign lineage: a config or state document that
still carries a key this contract has dropped (today: `exp_fields`, canon since
v0.8) loads normally with the key ignored, and the app says so once. Refusing it
would strand worlds saved days earlier over a switch that no longer has anything
to select.

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
--eras N (8)  --seed N (random 1..10^7)  --out DIR (runs)  --panel WxH (5x6)
--addpanel N (2 in this lineage)  --archive-chance P (0, percent, one decimal)
--stroke-die N (4)  --stroke-add N (1)
--greatridge-die N (unset)  --greatridge-add N (0)  --extend-cap N (4)
--max-panels N (0 = unbounded; at the cap, Add Panel draws rework the front panel)
--work k=v,…  --mood k=v,…
--snapshots --alive --semi --no-patina --no-render --flat-work --fragile
--living-deck --ld-start --ld-add --ld-retire --ld-shuffle --ld-floor --ld-ceiling
```

`--flat-work` disables the work spread. `--alive`, `--semi`, `--fragile` are accepted
and inert (this lineage hard-enables all three). The living-deck family is accepted
and inert (machinery removed from play). `--snapshots`/`--no-patina`/`--no-render`
affect only PNG rendering, which the C++ CLI does not do (`--no-render` skips it
entirely in the reference; the gate uses it so CI needs no Pillow). Output: `{out}/seed{seed}_log.txt` — all
event-rendered lines, then the final report — **LF line endings always**; stdout gets
`seed {seed}` and the report. `--save FILE` / `--load FILE` / `--record FILE` /
`--replay FILE` are engine extensions (state §6, decisions §4) and additive only.

## 8. The gate

### 8.1 Oracle matrix
Byte-identity of `seed{N}_log.txt`, the Python twin (`reference/sim_v10.py`) vs
native C++ vs WASM, on the v0.10 lineage:

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
| combined-dials | 42 | 20 | `--archive-chance 25 --stroke-die 6 --stroke-add 2 --greatridge-die 6 --greatridge-add 2 --extend-cap 0` |

**Experimental cells** (§11) run beside the matrix and are reported separately
while an experiment is live. **None is**: v0.8 promoted the fields rules into
canon, so their configuration is simply the default and every cell above
exercises those paths.

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

**Enacted** at tag `v0.4-succession` (matrix green, native and WASM). The freeze is
**behavioral**: after succession `/reference` may accept behavior-neutral *tooling*
changes — changes whose log byte-identity the gate proves — and nothing else. Rules,
text, and formatting stay untouchable. The first such change is `--no-render` (§7).

**The twin regime** (first exercised by v0.5): every rules increment updates the
Python twin and the C++ engine together. The increment is law only when the full
matrix is byte-identical three ways — twin, native, WASM — in CI. The outgoing
lineage's fixtures retire to `reference/history-<lineage>/`, named for the
**lineage** whose worlds they describe (not the twin revision that produced them);
the superseded twin is deleted, since git holds it and two twins invite drift. The
frozen v0.4 founding reference is the one permanent exception.

### 8.6 The render-layer checks

The gate compares logs; the conformance suite reads the book. **Neither looks at
the picture**, so a rule that lives only in a renderer is unreviewed by
construction — which is how the patina corner bias survived every green check
for the repo's whole life.

`scripts/run_render_checks.py` closes that hole and runs in CI. It compares
**mark maps, never pixels**, over several seeds, and it takes the twin's map from
the twin's *own* `render()` through a trace hook rather than reimplementing the
rule, because a check that restates the rule proves nothing. Per seed it asserts:
the engine's map equals the twin's unit for unit; every mark of **either** map
sits on painted ground; the marks each panel draws equal the marks it recorded;
placement depends only on the state; and no mark sits on an unpainted panel
corner. Point it at a pre-fix renderer with `--twin` and it fails — which is how
these checks were shown to have teeth rather than merely being green.

### 8.5 The conformance suite

The gate proves the twin and the engine agree **with each other**. It is blind to a
rule both read the same wrong way — which is exactly how the v0.6.1 erratum survived
(the placement line printed a Manhattan sum where the placement scored by squared
distance; both implementations agreed, both were wrong about the book).

`scripts/run_conformance.py` is the mitigation and runs in CI beside the gate. It
asserts properties of the **game as the handbook describes it**, never byte equality,
each check citing the passage it enforces, and it runs against **both**
implementations so a shared misreading has somewhere to fail.

**The norm.** Every future canon ruling ships with its conformance check **in the
same increment**, citing the handbook passage it enforces. The suite is meant to
grow with the book, not to be retrofitted after the next bug: a ruling that lands
without its check is an incomplete increment, and the check is written from the
book's words rather than from the implementation's behavior (otherwise it only
restates what the code already does). Checks that need engine state rather than
rendered text may run against the engine alone — byte-identity carries the result to
the twin — but anything readable from the log runs against both.

## 9. Versioning

* **Contract version** (this file): semver. Renderer/text changes are **major** (they
  break byte-identity with the oracle and require a lineage bump).
* **State schema version**: integer; loaders reject unknown versions.
* **Event schema version**: integer; additive payload fields are minor.
* **World lineage**: `v0.10` — the PCG32 dialect with the depth erratum, the Add
  Panel working-panel rule, the fields as canon, and the community's deck. A lineage
  bump means old seeds speak a different world; it never changes saved-state
  replayability within its lineage (loaders reject foreign lineages, §6.3).

### 9.1 Changelog

* **6.0.0** — a rules increment, lineage `v0.9 → v0.10` (major: renderer text
  and rules changed). **The Great Ridge floor**: its length range becomes
  **5 to 10**, up from 4 to 10; Ridge is unchanged at 2 to 5. Both stay the
  player's CHOICE, as canon has always had them — only the range moved, so a
  Great Ridge can no longer come out shorter than a lucky Ridge (handbook
  ch. 9). Note for dialers: `--greatridge-die 6 --greatridge-add 4` now
  reproduces the canon range exactly as a roll, and the matrix's own
  `dial-greatridge` cell (die 6, add 2) is untouched by the change because it
  never takes the choice path. Riding the same package, docs only: chapter 8
  finally writes the **ghost stroke** (a stroke always walks its whole length;
  ending is not stopping) and chapter 10 warns that a map held at a fixed size
  keeps drawing Anomalies at the same rate. Fixtures regenerate; v0.9 fixtures
  retire to `reference/history-v0.9/`; the twin becomes `reference/sim_v10.py`.
  Conformance gains the ch. 9 length-range check (it fails against the v0.9
  golden) and two ch. 8 ghost-stroke checks (§8.5).
* **5.3.0** — additive, log bytes untouched (gate green, matrix identical):
  the Helper's seam. The definitive decision taxonomy is law (§4.1), the
  candidate witness joins the Decider (§4.2 — default-noop, exercised by no
  shipped auto path), and the frontier machinery joins the engine and the FFI
  (§4.3: `FrontierDecider`, `PolicyFallbackDecider`, `jm_helper_create`,
  `jm_helper_age`, `jm_rng_seed`, `jm_roll`, `jm_perm`). A Helper world's
  state document always carries rng `"0"`: scripted runs never had one, and
  the proposal policy's state travels beside the response instead — guided
  and proposal ages write byte-identical documents by construction.
  matching the twin the part-one package shipped: default 0 keeps every canon
  byte (gate green, matrix identical); at the cap an Add Panel draw takes the
  normal Stack visit and the card skips with `the map is at its edge`, so the
  day reworks the front panel; the free panel when the Stack empties ignores
  the cap. `--max-panels` joins §7; `max_panels` joins the §6 config (additive
  — older documents lack the key and mean 0). Conformance carries the dial's
  citation against FORK_NOTES §v0.9.1, including a capped twin-vs-engine
  byte-agreement check; the proofs hold the cap at exactly 20 and read the
  edge line.
* **5.1.0** — surface only, log bytes untouched (gate green, matrix identical):
  the CLI's `--tile` becomes `--panel` in both implementations at once — the
  v0.9.1 package shipped the twin speaking `--panel`, which is the arrival §1
  required, and the **rename ledger closes** with it. The twin also carries the
  `max_panels` dial (default 0, off — byte-identical, gate-proven); the engine
  lands it in the batch's part two, and §7 lists the flag then.
* **5.0.0** — a rules increment, lineage `v0.8 → v0.9` (major: renderer text and
  rules changed), **event schema 2 → 3**. **The community's deck is the starting
  deck** (handbook ch. 5): Extend 1, Basin 3, Ridge 1, Great Ridge 1,
  Settlement 4, Calm 7, Anomaly 1, Free Stroke 2, and Add Panel ×2 joining at
  the end of era one — 22 cards, the two Add Panel copies printing 3 and 5
  under the spread rule. `addpanel_copies` resolves to 2 when unset. Riding the
  break: the metrics footer no longer prints `(target 30-40)` beside water
  (FORK_NOTES §v0.9 — the target described a mean, not a world). The schema
  bump is the rename ledger's schema side closing: `era_summary.rung_counts →
  elevation_counts` and `paint.rung → paint.elevation`, renamed with **no
  consumer anywhere** (app, scripts, and tests read neither); `--tile` stays,
  because the twin's CLI defines that surface and the reference still speaks
  it. Fixtures regenerate; v0.8 fixtures retire to `reference/history-v0.8/`;
  the twin becomes `reference/sim_v09.py`.
* **4.0.0** — a rules increment, lineage `v0.7 → v0.8` (major: renderer text and
  rules changed). **The fields are canon.** Handbook chapter 11 is gone and its
  two rules are written into chapter 9: a farmed unit is off the density ladder
  (it never blocks a step, never supports one, and is never subject to one), and
  the farm growth step deepens a low field to high before it clears new ground.
  The dial is **removed, not defaulted** — no `exp_fields` key, no `--exp-fields`
  flag, no branch; a config still carrying the key loads with the key ignored and
  a one-time notice (§6.3). `field_deepens` is promoted from a note to a
  **numbered action** carrying its unit (§5) — no event-schema bump, the envelope
  already carries `step`/`unit`. Fixtures regenerate; v0.7 fixtures retire to
  `reference/history-v0.7/`; the twin becomes `reference/sim_v08.py`; the matrix
  returns to nine cells as the experimental cell merges into canon (§8.1). §11
  stands as policy for the next experiment (§11).
* **3.2.0** — additive, log bytes unchanged: the patina rule becomes law (§2.5)
  and gains one implementation — the engine's `patina_map` / `jm_patina`, which
  every renderer consumes; the render-layer checks join CI (§8.6). Fixes the
  corner bias: panel-level flourishes now land on painted ground, richest
  first. Renders made before this differ in mark placement, and only in that.
* **3.1.0** — additive, log bytes unchanged (gate green, byte counts identical):
  numbered events now populate the envelope's `unit`/`panel` so every step in an
  age has a place a renderer can draw (§5). The embellishments were the bulk of
  it — the engine incremented `embellish[g]` beside an event that never carried
  `g`. Also: the conformance norm (§8.5), and the engine's single `LINEAGE`
  constant behind `jm_lineage()`.
* **3.0.0** — a rules increment, lineage `v0.5 → v0.7` (major: renderer text and
  rules changed), **event schema 1 → 2**. Add Panel is the working panel: an Add
  Panel age skips step 2, takes no Stack visit, and fires no city-lives step
  (§5.3, handbook ch. 6 note 3). The city-lives rule is now written in the
  handbook; engine behavior is unchanged. The v0.6.1 erratum: the placement line
  prints the squared **distance score** (book ch. 9), and its payload key is
  renamed `sum → score` — the schema bump. `work_follows` text changed. The
  conformance suite joins CI (§8.5). Fixtures regenerate; v0.5 fixtures retire to
  `reference/history-v0.5/`; the twin becomes `reference/sim_v07.py`.
* **2.1.0** — additive, **no lineage change**: the experimental fields dial
  (§11, `exp_fields` / `--exp-fields`, default off — promoted to canon and
  removed in 4.0.0), its `field_deepens` event
  and `deepen field` purpose, and the experimental gate cells (§8.1). Every
  canon fixture is byte-identical and the oracle matrix was not regenerated.
  The gate's twin becomes `reference/sim_v06.py`, superseding `sim_v05.py`.
* **2.0.0** — the first rules increment since succession, lineage `v0.4 → v0.5`
  (major: renderer text and rules changed). The depth erratum: addpanel loses the
  shuffle rider; the cycle-marker shuffle applies for the whole game (§5.3). The
  rename ledger: run header `JERRYMAPPING`, purpose `first elevation` (§4), stroke
  note `no legal step ahead, ends`, metrics footer `elevation shares` (§5.1). The
  vocabulary law becomes total: *rung* joins *tile* and *visit*, banned from all
  output text (§1). State documents carry `lineage: v0.5`; loaders reject foreign
  lineages (§6.3). The gate's oracle is the v0.5 twin (§8.1); v0.4 fixtures retired
  to `reference/history-v0.4/`.
* **1.1.0** — additive, no migration, byte-identity untouched: the combined-dials
  matrix cell (§8.1); `--no-render` and the behavioral-freeze clarification (§7,
  §8.4); the integer-only rule for new event text (§5.2); the canonical palette
  (§2.4); the naming policy (§10).
* **1.0.0** — the founding contract.

## 10. Naming policy

The product name is a **placeholder pending approval**. Rules:

* The display name lives in **exactly one display constant per app**; every
  user-facing surface — titles, headers, the PWA manifest, exports — derives from
  that constant (build-time derivation included). Currently `"Jerrymapping"`; the
  approved fallback is `"ggMapping"`. Renaming the product is a one-constant change.
* Package names, ids, bundle names, and paths never carry the display name: they use
  the neutral prefix **`jm`** (`jm-pwa`, `jm_*` APIs, `jerrymap` engine artifacts
  keep their existing names).
* Since v0.5 the **engine run header** (§5.1) carries the name as byte-frozen log
  text. That surface rides **lineage bumps**, not the display constant: renaming the
  product in the log is a rules-text change under the twin regime.
* CI proves the rule: the name-constant test asserts exactly one occurrence of the
  display name across the app's source constants.

## 11. Experimental dials

**No experiment is live.** The one this section was written for — the fields —
was promoted into canon in 4.0.0 and its dial is gone (§9.1). The rules stay,
because they are how the *next* experiment must arrive: as one **dial, default
OFF**, under all four of these.

* **Canon is untouchable.** With every experimental dial off, the engine is
  byte-identical to the lineage it ships in: the same fixtures, the same matrix,
  no regeneration. This is the headline test, not a footnote — the gate proves it
  on every commit, and any dial-only event must be unreachable with the dial off.
* **No lineage bump.** An experimental dial is a config key like any other dial
  (§6), so state documents keep the lineage they had. If the experiment is
  promoted, the switch disappears, the rules move into the handbook proper, and
  **that** is the lineage break.
* **Proven, not merely implemented.** A canon cell exercises none of a dial's
  code paths, so each dial carries an **experimental cell** (§8.1) proving twin ==
  native == WASM under the dial, reported separately from the canon matrix.
* **Marked wherever a world can travel.** The dial is a config key in saved
  worlds, and any exported config carries an explicit experimental marker, so a
  shared world can never be mistaken for a canon one. Apps must show the run is
  experimental while it is on.

And one more, learned from the promotion: **a promoted dial leaves no stump.**
The key, the flag, the branch, the badge and the gate cell all go at once; a
document still carrying the retired key loads with it ignored (§6.3), so the
worlds people saved under the experiment still open.
