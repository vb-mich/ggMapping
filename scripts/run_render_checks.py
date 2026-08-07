#!/usr/bin/env python3
"""The render-layer checks: does the PICTURE follow the law?

The identity gate compares logs and the conformance suite reads the book.
Neither one looks at what gets drawn, so a rule that lives only in a renderer
is unreviewed by construction — which is how the patina corner bias survived
every green check for the repo's whole life (FORK_NOTES §v0.7.1).

This suite closes that hole for the one rule renderers own: patina placement
(CONTRACTS §2.4). It compares MARK MAPS, never pixels.

The engine's map comes from `jerrymap --patina`. The twin's map is taken from
the twin's OWN render() — captured live with a trace hook rather than
reimplemented here, because a check that restates the rule proves nothing.
PIL is stubbed out, so no image is produced and no Pillow is needed.

Usage:
  python scripts/run_render_checks.py --native build/jerrymap.exe [--seeds 11,42,303]
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TWIN = os.path.join(REPO, "reference", "sim_v10.py")

checks = []


def check(name, ok, detail=""):
    checks.append((name, ok))
    print(("PASS  " if ok else "FAIL  ") + name)
    if detail and not ok:
        print("        " + detail)


# --------------------------------------------------------------------------
# the twin's map, taken from the twin's own renderer
# --------------------------------------------------------------------------

def _stub_pil():
    """A PIL that draws nothing: render() runs, no image is made."""
    class Anything:
        def __getattr__(self, _):
            return lambda *a, **k: None

    pil = types.ModuleType("PIL")
    image = types.ModuleType("PIL.Image")
    draw = types.ModuleType("PIL.ImageDraw")
    image.new = lambda *a, **k: Anything()
    draw.Draw = lambda *a, **k: Anything()
    pil.Image, pil.ImageDraw = image, draw
    sys.modules.setdefault("PIL", pil)
    sys.modules.setdefault("PIL.Image", image)
    sys.modules.setdefault("PIL.ImageDraw", draw)


def load_twin(path=TWIN):
    spec = importlib.util.spec_from_file_location("jm_twin", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def twin_patina(twin, seed, eras):
    """Run the twin and capture render()'s own placement map."""
    sim = twin.Sim(seed, eras, dict(alive=True, semi=True, fragile=True))
    sim.run()

    captured = {}

    def local(frame, event, arg):
        if event == "return":
            captured["map"] = dict(frame.f_locals.get("combined") or {})
        return local

    def glob(frame, event, arg):
        if event == "call" and frame.f_code.co_name == "render":
            frame.f_trace_lines = False  # call/return only: keep it quick
            return local
        return None

    sys.settrace(glob)
    try:
        twin.render(sim, os.devnull)
    finally:
        sys.settrace(None)
    if "map" not in captured:
        raise SystemExit("could not capture the twin's placement map")
    return {(int(k[0]), int(k[1])): int(v) for k, v in captured["map"].items()}, sim


# --------------------------------------------------------------------------
# the engine's map
# --------------------------------------------------------------------------

def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        sys.stderr.write(r.stdout.decode(errors="replace"))
        sys.stderr.write(r.stderr.decode(errors="replace"))
        raise SystemExit(f"FAILED: {' '.join(str(c) for c in cmd)}")


def read_map(path):
    with open(path, encoding="utf8") as f:
        return {(x, y): n for x, y, n in json.load(f)}


def engine_run(exe, outdir, seed, eras):
    os.makedirs(outdir, exist_ok=True)
    state = os.path.join(outdir, "state.json")
    pat = os.path.join(outdir, "patina.json")
    run([exe, "--seed", str(seed), "--eras", str(eras), "--out", outdir,
         "--save", state, "--patina", pat])
    return read_map(pat), state


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--native", required=True)
    ap.add_argument("--seeds", default="11,42,303")
    ap.add_argument("--twin", default=TWIN,
                    help="the renderer to compare against (used to prove these "
                         "checks have teeth: point them at a pre-fix twin)")
    ap.add_argument("--eras", type=int, default=20)
    ap.add_argument("--workdir", default=None)
    args = ap.parse_args()

    exe = os.path.abspath(args.native)
    work = args.workdir or tempfile.mkdtemp(prefix="jerrymap-render-")
    _stub_pil()
    twin = load_twin(os.path.abspath(args.twin))

    for seed in [int(s) for s in args.seeds.split(",")]:
        tag = f"seed {seed}"
        emap, state_path = engine_run(exe, os.path.join(work, str(seed)), seed, args.eras)
        tmap, sim = twin_patina(twin, seed, args.eras)

        # (1) one rule, one picture: the two implementations agree exactly
        only_engine = {k: v for k, v in emap.items() if tmap.get(k) != v}
        only_twin = {k: v for k, v in tmap.items() if emap.get(k) != v}
        check(f"{tag}: the engine's map equals the twin's, unit for unit",
              not only_engine and not only_twin,
              f"{len(only_engine)} engine-only/differing, {len(only_twin)} twin-only; "
              f"e.g. {list(only_engine.items())[:3] or list(only_twin.items())[:3]}")

        # The picture properties hold for EVERY renderer, not just the engine:
        # checking one map only would let a buggy renderer pass.
        recorded = {}
        for u, n in sim.embellish.items():
            recorded[twin.tile_of(u)] = recorded.get(twin.tile_of(u), 0) + n
        for t, n in sim.embellish_tile.items():
            recorded[t] = recorded.get(t, 0) + n

        for who, m in (("engine", emap), ("twin", tmap)):
            # (2) every mark drawn sits on painted ground
            unpainted = [u for u in m if u not in sim.base]
            check(f"{tag}: every {who} mark sits on painted ground", not unpainted,
                  f"{len(unpainted)} on blank ground, e.g. {unpainted[:3]}")

            # (3) nothing is silently dropped: what a panel recorded, it draws.
            # Only marks on painted ground are drawn at all — a renderer paints
            # patina over a unit's colour — so a mark placed on blank ground
            # disappears from the picture without a trace. Count what is drawn.
            drawn = {}
            for u, n in m.items():
                if u not in sim.base:
                    continue
                drawn[twin.tile_of(u)] = drawn.get(twin.tile_of(u), 0) + n
            mismatch = {t: (drawn.get(t, 0), recorded.get(t, 0))
                        for t in set(drawn) | set(recorded)
                        if drawn.get(t, 0) != recorded.get(t, 0)}
            check(f"{tag}: {who} marks drawn per panel equal marks recorded",
                  not mismatch,
                  f"{len(mismatch)} panel(s) differ (drawn, recorded): "
                  f"{dict(list(mismatch.items())[:3])}")

        # (4) the placement depends only on the state, not on how it was reached
        again = os.path.join(work, str(seed), "again.json")
        run([exe, "--load", state_path, "--out", os.path.join(work, str(seed)),
             "--patina", again])
        check(f"{tag}: placement is deterministic for a given state",
              read_map(again) == emap)

        # a corner-bias regression guard: with the old rule every panel's first
        # flourish sat on its top-left unit, painted or not
        for who, m in (("engine", emap), ("twin", tmap)):
            corners = 0
            for t in sim.embellish_tile:
                ox, oy = twin.tile_origin(t)
                if (ox, oy) not in sim.base and m.get((ox, oy)):
                    corners += 1
            check(f"{tag}: no {who} mark on an unpainted panel corner", corners == 0,
                  f"{corners} panel(s) still marked at a blank corner")

    bad = [n for n, ok in checks if not ok]
    print()
    print(f"RENDER CHECKS: {len(checks) - len(bad)}/{len(checks)} pass"
          + ("" if not bad else f" — {len(bad)} FAILED"))
    raise SystemExit(0 if not bad else 1)


if __name__ == "__main__":
    main()
