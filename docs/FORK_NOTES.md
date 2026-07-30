# Jerrymapping fork notes, reference v0.1
Authority: 0-Jerrymapping-the-game.md (beta 0.1). This reference implements it as one game: panels never retire, the land freezes once painted, reworks decorate, anomalies alone command the rock.

## Deltas from The Endless Map reference
* One mode, always on (the book's semi-living game). Standard, Living Map, Living Deck machinery removed from play.
* Work numbers: single, as printed (the community ruling). The paint/rework split is NOT implemented.
* Farmland intensity: d4, 1-2 low, 3-4 high.
* Growth roll 5-6: climb, else sprawl; no farmland intensify fallback; a failed step reworks the town.
* Add Panel carries the shuffle: the deck shuffles after every Add Panel visit. The era-one cycle marker retires once Add Panel wakes (end of era one).
* Volcano: the ring becomes hills; settlements on the ring are destroyed.
* An impossible settlement reworks its rolled unit (blank ground still leaves a waymark).
* Vocabulary: panels, ages, reworks, in every log line.

## Simulator policies for the book's open choices
Choices are resolved by the reference's pick convention (logged). The rework-on-full walk uses the rolled-start consecutive walk. Wonder marks the rolled unit. Ruins and oasis use distance 3 for "far". The healing's artistic-freedom clause is human-only; the engine applies only the coastal-to-plain rule. The late-game pass-over option and the optional archive are not implemented in v0.1 (both are player options; dials can follow).

## Findings for the beta tuning session
* Add Panel works 4, as the handbook prints (corrected after a reference error caught in porting review: an earlier reference build carried 9). The mountain-chunk mechanism is dead by construction at 4.
* The shuffle rider makes Add Panel an every-10.5-ages card, not every-20: growth about 2.3 panels per era. If slower growth is wanted, drop the rider or accept the pace. Raising Add Panel's work (the old 9) is a tuning dial for the beta session.
* Baseline, 3 seeds, 20 eras, at work 4: water 41.0, coastal 15.1, plain 22.3, hills 12.6, mountains 9.0; mountain elongation about 32, biggest formation 48; about 47 reworks per panel; 38 shore healings per run; about 2.4 panels per era (58 by era 20); urban medium by era 2.7.
* Book gap: Step 5 references the Cliff exception but never defines it; paste canon's paragraph.
* The card kind is addpanel end to end: config key, CLI flag, engine identifiers, and logs. No addtile vocabulary exists in this lineage.
* Community finding, measured: the Calm deck (Extend 0, Calm 8 at work 7) is a coherent alternate world: plain 41, long mountain ranges (elongation 170), water 24 with unity halved, patina held at 46 reworks per panel, cities near era 4. The calm work 7 override is load-bearing: at printed 6 the ranges collapse to blobs. A candidate named deck for chapter 10, beside the base deck, not replacing it.

## Tuning dials, v0.2
Three dial families join the config and CLI. All defaults reproduce the handbook's game exactly (byte-identity verified against v0.1); the dials exist for exploration sessions like the Calm deck's.
* stroke_die (4) and stroke_add (1): the rolled stroke length, die plus bonus, at every d4+1 site: basin seed strokes, basin grow, free strokes, and extend's inward carry. Ridge lengths stay the player's choice. Measured flavor: d6+2 lifts water to about 46 and ocean unity to 73: longer strokes, bigger seas.
* greatridge_die (none) and greatridge_add (0): a simulator policy dial. The handbook's Great Ridge length is chosen, 4 to 10, and that stays the default; setting a die makes the engine roll instead. Analog players always choose.
* extend_cap (4): runs of cap or more count the same in Extend's contest; 0 or empty removes the cap and the true longest run wins.
Config compatibility warning: configs exported before v0.2 may carry these keys as inert leftovers; after v0.2 they are live. In particular greatridge_die 4 with add 2 in an old export would roll 3 to 6 instead of the chosen 4 to 10. Re-export, or delete keys you did not set deliberately.

## The archival dial, v0.3
* archive_chance (default 0): a percent, 0 to 100. When a panel first becomes complete, roll the chance once (a logged chance line); on success the panel goes to the Atlas: it leaves the visit rotation and never returns, logged "panel N COMPLETE, to the Atlas". Visiting an already complete panel never rolls. At zero the dial sleeps and the game is byte-identical to v0.2.
* World-state policy: archival removes the panel from rotation only. Its paint, people, and constraints remain part of the world for every rule (the Step Rule, fill counting, the settlement zone): the binder is storage, not erasure, exactly as retired panels always behaved in the parent lineage.
* The era row gains an "archived" clause only when the dial is set. The stack-empty free panel rule is the safety net under heavy archiving, and it is also the growth accelerator the handbook's growth knob describes: archiving drains the rotation, the stack empties sooner, free panels arrive.

## The portable RNG, v0.4: the C++ contract
Every random draw flows through one generator with one specification, so any port can be bit-exact. New world lineage: seeds speak a new dialect; the game is statistically unchanged.
* Generator: PCG32. 64-bit state, multiplier 6364136223846793005, fixed stream: increment (54 << 1) | 1. Seeding: state = 0; advance once; state += seed (mod 2^64); advance once. Output per advance: old = state; state = old * multiplier + increment (mod 2^64); xorshifted = ((old >> 18) xor old) >> 27, as 32 bits; rot = old >> 59; output = rotate right 32(xorshifted, rot).
* bounded(n), uniform 0 to n-1: threshold t = 2^32 mod n; draw r until r >= t; return r mod n.
* die(n) = 1 + bounded(n). pick(sorted seq): one element consumes no draw; otherwise seq[bounded(len)]. shuffle: Fisher-Yates from the top, i from len-1 down to 1, j = bounded(i+1), swap. chance(p): m = round(p * 1000) per-mille, computed once at config time; hit iff next < (m << 32) / 1000, integer division. The engine is float-free; percents allow one decimal.
