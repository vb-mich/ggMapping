#!/usr/bin/env python3
"""The additional proofs (CONTRACTS §8.3), against the native CLI:

1. Scripted-decider: record an auto run's decisions, replay them through the
   ScriptedDecider, byte-identical log (the re-roll machinery works).
2. Save-load-resume: save at a mid-era age boundary, resume; the concatenated
   log equals the uninterrupted run's, and the end states serialize identically.
3. Dial suites carried from the reference: explicit defaults are byte-identical
   to the bare baseline (dials at rest change nothing); each dialed cell
   differs from baseline (dials are live).
4. Vocabulary law over every log this script produces.

Usage: python scripts/run_proofs.py --native build/jerrymap.exe
"""
import argparse, os, re, subprocess, sys, tempfile

# The total vocabulary law (CONTRACTS §1, v0.5): no exemptions remaining.
FORBIDDEN = re.compile(rb"tile|visit|rung", re.IGNORECASE)
checks = []


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout.decode(errors="replace"))
        sys.stderr.write(r.stderr.decode(errors="replace"))
        raise SystemExit(f"FAILED: {' '.join(cmd)}")


def read(path):
    with open(path, "rb") as f:
        return f.read()


def check(name, ok):
    checks.append((name, ok))
    print(("PASS  " if ok else "FAIL  ") + name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native", required=True)
    ap.add_argument("--workdir", default=None)
    args = ap.parse_args()
    exe = os.path.abspath(args.native)
    work = args.workdir or tempfile.mkdtemp(prefix="jerrymap-proofs-")
    d = lambda *p: os.path.join(work, *p)
    logs = []

    # -- 1. scripted-decider ------------------------------------------------
    tape = d("tape.jsonl")
    run([exe, "--seed", "42", "--eras", "20", "--out", d("rec"), "--record", tape])
    run([exe, "--seed", "42", "--eras", "20", "--out", d("rep"), "--replay", tape])
    a, b = read(d("rec", "seed42_log.txt")), read(d("rep", "seed42_log.txt"))
    logs += [a, b]
    check("scripted-decider replay is byte-identical", a == b)

    # -- 2. save-load-resume ------------------------------------------------
    run([exe, "--seed", "42", "--eras", "20", "--out", d("full"),
         "--save", d("state_full_end.json")])
    run([exe, "--seed", "42", "--eras", "20", "--out", d("part1"),
         "--save-at", "253", "--save", d("state_mid.json")])
    run([exe, "--load", d("state_mid.json"), "--out", d("part2"),
         "--save", d("state_resumed_end.json")])
    full = read(d("full", "seed42_log.txt"))
    part = read(d("part1", "seed42_log.txt")) + read(d("part2", "seed42_log.txt"))
    logs += [full]
    check("mid-era save+resume log equals uninterrupted log", part == full)
    check("end states serialize identically",
          read(d("state_full_end.json")) == read(d("state_resumed_end.json")))

    # -- 3. dial suites -----------------------------------------------------
    run([exe, "--seed", "42", "--eras", "20", "--out", d("dial_defaults"),
         "--archive-chance", "0", "--stroke-die", "4", "--stroke-add", "1",
         "--greatridge-add", "0", "--extend-cap", "4"])
    base = read(d("full", "seed42_log.txt"))
    defaults = read(d("dial_defaults", "seed42_log.txt"))
    check("explicit default dials are byte-identical to baseline", defaults == base)
    for name, flags in [
        ("archive-chance 25", ["--archive-chance", "25"]),
        ("stroke d6+2", ["--stroke-die", "6", "--stroke-add", "2"]),
        ("greatridge die 6 add 2", ["--greatridge-die", "6", "--greatridge-add", "2"]),
        ("extend-cap 0", ["--extend-cap", "0"]),
        ("combined dials", ["--archive-chance", "25", "--stroke-die", "6",
                            "--stroke-add", "2", "--greatridge-die", "6",
                            "--greatridge-add", "2", "--extend-cap", "0"]),
    ]:
        out = d("dial_" + name.replace(" ", "_"))
        run([exe, "--seed", "42", "--eras", "20", "--out", out] + flags)
        data = read(os.path.join(out, "seed42_log.txt"))
        logs.append(data)
        check(f"dial live: {name} diverges from baseline", data != base)

    # -- 4. the fields, canon since v0.8 (handbook ch. 9) -------------------
    # The rules cannot be turned off: a canon run deepens fields, and the flag
    # that used to select them is gone from the surface entirely.
    check("the dial is gone: --exp-fields is rejected",
          subprocess.run([exe, "--seed", "42", "--eras", "2", "--out", d("nodial"),
                          "--exp-fields"], capture_output=True).returncode != 0)
    check("canon deepens fields (ch. 9 growth d6 1-2)",
          b"the field deepens at " in base)

    # -- 5. the map cap (v0.9.1, FORK_NOTES): a capped map holds its cap ----
    run([exe, "--seed", "42", "--eras", "20", "--out", d("cap20"),
         "--max-panels", "20"])
    capped = read(d("cap20", "seed42_log.txt"))
    logs.append(capped)
    check("dial live: max-panels 20 diverges from baseline", capped != base)
    check("a capped run holds exactly the cap",
          b"total units 600 | panels 20 " in capped
          or b"| panels 20 (" in capped.split(b"FINAL METRICS")[-1])
    check("at the cap, an Add Panel draw becomes a rework day (the edge line)",
          b"addpanel: the map is at its edge" in capped)

    # -- 6. vocabulary (canon and dialed logs alike) ------------------------
    check("vocabulary law: no 'tile', no 'visit', no 'rung', any case",
          not any(FORBIDDEN.search(l) for l in logs))

    bad = [n for n, ok in checks if not ok]
    print()
    print("PROOFS: " + ("ALL PASS" if not bad else f"{len(bad)} FAILED"))
    raise SystemExit(0 if not bad else 1)


if __name__ == "__main__":
    main()
