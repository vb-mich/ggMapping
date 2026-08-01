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
  python scripts/run_conformance.py --native build/jerrymap.exe [--twin reference/sim_v07.py]
"""
import argparse
import os
import re
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TWIN = os.path.join(REPO, "reference", "sim_v07.py")

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

    # step 2 is skipped, so nothing from step 6 applies to a Stack panel here
    leaked = [(a, l) for a in addp for l in a["body"]
              if l.startswith("    the city lives")
              or l.startswith("    panel to back of stack")
              or " full, stays in play" in l
              or " COMPLETE, to the Atlas" in l]
    check("ch.6 n.3", f"{label}: no Stack bookkeeping inside an Add Panel age",
          not leaked,
          f"{len(leaked)} stray line(s), e.g. {leaked[0][1].strip() if leaked else ''}")

    # An age that consumes a Stack visit ALWAYS closes with step 6's
    # bookkeeping; the absence of it above is what proves the Add Panel age
    # took no visit. What it must not do is re-serve the same panel twice.
    repeats = [(A[i]["subject"], A[i + 1]["subject"])
               for i, a in enumerate(A[:-1]) if a["card"] == "ADDPANEL"
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

    # ---- chapter 6, the city lives ---------------------------------------
    # "Every visit to a panel that is already full gives that panel's tallest
    #  settlement one climb or sprawl step, whatever the card was."
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
    check("ch.6", f"{label}: every visit to a full panel gives the city its step",
          not missing,
          f"{len(missing)} visit(s) without it, e.g. {missing[0] if missing else ''}")
    check("ch.6", f"{label}: witnessed with non-Settlement cards",
          non_settlement_witnessed > 0,
          f"only {non_settlement_witnessed} such visit(s)")

    # ---- chapter 5: the starting deck ------------------------------------
    # "Here below is the list of cards of your very first deck, a total of 20
    #  cards to start." — 4 Extend 6,7,7,8 | 3 Basin 6,7,8 | 1 Ridge 7 |
    #  1 Great Ridge 7 | 4 Calm 5,6,6,7 | 2 Free Stroke 6,8 | 3 Settlement
    #  6,7,8 | 1 Anomaly 7 | 1 Add Panel 4 (from the end of era one).
    # The genesis deck is shuffled once and the first card played becomes the
    # marker, so the ages before the first cycle marker are exactly one full
    # pass: the deck itself, printed works and all.
    BOOK_DECK = {
        "EXTEND": [6, 7, 7, 8], "BASIN": [6, 7, 8], "RIDGE": [7],
        "GREATRIDGE": [7], "CALM": [5, 6, 6, 7], "FREESTROKE": [6, 8],
        "SETTLEMENT": [6, 7, 8], "ANOMALY": [7],
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

    addp_work = next((int(m.group(1)) for a in A if a["card"] == "ADDPANEL"
                      for l in a["body"]
                      if (m := re.match(r"^    work (\d+), mood", l))), None)
    check("ch.5", f"{label}: Add Panel joins at work 4",
          addp_work == 4, f"got {addp_work}")

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

    # ---- chapter 6, step 7: the calendar ---------------------------------
    # "Move the time dial by 1 age. Remember, every 25 ages, a new era begins."
    lengths = {}
    for a in A:
        lengths[a["era"]] = max(lengths.get(a["era"], 0), a["age"])
    short = [e for e, n in lengths.items() if e < max(lengths) and n != 25]
    check("ch.6 s.7", f"{label}: every completed era runs 25 ages",
          not short, f"era(s) {short} did not")


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
