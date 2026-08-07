#!/usr/bin/env python3
"""The book-conformance suite: does the SIMULATOR play the game the HANDBOOK
describes?

The identity gate proves the twin and the engine agree with each other. It
cannot see a rule both implementations read the same wrong way — that is
exactly how the v0.6.1 erratum survived (the Add Panel placement line printed a
Manhattan sum where the engine scored by squared distance; both sides agreed,
both sides were wrong about the book). This suite is the mitigation: every
check cites the handbook passage it enforces, and it runs against BOTH
implementations, so a shared misreading has somewhere to fail.

Checks read the rendered log and the engine's structured event stream; they
assert properties of the game, never byte equality (that is the gate's job).

Usage:
  python scripts/run_conformance.py --native build/jerrymap.exe [--twin reference/sim_v10.py]
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TWIN = os.path.join(REPO, "reference", "sim_v10.py")

checks = []


def check(cite, name, ok, detail=""):
    checks.append((cite, name, ok))
    mark = "PASS  " if ok else "FAIL  "
    print(f"{mark}[{cite}] {name}" + (f"\n        {detail}" if detail and not ok else ""))


def run(cmd, outdir):
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout.decode(errors="replace"))
        sys.stderr.write(r.stderr.decode(errors="replace"))
        raise SystemExit(f"FAILED: {' '.join(str(c) for c in cmd)}")


def read_log(outdir, seed):
    with open(os.path.join(outdir, f"seed{seed}_log.txt"), encoding="utf8") as f:
        return f.read().replace("\r\n", "\n").split("\n")


AGE_RE = re.compile(r"^\[e(\d+) a(\d+)\] (.+?) \| ([A-Z]+)$")


def ages(lines):
    """Split a run log into ages: (era, age, subject, card, body_lines)."""
    out, cur = [], None
    for line in lines:
        m = AGE_RE.match(line)
        if m:
            if cur:
                out.append(cur)
            cur = dict(era=int(m.group(1)), age=int(m.group(2)),
                       subject=m.group(3), card=m.group(4), body=[])
        elif cur is not None:
            cur["body"].append(line)
    if cur:
        out.append(cur)
    return out


# --------------------------------------------------------------------------
# The people map, rebuilt from the log.
#
# Every settlement rule in chapter 9 is about neighbours, so a check on those
# rules needs positions. The log gives them: every placement names its unit,
# and the two things that move afterwards — an upgrade and a crumble — change a
# unit's KIND, never the set of occupied units, which is what a settlement
# component is built from. One event escapes: "the anomaly strikes the homes"
# names no unit, so a run carrying one is reconstructed with that unit still
# standing. The checks below count those and say so.
PANEL_W, PANEL_H = 5, 6


def panel_of_name(s):
    m = re.match(r"^([NS])(\d+)/([EW])(\d+)$", s)
    if not m:
        return None
    ty = int(m.group(2)) * (1 if m.group(1) == "N" else -1)
    tx = int(m.group(4)) * (1 if m.group(3) == "E" else -1)
    return tx, ty


def unit_at(t, row, col):
    """The handbook's r/c inside a panel -> the world unit (twin geometry)."""
    tx, ty = t
    ox = (tx - 1 if tx > 0 else tx) * PANEL_W
    oy = (-ty if ty > 0 else -ty - 1) * PANEL_H
    return ox + col - 1, oy + row - 1


def around(u):
    return [(u[0] + dx, u[1] + dy)
            for dx in (-1, 0, 1) for dy in (-1, 0, 1) if dx or dy]


def component_at(people, u):
    """The settlement component u belongs to: people, flooded 8-ways."""
    comp, q = set(), [u]
    while q:
        w = q.pop()
        if w in comp:
            continue
        comp.add(w)
        for v in around(w):
            if v in people and v not in comp:
                q.append(v)
    return comp


PLACE_RE = re.compile(r"^    \d+\. people (\w+) at r(\d+)c(\d+) (\S+)")
DEEPEN_RE = re.compile(r"^    \d+\. the field deepens at r(\d+)c(\d+) (\S+)")
GROWDIE_RE = re.compile(r"^    d6=(\d) \(grow\)$")


def walk_people(lines):
    """Replay the log's settlement events, yielding (event, unit, kind, band,
    people-before) with `people` mutated in place after each yield."""
    people, band = {}, None
    for l in lines:
        g = GROWDIE_RE.match(l)
        if g:
            band = int(g.group(1))
            continue
        d = DEEPEN_RE.match(l)
        if d:
            p = panel_of_name(d.group(3))
            u = unit_at(p, int(d.group(1)), int(d.group(2)))
            yield "deepen", u, people.get(u), band, people
            people[u] = "farm_hi"
            band = None
            continue
        m = PLACE_RE.match(l)
        if m:
            p = panel_of_name(m.group(4))
            u = unit_at(p, int(m.group(2)), int(m.group(3)))
            yield "place", u, m.group(1), band, people
            people[u] = m.group(1)
            band = None
            continue
        if l.startswith("    ") and "settlement: " in l:
            band = None


# --------------------------------------------------------------------------
# The checks. Each cites the passage it enforces.
# --------------------------------------------------------------------------

def conform(lines, label):
    A = ages(lines)
    assert A, f"{label}: no ages parsed"

    # ---- chapter 6, note 3: Add Panel is the working panel ----------------
    # "If you pick an 'Add Panel' card, skip step 2: the new panel you place is
    #  your current working panel for this turn. You work on one panel and one
    #  Spread, always."
    addp = [a for a in A if a["card"] == "ADDPANEL"]
    check("ch.6 n.3", f"{label}: the run contains Add Panel ages to inspect",
          len(addp) > 0)

    bad_header = [a for a in addp if a["subject"] != "the new panel"]
    check("ch.6 n.3", f"{label}: an Add Panel age's header names the new panel",
          not bad_header,
          f"{len(bad_header)} age(s) named a Stack panel instead")

    # the placed panel takes the fill: the age says so, and the fills follow
    no_claim = [a for a in addp
                if not any(l.startswith("    the current working panel is the new panel")
                           for l in a["body"])
                and not any("addpanel:" in l for l in a["body"])]
    check("ch.6 n.3", f"{label}: the placed panel becomes the working panel",
          not no_claim, f"{len(no_claim)} age(s) never claimed the new panel")

    # step 2 is skipped, so nothing from step 7's bookkeeping ("Put things
    # back") applies to a Stack panel here
    leaked = [(a, l) for a in addp for l in a["body"]
              if l.startswith("    the city lives")
              or l.startswith("    panel to back of stack")
              or " full, stays in play" in l
              or " COMPLETE, to the Atlas" in l]
    check("ch.6 n.3", f"{label}: no Stack bookkeeping inside an Add Panel age",
          not leaked,
          f"{len(leaked)} stray line(s), e.g. {leaked[0][1].strip() if leaked else ''}")

    # An age that consumes a Stack visit ALWAYS closes with step 7's
    # bookkeeping; the absence of it above is what proves the Add Panel age
    # took no visit. What it must not do is re-serve the same panel twice.
    # (two Add Panel copies since v0.9 can land back to back; both headers
    # read "the new panel", which is a phrase, not a panel — skip those)
    repeats = [(A[i]["subject"], A[i + 1]["subject"])
               for i, a in enumerate(A[:-1]) if a["card"] == "ADDPANEL"
               and A[i + 1]["card"] != "ADDPANEL"
               and A[i + 1]["subject"] == a["subject"]]
    check("ch.6 n.3", f"{label}: an Add Panel age consumes no Stack visit",
          not repeats)

    # a placed panel enters the Stack exactly once: it is never placed twice
    placed = [re.search(r"new panel (\S+) \(score", l).group(1)
              for a in A for l in a["body"] if "new panel " in l and "(score" in l]
    check("ch.9", f"{label}: every placed panel is placed exactly once",
          len(placed) == len(set(placed)),
          f"{len(placed) - len(set(placed))} duplicate placement(s)")

    # ---- chapter 9: placement scores by squared distance ------------------
    # "Square each of the position's two numbers and add them: this is the
    #  position's distance score (N2/E3 scores 4 + 9 = 13)."
    bad_score = []
    for a in A:
        for l in a["body"]:
            m = re.search(r"new panel ([NS])(\d+)/([EW])(\d+) \(score (\d+)\)", l)
            if m:
                ty, tx = int(m.group(2)), int(m.group(4))
                if ty * ty + tx * tx != int(m.group(5)):
                    bad_score.append(l.strip())
    check("ch.9", f"{label}: the printed placement score is the squared distance",
          not bad_score, f"e.g. {bad_score[0] if bad_score else ''}")

    # ---- chapter 6 step 6, "Increase population" --------------------------
    # "Every visit to a panel that is already full, gives that panel's tallest
    #  settlement one climb or sprawl step (see Chapter 9, Settlement),
    #  whatever the card was." (The book renumbered its steps and named this
    #  one; the ENGINE LOG still says "the city lives" and that text is
    #  byte-frozen by the gate — the check reads the log, cites the book.)
    # A panel is full from the age that reports it "full, stays in play"; every
    # later visit to it must carry the step — including non-Settlement cards.
    # The rule speaks of "that panel's tallest settlement", so it applies to
    # panels that HAVE one: a full panel of bare ground has no city to live.
    full, settled = set(), set()
    missing, non_settlement_witnessed = [], 0
    people_re = re.compile(r"people \w+ at r\d+c\d+ (\S+)")
    for a in A:
        subj = a["subject"]
        if subj.startswith("panel ") and subj[6:] in full and subj[6:] in settled:
            if not any(l.startswith("    the city lives") for l in a["body"]):
                missing.append((a["era"], a["age"], subj, a["card"]))
            elif a["card"] != "SETTLEMENT":
                non_settlement_witnessed += 1
        for l in a["body"]:
            if " full, stays in play" in l:
                full.add(l.strip().split()[1])
            m = people_re.search(l)
            if m:
                settled.add(m.group(1))
    check("ch.6 s.6", f"{label}: every visit to a full panel gives the city its step",
          not missing,
          f"{len(missing)} visit(s) without it, e.g. {missing[0] if missing else ''}")
    check("ch.6 s.6", f"{label}: witnessed with non-Settlement cards",
          non_settlement_witnessed > 0,
          f"only {non_settlement_witnessed} such visit(s)")

    # ---- chapter 5: the starting deck ------------------------------------
    # The community's deck, canon since v0.9 — 1 Extend 7 | 3 Basin 6,7,8 |
    # 1 Ridge 7 | 1 Great Ridge 7 | 7 Calm 5,6,6,6,6,6,7 | 2 Free Stroke 6,8 |
    # 4 Settlement 6,7,7,8 | 1 Anomaly 7 | 2 Add Panel 3,5 (from the end of
    # era one). 22 cards; 20 sit in the era-one deck.
    # The genesis deck is shuffled once and the first card played becomes the
    # marker, so the ages before the marker's return are exactly one full
    # pass: the deck itself, printed works and all — and the marker's return
    # closes the first cycle on era-one age 21 (20 cards + the marker again).
    BOOK_DECK = {
        "EXTEND": [7], "BASIN": [6, 7, 8], "RIDGE": [7],
        "GREATRIDGE": [7], "CALM": [5, 6, 6, 6, 6, 6, 7], "FREESTROKE": [6, 8],
        "SETTLEMENT": [6, 7, 7, 8], "ANOMALY": [7],
    }
    first_cycle = next((i for i, a in enumerate(A)
                        if any(l == "    the deck completed its cycle" for l in a["body"])),
                       None)
    genesis = {}
    for a in A[:first_cycle or 0]:
        work = next((int(m.group(1)) for l in a["body"]
                     if (m := re.match(r"^    work (\d+), mood", l))), None)
        genesis.setdefault(a["card"], []).append(work)
    got = {k: sorted(v) for k, v in genesis.items()}
    check("ch.5", f"{label}: the starting deck is the book's table",
          got == BOOK_DECK, f"got {got}")
    check("ch.5", f"{label}: the first cycle closes on era-one age 21",
          first_cycle is not None and A[first_cycle]["era"] == 1
          and A[first_cycle]["age"] == 21,
          f"marker returned at "
          f"{(A[first_cycle]['era'], A[first_cycle]['age']) if first_cycle is not None else None}")

    addp_works = sorted(int(m.group(1)) for a in A if a["card"] == "ADDPANEL"
                        for l in a["body"]
                        if (m := re.match(r"^    work (\d+), mood", l)))
    # every Add Panel age replays one of the two printed numbers
    check("ch.5", f"{label}: the two Add Panel copies print 3 and 5",
          bool(addp_works) and set(addp_works) == {3, 5},
          f"works seen: {sorted(set(addp_works))}")
    check("ch.5", f"{label}: no Add Panel age inside era one",
          not any(a["card"] == "ADDPANEL" and a["era"] == 1 for a in A))

    # ---- chapter 7, step 3: the First Elevation table --------------------
    # "if the chosen unit has no countable side neighbors ... roll d6 on the
    #  First Elevation table": 1 shallow, 2 coastal, 3-4 plain, 5 hills,
    #  6 mountains. With no countable neighbour the Step Rule is wide open,
    #  so the roll reaches the paint unmodified.
    TABLE = {1: "shallow", 2: "coastal", 3: "plain", 4: "plain",
             5: "hills", 6: "mountains"}
    flat = [l for a in A for l in a["body"]]
    bad_first = []
    for i, l in enumerate(flat):
        m = re.match(r"^    d6=(\d) \(first elevation\)$", l)
        if not m:
            continue
        nxt = flat[i + 1] if i + 1 < len(flat) else ""
        p = re.match(r"^    \d+\. paint r\d+c\d+ \S+ (\w+) \(fill\)$", nxt)
        if not p or p.group(1) != TABLE[int(m.group(1))]:
            bad_first.append((l.strip(), nxt.strip()))
    check("ch.7 s.3", f"{label}: the First Elevation table is obeyed",
          not bad_first,
          f"{len(bad_first)} mismatch(es), e.g. {bad_first[0] if bad_first else ''}")

    # ---- chapter 9: farmland intensity -----------------------------------
    # "For the farmland intensity, roll 1d4: 1-2 is LOW, 3-4 HIGH."
    bad_farm = []
    for i, l in enumerate(flat):
        m = re.match(r"^    d4=(\d) \(farm intensity\)$", l)
        if not m:
            continue
        want = "farm_lo" if int(m.group(1)) <= 2 else "farm_hi"
        for nxt in flat[i + 1:i + 6]:
            got_kind = re.search(r"\((?:place )?(farm_lo|farm_hi)\)|people (farm_lo|farm_hi) at", nxt)
            if got_kind:
                kind = got_kind.group(1) or got_kind.group(2)
                if kind != want:
                    bad_farm.append((l.strip(), nxt.strip()))
                break
    check("ch.9", f"{label}: farmland intensity is d4, 1-2 low",
          not bad_farm,
          f"{len(bad_farm)} mismatch(es), e.g. {bad_farm[0] if bad_farm else ''}")

    # ---- chapter 9: the growth d6 bands ----------------------------------
    # "1-2 farmland | 3-4 rural | 5-6 raise the densest unit that can legally
    #  rise ... If nothing can rise, place a rural beside the busiest part."
    # Each band forbids the other bands' outcomes; the 5-6 fallback may place
    # a rural, which is why rural is not forbidden there.
    FORBIDDEN_BY_BAND = {
        "farmland": ["upgrade to ", "cannot climb, sprawls", "nothing can grow",
                     "no room for rural", "people rural at"],
        "rural": ["upgrade to ", "the field deepens", "people farm_",
                  "no room for farmland", "nothing can grow"],
        "raise": ["the field deepens", "people farm_", "no room for farmland",
                  "no room for rural"],
    }
    bad_grow = []
    for i, l in enumerate(flat):
        m = re.match(r"^    d6=(\d) \(grow\)$", l)
        if not m:
            continue
        d = int(m.group(1))
        band = "farmland" if d <= 2 else "rural" if d <= 4 else "raise"
        for nxt in flat[i + 1:]:
            if re.match(r"^    d6=\d \(grow\)$", nxt) or nxt.startswith("    work "):
                break
            for bad in FORBIDDEN_BY_BAND[band]:
                if bad in nxt:
                    bad_grow.append((d, band, nxt.strip()))
    check("ch.9", f"{label}: the growth d6 bands are obeyed",
          not bad_grow,
          f"{len(bad_grow)} stray outcome(s), e.g. {bad_grow[0] if bad_grow else ''}")

    # ---- chapter 9: fields are not people (canon since v0.8) --------------
    # "A farmed unit is not a home. It never blocks a density step, never
    #  counts as support for one, and is never itself subject to one."
    # Where the units are is not printed as a map, so the checks below rebuild
    # it from the placements (see walk_people).
    URBAN = ("urb_lo", "urb_md", "urb_hi")
    strikes = 0
    deepenings, clearings, early_clear, unlocatable = [], 0, [], 0
    for l in lines:
        if "the anomaly strikes the homes" in l:
            strikes += 1
    for ev, u, kind, band, people in walk_people(lines):
        if ev == "deepen":
            # it deepened something, and that something was a LOW field, in the
            # farmland band: "deepen it to high" acts on a low field or not at all
            deepenings.append((u, kind, band))
            continue
        if not kind.startswith("farm"):
            continue
        if band in (1, 2):
            # this farmland step cleared new ground; the settlement it grew
            # from is one of the components the new field touches
            clearings += 1
            comps = [component_at(people, v) for v in around(u) if v in people]
            clean = [c for c in comps
                     if not any(people.get(w) == "farm_lo" for w in c)]
            if comps and not clean:
                early_clear.append(u)

    check("ch.9", f"{label}: deepening only ever takes a LOW field, in the d6 1-2 band",
          bool(deepenings) and all(k == "farm_lo" and b in (1, 2)
                                   for _, k, b in deepenings),
          f"{len(deepenings)} deepening(s), offenders: "
          f"{[d for d in deepenings if d[1] != 'farm_lo' or d[2] not in (1, 2)][:3]}")
    check("ch.9", f"{label}: the farm step deepens while a low field remains, "
          f"and only then clears new ground",
          not early_clear,
          f"{len(early_clear)} of {clearings} clearing(s) left a low field "
          f"standing, e.g. {early_clear[:3]}"
          + (f" (note: {strikes} unlocatable removal(s) in this run)"
             if strikes else ""))
    check("ch.9", f"{label}: fields are worked in both intensities and deepen",
          len(deepenings) > 0 and clearings > 0,
          f"{len(deepenings)} deepening(s), {clearings} clearing(s)")

    # ---- chapter 9: the Ridge and Great Ridge length ranges ---------------
    # "Choose the length: 2 to 5 units for Ridge, 5 to 10 for Great Ridge."
    # Both are the player's CHOICE, so the log prints the size of the choice:
    # four options for a Ridge, six for a Great Ridge since v0.10 raised the
    # floor from 4 (a Great Ridge could come out shorter than a lucky Ridge).
    WANT_LENGTH_CHOICES = {"RIDGE": 4, "GREATRIDGE": 6}
    len_seen, len_bad = {"RIDGE": 0, "GREATRIDGE": 0}, []
    for a in A:
        if a["card"] not in WANT_LENGTH_CHOICES:
            continue
        for l in a["body"]:
            m = re.match(r"^    choice among (\d+) \(length \(choice\)\)$", l)
            if not m:
                continue
            len_seen[a["card"]] += 1
            if int(m.group(1)) != WANT_LENGTH_CHOICES[a["card"]]:
                len_bad.append((a["era"], a["age"], a["card"], int(m.group(1))))
    check("ch.9", f"{label}: Ridge chooses among 4 lengths, Great Ridge among 6",
          not len_bad and all(n > 0 for n in len_seen.values()),
          f"seen {len_seen}, offenders {len_bad[:3]}")

    # ---- chapter 8: the ghost stroke --------------------------------------
    # "A stroke always walks its whole length. Ending is not stopping. When a
    #  stroke ends early ... keep walking the steps it has left along the path
    #  it would have taken ... Units it cannot [paint], it reworks if they are
    #  already painted, and skips if they are blank. The walk stops for good
    #  only at the edge of the map."
    STROKES = ("ridge", "basin seed", "basin grow", "extend", "free stroke")
    # two shapes carry an ending: "<stroke>: <reason>, ends" and
    # "<stroke>: ends at map edge, heading X" — match the whole tail
    END_RE = re.compile(r"^    (" + "|".join(STROKES) + r"): (.*ends.*)$")
    STEP_RE = re.compile(r"^    \d+\. (?:paint|rework) .*\((" + "|".join(STROKES) + r")\)$")
    ghost_walks, edge_stops, walked_past_edge = 0, 0, []
    for a in A:
        ended = {}  # label -> reason, the first ending of each stroke label
        for l in a["body"]:
            e = END_RE.match(l)
            if e and e.group(1) not in ended:
                ended[e.group(1)] = e.group(2)
                continue
            s = STEP_RE.match(l)
            if s and s.group(1) in ended:
                if "map edge" in ended[s.group(1)]:
                    walked_past_edge.append((a["era"], a["age"], l.strip()))
                elif l.lstrip().split(". ", 1)[1].startswith("rework"):
                    ghost_walks += 1
        edge_stops += sum(1 for r in ended.values() if "map edge" in r)

    check("ch.8", f"{label}: a stroke that ends early keeps walking, reworking as it goes",
          ghost_walks > 0,
          "no rework followed an early ending in this run")
    check("ch.8", f"{label}: the walk stops for good only at the edge of the map",
          not walked_past_edge and edge_stops > 0,
          f"{len(walked_past_edge)} step(s) after an edge stop, e.g. "
          f"{walked_past_edge[0] if walked_past_edge else ''}; {edge_stops} edge stop(s)")

    # ---- the v0.9 rider: the water target is gone -------------------------
    # FORK_NOTES §v0.9: the parent-calibrated "(target 30-40)" described a
    # mean, not a world (8 of 20 canon worlds ever landed inside it), and it
    # left the metrics footer with the lineage break.
    check("v0.9", f"{label}: the footer-target string appears nowhere",
          not any("(target 30-40)" in l for l in lines))

    # ---- chapter 6 step 8, "Advance the calendar" (was step 7) ------------
    # "Move the time dial by 1 age. Remember, every 25 ages, a new era begins."
    lengths = {}
    for a in A:
        lengths[a["era"]] = max(lengths.get(a["era"], 0), a["age"])
    short = [e for e, n in lengths.items() if e < max(lengths) and n != 25]
    check("ch.6 s.8", f"{label}: every completed era runs 25 ages",
          not short, f"era(s) {short} did not")


def beside_urban_witnesses(lines):
    """Farm placements whose reconstructed neighbourhood holds an urban unit."""
    URBAN = ("urb_lo", "urb_md", "urb_hi")
    hits = 0
    for ev, u, kind, band, people in walk_people(lines):
        if ev == "place" and kind.startswith("farm"):
            if any(people.get(v) in URBAN for v in around(u)):
                hits += 1
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native", required=True, help="path to the native jerrymap CLI")
    ap.add_argument("--twin", default=DEFAULT_TWIN,
                    help="path to the Python twin (pass 'none' to skip)")
    ap.add_argument("--seed", default="42")
    ap.add_argument("--eras", default="20")
    ap.add_argument("--workdir", default=None)
    args = ap.parse_args()

    work = args.workdir or tempfile.mkdtemp(prefix="jerrymap-conformance-")
    flags = ["--seed", args.seed, "--eras", args.eras]

    d = os.path.join(work, "native")
    run([os.path.abspath(args.native), "--out", d] + flags, d)
    conform(read_log(d, args.seed), "native")

    # ch. 9: "a field ... is never itself subject to one" — sown beside a town
    # however dense. The witness (a farm placed with an urban neighbour visible
    # in the log) is seed-dependent, so a small native sweep looks for it; the
    # gate's own cells prove these logs byte-identical across implementations,
    # so a native witness speaks for the twin too. The constructed case (which
    # cannot miss) is in engine/tests.
    WITNESS_SEEDS = [args.seed, "11", "1234"]
    witnesses = 0
    for s in WITNESS_SEEDS:
        dd = os.path.join(work, "witness", s)
        if s == args.seed:
            dd = d  # reuse the native run above
        else:
            run([os.path.abspath(args.native), "--out", dd, "--seed", s,
                 "--eras", args.eras], dd)
        witnesses += beside_urban_witnesses(read_log(dd, s))
    check("ch.9", "native: a field is sown beside a town, whatever its density"
          f" (sweep of seeds {','.join(WITNESS_SEEDS)})",
          witnesses > 0, "no witness at any swept seed")

    # v0.9.1, the max panels dial (FORK_NOTES §v0.9.1): "A capped map turns
    # Add Panel days into rework days on the front panel, logged 'the map is
    # at its edge'. The free-panel safety net when the Stack empties IGNORES
    # the cap ... cap 20 holds exactly 20 panels over 20 eras, deterministic."
    # Both implementations run capped; their logs must agree to the byte.
    cap_native = os.path.join(work, "cap", "native")
    run([os.path.abspath(args.native), "--out", cap_native, "--seed", "42",
         "--eras", "20", "--max-panels", "20"], cap_native)
    cap_log = read_log(cap_native, "42")
    panels_line = next((l for l in cap_log if l.startswith("total units ")), "")
    check("v0.9.1", "capped native: cap 20 holds exactly 20 panels",
          "| panels 20 " in panels_line, panels_line)
    check("v0.9.1", "capped native: the edge-rework line appears",
          any("addpanel: the map is at its edge" in l for l in cap_log))
    check("v0.9.1", "capped native: the cap is never exceeded mid-run",
          not any(re.search(r"done \d+/(\d+) panels", l) and
                  int(re.search(r"done \d+/(\d+) panels", l).group(1)) > 20
                  for l in cap_log))
    if args.twin and args.twin.lower() != "none":
        cap_twin = os.path.join(work, "cap", "twin")
        run([sys.executable, os.path.abspath(args.twin), "--out", cap_twin,
             "--seed", "42", "--eras", "20", "--max-panels", "20",
             "--no-render"], cap_twin)
        check("v0.9.1", "capped: twin and engine agree to the byte",
              read_log(cap_twin, "42") == cap_log)

    if args.twin and args.twin.lower() != "none":
        d = os.path.join(work, "twin")
        run([sys.executable, os.path.abspath(args.twin), "--out", d,
             "--no-render"] + flags, d)
        conform(read_log(d, args.seed), "twin")

    bad = [f"[{c}] {n}" for c, n, ok in checks if not ok]
    print()
    print(f"CONFORMANCE: {len(checks) - len(bad)}/{len(checks)} checks pass"
          + ("" if not bad else f" — {len(bad)} FAILED"))
    raise SystemExit(0 if not bad else 1)


if __name__ == "__main__":
    main()
