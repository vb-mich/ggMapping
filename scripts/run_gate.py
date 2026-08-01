#!/usr/bin/env python3
"""The identity gate (CONTRACTS.md §8): Python oracle vs native C++ vs WASM.

Runs the oracle matrix, byte-compares seed{N}_log.txt across implementations,
enforces the vocabulary law, and prints the identity matrix. Exit 0 only if
every requested comparison is byte-identical and vocabulary-clean.

Usage:
  python scripts/run_gate.py --native path/to/jerrymap [--wasm engine/wasm/dist/jerrymap.mjs]
  python scripts/run_gate.py --native build/jerrymap --skip-python   # native vs committed goldens only
"""
import argparse, os, re, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORACLE = os.path.join(REPO, "reference", "sim_v08.py")

MATRIX = [
    ("base-11",         ["--seed", "11",  "--eras", "20"]),
    ("base-42",         ["--seed", "42",  "--eras", "20"]),
    ("base-303",        ["--seed", "303", "--eras", "20"]),
    ("long-42",         ["--seed", "42",  "--eras", "40"]),
    ("dial-archive",    ["--seed", "42",  "--eras", "20", "--archive-chance", "25"]),
    ("dial-stroke",     ["--seed", "42",  "--eras", "20", "--stroke-die", "6", "--stroke-add", "2"]),
    ("dial-greatridge", ["--seed", "42",  "--eras", "20", "--greatridge-die", "6", "--greatridge-add", "2"]),
    ("dial-extendcap",  ["--seed", "42",  "--eras", "20", "--extend-cap", "0"]),
    ("combined-dials",  ["--seed", "42",  "--eras", "20",
                         "--archive-chance", "25", "--stroke-die", "6", "--stroke-add", "2",
                         "--greatridge-die", "6", "--greatridge-add", "2", "--extend-cap", "0"]),
]

# Experimental cells (CONTRACTS §11) live here while an experiment is live.
# None is: v0.8 promoted the fields dial into canon, so its configuration is
# simply the default and every canon cell above exercises those paths.
EXPERIMENTAL: list[tuple[str, list[str]]] = []

# The total vocabulary law (CONTRACTS §1, v0.5): no exemptions remaining.
FORBIDDEN = re.compile(rb"tile|visit|rung", re.IGNORECASE)


def read_log(outdir, seed, normalize_crlf):
    path = os.path.join(outdir, f"seed{seed}_log.txt")
    with open(path, "rb") as f:
        data = f.read()
    if normalize_crlf:
        data = data.replace(b"\r\n", b"\n")
    return data


def run_cell(cmd, outdir):
    os.makedirs(outdir, exist_ok=True)
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout.decode(errors="replace"))
        sys.stderr.write(r.stderr.decode(errors="replace"))
        raise SystemExit(f"FAILED: {' '.join(cmd)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native", help="path to the native jerrymap CLI")
    ap.add_argument("--wasm", help="path to the wasm module (.mjs), run via node harness")
    ap.add_argument("--skip-python", action="store_true")
    ap.add_argument("--skip-experimental", action="store_true",
                    help="run only the canon matrix")
    ap.add_argument("--workdir", default=None)
    args = ap.parse_args()
    if not (args.native or args.wasm):
        raise SystemExit("nothing to compare: pass --native and/or --wasm")
    if args.native:
        args.native = os.path.abspath(args.native)
    if args.wasm:
        args.wasm = os.path.abspath(args.wasm)

    work = args.workdir or tempfile.mkdtemp(prefix="jerrymap-gate-")
    harness = os.path.join(REPO, "engine", "wasm", "harness.mjs")

    def run_matrix(cells, tag):
        results, ok = [], True
        for name, flags in cells:
            seed = flags[flags.index("--seed") + 1]
            logs = {}
            if not args.skip_python:
                d = os.path.join(work, tag, "py", name)
                run_cell([sys.executable, ORACLE, "--out", d, "--no-render"] + flags, d)
                logs["python"] = read_log(d, seed, normalize_crlf=(os.name == "nt"))
            if args.native:
                d = os.path.join(work, tag, "native", name)
                run_cell([args.native, "--out", d] + flags, d)
                logs["native"] = read_log(d, seed, normalize_crlf=False)
            if args.wasm:
                d = os.path.join(work, tag, "wasm", name)
                run_cell(["node", harness, args.wasm, "--out", d] + flags, d)
                logs["wasm"] = read_log(d, seed, normalize_crlf=False)

            ref = next(iter(logs.values()))
            row = {"cell": name}
            for impl, data in logs.items():
                same = data == ref
                row[impl] = "OK" if same else "MISMATCH"
                ok &= same
                if FORBIDDEN.search(data):
                    row[impl] = "VOCAB-FAIL"
                    ok = False
            row["bytes"] = len(ref)
            results.append(row)
        return results, ok

    def report(results, title):
        cols = (["cell"] + [k for k in ("python", "native", "wasm") if k in results[0]]
                + ["bytes"])
        widths = {c: max(len(c), *(len(str(r.get(c, ""))) for r in results)) for c in cols}
        line = " | ".join(c.ljust(widths[c]) for c in cols)
        print(title)
        print(line); print("-" * len(line))
        for r in results:
            print(" | ".join(str(r.get(c, "")).ljust(widths[c]) for c in cols))
        print()

    canon, ok = run_matrix(MATRIX, "canon")
    report(canon, "CANON MATRIX (the oracle lineage)")
    print("GATE: " + ("GREEN - byte-identical across all cells" if ok
                      else "RED - mismatches above"))

    if EXPERIMENTAL and not args.skip_experimental:
        exp, exp_ok = run_matrix(EXPERIMENTAL, "exp")
        print()
        report(exp, "EXPERIMENTAL CELLS (CONTRACTS S11 - NOT canon)")
        print("EXPERIMENTAL: " + ("GREEN - byte-identical across all cells" if exp_ok
                                  else "RED - mismatches above"))
        ok &= exp_ok

    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
