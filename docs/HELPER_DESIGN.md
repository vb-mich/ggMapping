# The Helper: design contract
For the jerrymapping-app conversation that builds it. Status: commissioning material, not law; CONTRACTS absorbs what survives implementation.

## What it is
The simulator plays a world by itself. The Helper plays it WITH the player: the player's paper map is the truth, the tool does the bookkeeping. Every choice the rules leave open goes to the player; every consequence the rules dictate is computed, shown, and explained in the book's own words. The tester's line that commissioned it: "the simulation becomes useless once I make my own choices."

## The truth hierarchy
1. The paper map is the truth.
2. The Helper's world state follows the paper, so the player can always edit any unit directly (the paint editor) and can override any computed outcome. Overrides are first-class recorded events, not corruptions.
3. The rules explain and validate; they never block. A player who breaks the Step Rule gets told, kindly, and the tool follows them anyway.

## The loop, one age (guided mode, the default)
1. The player says which card was drawn (picker mirroring the deck state), or taps "draw for me". The marker and cycle are tracked; the calendar advances at commit.
2. The engine runs the age to its first open decision and stops.
3. The decision is presented in the right shape:
   * Spatial choices: the LEGAL CANDIDATES highlight on the map; the player taps one. This is the tool's signature interaction.
   * Dice: three buttons of equal dignity, per the book: enter my roll / roll for me / choose the outcome.
4. Repeat until the age closes. Every consequence line previews before commit, in Master Manual vocabulary.
5. Commit writes the age; undo pops whole decisions; an age can be reopened before the next begins.

## Proposal mode (the advisor, one toggle away)
For the player who wants to be shown: select the card and the Helper resolves the WHOLE age as a highlighted proposal on the map, answering every open choice with the simulator's own policies, sequence numbers and all. The player reviews it against their paper, may TAP ANY STEP to take that one decision over (the age drops into guided mode from that point forward), then accepts. Honesty rule: wherever canon says the choice is the player's by law, the ridge's steering, every tie, the dice-optional outcomes, the proposal wears a visible "suggestion" mark: it is the simulator's taste speaking, never the rules. Both modes emit records of identical shape, and the mode is a per-age preference, not a world property.

## The decision surface (extracted from the living twin, v0.9 lineage)
Die kinds, complete as extracted: d6 row, d10 column (and the geometry-sized variants for custom panels), d6 first elevation, d6 wobble, d8 heading (two sites), d4+1 length (inside stroke walks), d6 foundation, d6 grow, d4 farm intensity, d12 anomaly, d4 islets.
Choice kinds, at least: fill spot, basin start, extend run, heading (choice), ridge seed, free seed, panel position, riser, lead city, living city, people base, deepen field. Some call sites carry dynamic labels (place farm_lo and kin), so the EXECUTOR enumerates the definitive set from the engine's Decider seam, where every choice already flows, and records it in CONTRACTS. The UI must fail loudly on an unknown kind rather than guess.

## Engine integration: replay-to-frontier (recommended, executor may rule otherwise with reasons)
No coroutines, no engine surgery. The Helper holds a growing DECISION SCRIPT for the current age. To surface the next question: restore the age-start state (the section 6 state document), run the age through a ScriptedDecider fed the script so far; when the script runs out, the decider returns a sentinel carrying the decision kind and its candidates; the app asks, appends the answer, and reruns. Ages are short; the rerun is invisible. Commit stores the age's script and the closing state. This reuses save/load, ScriptedDecider, and the event stream exactly as they exist, and it makes the whole world a replayable record by construction.

## The record
A Helper world is: config (with lineage), the origin (blank seeding, a forked simulator world, or a lazily entered map), and the ordered script of decisions, overrides, and CHECKPOINTS (state sets from lazy entry, corrections, and away-from-tool catch-ups). Replaying the record reproduces the world byte-for-byte: that is the identity test. Export and import as a single file; IndexedDB for persistence (the digitalizer's db patterns, own database); the lineage badge stamps everything and foreign-lineage records get the standing notice.

## Starting points
* Blank: the twelve seeding panels, era one.
* Fork a simulator world: any seed and config, run to age N, then the Helper takes over. The sim's determinism makes "continue this world by hand" one button.
* An existing paper map: entered LAZILY, see below. Vision import from digitalizer scans is explicitly OUT of scope.

## State entry, lazy by design
An age's mathematics never reaches beyond the working panel and its Spread, so the Helper never demands the whole world:
* **The skeleton first.** One quick screen: tap the grid to say which coordinates hold panels and which are already full (and which are archived). Minutes, not hours. The skeleton is all that Add Panel placement and the Stack need.
* **Detail on demand.** The first time a panel enters play, as the working panel or a Spread member, the Helper asks for its units, with the paint editor right there and the paper panel in the player's hand. A skeleton-full panel can stay a gray silhouette until its day comes.
* **The age-start glance.** Before each age, the current panel and Spread show as the Helper believes them, with one question: does this match your paper? Tap any unit to fix it. Confirm is one tap; correction is the paint editor inline. This is drift's natural predator.
* **Away-from-tool ages.** A player who painted N ages on pure paper catches up in one action: advance the calendar by N and touch up the state. The catch-up is recorded as a CHECKPOINT event (a state set, with the age count), so the record stays replayable and honest: replay reproduces the checkpoint exactly as it reproduces decisions and overrides.
* Beyond-Spread reach (a stroke exiting the far side of a Spread panel into unentered territory) prompts a quick entry of that border, or ends with a kind notice: the player chooses.

## What the player sees
The working panel and its Spread on the canvas (engine-rendered, patina via the engine's map), candidates glowing when a choice is open, the would-be log line as a preview, the deck and calendar, and the instruction text in the book's words with a deep link into the Rulebook reader's chapter.

## Identity and tests
The rules must not fork: the Helper drives the SAME engine through the SAME seam. Headline test: a full game played through the Helper's decision pipeline, then the stored record replayed through the plain ScriptedDecider, byte-identical logs and states. Per-card e2e: one guided age for every instruction kind, including a cliff, a waymark, an override, an undo, and a custom-geometry world. Plus the adopter's path: a mid-map world entered as skeleton only, one panel detailed on demand at its first Spread appearance, an age played, an away-from-tool catch-up of three ages, and the whole record replayed byte-identical, checkpoints included. Plus proposal mode: one age resolved as a proposal, one step of it taken over by hand, accepted, and the record still replays byte-identical: the two modes may never diverge in what they write. The nine-cell gate is untouched.

## Out of scope, v1
Digitalizer-image recognition, multiplayer, timeline scrubbing beyond replay (the record IS a timeline; a simple view-at-age via replay may ship if free), and any rules divergence whatsoever.
