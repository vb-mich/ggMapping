#!/usr/bin/env python3
"""JERRYMAPPING, headless simulator (handbook beta 0.1).
Implements players_handbook.md draft 0.2 with SIMULATOR_SPEC.md v1 policies.
Outputs: era snapshot PNGs, final PNG, full txt log, metrics on stdout.
"""
import argparse, os, random, sys
from collections import deque

# ---------------------------------------------------------------- rungs
VD, DP, MD, SH, CO, PL, HI, MO = range(8)
WATER = frozenset({VD, DP, MD, SH})
HEIGHTS = frozenset({HI, MO})
RNAME = ["verydeep", "deep", "medium", "shallow", "coastal", "plain", "hills", "mountains"]
DIRS = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)]  # N NE E SE S SW W NW
DNAME = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
SIDES = [(0, -1), (1, 0), (0, 1), (-1, 0)]  # N E S W for side-neighbor checks

TILE_W, TILE_H = 5, 6
AREA = TILE_W * TILE_H

def set_geometry(w, h):
    global TILE_W, TILE_H, AREA
    TILE_W, TILE_H, AREA = w, h, w * h

# ---------------------------------------------------------------- tile math
def tile_of(g):
    gx, gy = g
    txi, tyi = gx // TILE_W, gy // TILE_H
    tx = txi + 1 if txi >= 0 else txi
    ty = -(tyi + 1) if tyi >= 0 else -tyi
    return (tx, ty)

def tile_origin(t):
    tx, ty = t
    txi = tx - 1 if tx > 0 else tx
    tyi = -ty if ty > 0 else -ty - 1
    return (txi * TILE_W, tyi * TILE_H)

def tile_units(t):
    ox, oy = tile_origin(t)
    return [(ox + c, oy + r) for r in range(TILE_H) for c in range(TILE_W)]

def unit_at(t, row, col):  # 1-based row (from N), col (from W)
    ox, oy = tile_origin(t)
    return (ox + col - 1, oy + row - 1)

def rc_of(g):
    t = tile_of(g)
    ox, oy = tile_origin(t)
    return (g[1] - oy + 1, g[0] - ox + 1)

def tname(t):
    tx, ty = t
    ns = f"N{ty}" if ty > 0 else f"S{-ty}"
    ew = f"E{tx}" if tx > 0 else f"W{-tx}"
    return f"{ns}/{ew}"

def cheb(a, b):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))

# ---------------------------------------------------------------- sim
DEFAULT_DECK = dict(extend=1, basin=3, ridge=1, greatridge=1,
                    settlement=4, calm=7, anomaly=1, freestroke=2)

# the density ladder: open country 0, rural 1, urban low 2, medium 3, high 4
DENS = {"farm_lo": 0, "farm_hi": 0, "rural": 1,
        "urb_lo": 2, "urb_md": 3, "urb_hi": 4}
UP = {"rural": "urb_lo", "urb_lo": "urb_md", "urb_md": "urb_hi"}
DOWN = {"urb_hi": "urb_md", "urb_md": "urb_lo", "urb_lo": "rural"}
class PCG32:
    """The portable RNG: PCG32, stream 54. The exact C++ contract is in FORK_NOTES."""
    M = 6364136223846793005
    def __init__(self, seed):
        self.state = 0
        self.inc = (54 << 1) | 1
        self._next()
        self.state = (self.state + seed) & 0xFFFFFFFFFFFFFFFF
        self._next()
    def _next(self):
        old = self.state
        self.state = (old * self.M + self.inc) & 0xFFFFFFFFFFFFFFFF
        xs = (((old >> 18) ^ old) >> 27) & 0xFFFFFFFF
        rot = old >> 59
        return ((xs >> rot) | (xs << ((-rot) & 31))) & 0xFFFFFFFF
    def bounded(self, n):
        t = (1 << 32) % n
        while True:
            r = self._next()
            if r >= t:
                return r % n
    def chance_permille(self, m):
        return self._next() < (m << 32) // 1000
    def shuffle(self, lst):
        for i in range(len(lst) - 1, 0, -1):
            j = self.bounded(i + 1)
            lst[i], lst[j] = lst[j], lst[i]


DNAMES = {"urb_lo": "urban low", "urb_md": "urban medium", "urb_hi": "urban high"}


WORK = {"calm": 7, "anomaly": 3, "settlement": 4,
        "extend": 5, "basin": 5, "ridge": 5, "greatridge": 5,
        "freestroke": 5, "addpanel": 5}
WORK_LIVING = {"calm": 6, "anomaly": 7, "settlement": 7,
               "extend": 7, "basin": 7, "ridge": 7, "greatridge": 7,
               "freestroke": 7, "addpanel": 4}
MOOD = {"ridge": "rise", "greatridge": "rise", "anomaly": "rise",
        "calm": "level",
        "extend": "settle", "basin": "settle", "settlement": "settle",
        "freestroke": "settle",
        "addpanel": "settle"}
MOOD_FD = {"settle": 3, "level": 6, "rise": 8}

def spread_work(avg, n, on):
    """Per-copy work numbers around a type average: +-1 at the ends,
    exact mean, floor 3, empty spread for singles."""
    if not on or n <= 1 or avg - 1 < 3:
        return [avg] * n
    vals = [avg] * n
    vals[0] -= 1
    vals[-1] += 1
    return vals

class Sim:
    def __init__(self, seed, eras, cfg=None):
        self.cfg = dict(deck=DEFAULT_DECK, wake_era=2, alive=True, fragile=True,
                        tile_w=5, tile_h=6, addpanel=None, semi=True,
                        work_spread=True, work=None, mood=None,
                        archive_chance=0,
                        stroke_die=4, stroke_add=1,
                        greatridge_die=None, greatridge_add=0,
                        extend_cap=4)
        if cfg:
            self.cfg.update(cfg)
        if self.cfg["semi"]:
            self.cfg["alive"] = True
        if self.cfg["addpanel"] is None:
            self.cfg["addpanel"] = 2 if self.cfg["alive"] else 4
        self.rng = PCG32(seed)
        self.seed, self.eras_wanted = seed, eras
        self.base = {}       # gpos -> rung
        self.wild = set()    # anomaly units
        self.people = {}     # gpos -> overlay key
        self.marks = {}      # gpos -> mark key
        self.tiles = {}      # tkey -> filled count
        self.stack = deque()
        self.atlas = set()
        self.binder = set()
        self.loglines = []
        self.era = 1
        self.visit_no = 0
        self.wake_era = self.cfg['wake_era']
        self.woken = False
        # metrics
        self.M = dict(cliffs=0, nudges=0, merges=0, free_tiles=0,
                      fills=0, stroke_units=0, reworks=0, crumbles=0, embellish=0)
        self.first = {}
        self._deck_entry = None
        self._cur_tile = None
        self._step = 0
        self.embellish = {}
        self.embellish_tile = {}
        self.skips = {}
        self.era_rows = []
        self.cov_era3 = None
        self.completed_per_era = {}
        self.added_per_era = {}

    # ------------------------------------------------ logging / dice
    def log(self, s):
        self.loglines.append(s)

    def die(self, n, purpose):
        v = 1 + self.rng.bounded(n)
        self.log(f"    d{n}={v} ({purpose})")
        return v

    def pick(self, seq, purpose):
        seq = sorted(seq)
        v = seq[0] if len(seq) == 1 else seq[self.rng.bounded(len(seq))]
        if len(seq) > 1:
            self.log(f"    choice among {len(seq)} ({purpose})")
        return v

    # ------------------------------------------------ board helpers
    def exists(self, g):
        return tile_of(g) in self.tiles

    def filled(self, g):
        return g in self.base

    def side_nb(self, g):
        return [(g[0] + d[0], g[1] + d[1]) for d in SIDES
                if self.exists((g[0] + d[0], g[1] + d[1]))]

    def legal_interval(self, g):
        lo, hi = 0, 7
        for n in self.side_nb(g):
            if n in self.base and n not in self.wild:
                lo = max(lo, self.base[n] - 1)
                hi = min(hi, self.base[n] + 1)
        return lo, hi

    def cap_class(self, g, wanted, cls):
        lo, hi = self.legal_interval(g)
        clo, chi = max(lo, min(cls)), min(hi, max(cls))
        if clo > chi:
            return None
        return min(max(wanted, clo), chi)

    def trace_unit(self, g, label):
        if (self.base.get(g) == CO and g not in self.wild
                and not any(self.base.get(n) in WATER for n in self.side_nb(g))):
            self.base[g] = PL
            r0, c0 = rc_of(g)
            self.ev(f"the shore forgets its sea at r{r0}c{c0} "
                    f"{tname(tile_of(g))}: coastal -> plain")
            return
        self.M["embellish"] += 1
        self.embellish[g] = self.embellish.get(g, 0) + 1
        r0, c0 = rc_of(g)
        self.ev(f"rework r{r0}c{c0} {tname(tile_of(g))} ({label})")

    def ev(self, msg):
        self._step += 1
        self.log(f"    {self._step}. {msg}")

    def set_mark(self, g, name):
        self.marks[g] = name
        self.wild.add(g)
        r, c = rc_of(g)
        self.ev(f"mark {name} at r{r}c{c} {tname(tile_of(g))}")

    def paint(self, g, rung, why):
        assert g not in self.base
        self.base[g] = rung
        t = tile_of(g)
        self.tiles[t] += 1
        r, c = rc_of(g)
        self.ev(f"paint r{r}c{c} {tname(t)} {RNAME[rung]} ({why})")

    def border_pairs(self, t):
        """(side_dir_index in DIRS, [(inside,outside)...]) for each side with a neighbor tile."""
        ox, oy = tile_origin(t)
        out = []
        specs = [(0, [( (ox+i, oy), (ox+i, oy-1)) for i in range(TILE_W)]),
                 (4, [( (ox+i, oy+TILE_H-1), (ox+i, oy+TILE_H)) for i in range(TILE_W)]),
                 (2, [( (ox+TILE_W-1, oy+j), (ox+TILE_W, oy+j)) for j in range(TILE_H)]),
                 (6, [( (ox, oy+j), (ox-1, oy+j)) for j in range(TILE_H)])]
        for d, pairs in specs:
            if self.exists(pairs[0][1]):
                out.append((d, pairs))
        return out

    SPIRIT = {"extend": "trace your richest border",
              "basin": "ripple the water",
              "ridge": "shade the slopes",
              "greatridge": "shade the slopes",
              "freestroke": "any flourish",
              "settlement": "the town celebrates",
              "anomaly": "mark the strange"}

    def skip(self, card, why, spirit=None):
        self.skips[card] = self.skips.get(card, 0) + 1
        ct = getattr(self, "_cur_tile", None)
        if ct is None or self.tiles.get(ct, 0) == 0:
            self.log(f"    {card}: {why}")
            return
        self.M["embellish"] += 1
        self.embellish_tile[ct] = self.embellish_tile.get(ct, 0) + 1
        self.ev(f"{card}: {why}: embellish, "
                f"{spirit or self.SPIRIT.get(card, 'any flourish')}")

    # ------------------------------------------------ strokes
    def stroke(self, first, first_wanted, heading, total, cls, mode, label):
        """first: gpos to paint first (must be empty; may fail cap). Returns painted count."""
        semi = self.cfg["semi"]
        ghost = False
        r = self.cap_class(first, first_wanted, cls)
        if r is None or (semi and first in self.base):
            if r is None:
                self.log(f"    {label}: first unit not legal, ends")
            if not semi:
                return 0
            ghost = True
            if first in self.base:
                self.trace_unit(first, label)
            painted, prev, pos = 0, first_wanted, first
        else:
            self.paint(first, r, label)
            painted, prev, pos = 1, r, first
        steps = 1
        while steps < total:
            w = (self.pick([1, 2, 3, 4, 5, 6], "wobble (choice)")
                 if getattr(self, "_stroke_choice", False)
                 else self.die(6, "wobble"))
            if w == 5:
                heading = (heading - 1) % 8
            elif w == 6:
                heading = (heading + 1) % 8
            tgt = (pos[0] + DIRS[heading][0], pos[1] + DIRS[heading][1])
            if not self.exists(tgt):
                self.log(f"    {label}: ends at map edge, heading {DNAME[heading]}")
                break
            if ghost:
                if tgt in self.base:
                    self.trace_unit(tgt, label)
                steps += 1
                pos = tgt
                continue
            if tgt in self.base:
                if tgt not in self.wild and self.base[tgt] in cls:
                    self.M["merges"] += 1
                    self.log(f"    {label}: merges into {RNAME[self.base[tgt]]}, ends")
                else:
                    self.log(f"    {label}: blocked by "
                             f"{'anomaly' if tgt in self.wild else RNAME[self.base[tgt]]}, ends")
                if not semi:
                    break
                ghost = True
                self.trace_unit(tgt, label)
                steps += 1
                pos = tgt
                continue
            wanted = prev
            if mode == "dig":
                wanted = max(0, prev - 1)
            elif mode == "climb":
                wanted = min(7, prev + 1)
            r = self.cap_class(tgt, wanted, cls)
            if r is None:
                self.log(f"    {label}: no legal step ahead, ends")
                if not semi:
                    break
                ghost = True
                steps += 1
                pos = tgt
                continue
            self.paint(tgt, r, label)
            painted += 1
            steps += 1
            prev, pos = r, tgt
        self.M["stroke_units"] += painted
        return painted

    def nudge_unit(self, t, g0, pred, what):
        cands = [u for u in tile_units(t) if pred(u)]
        if not cands:
            return None
        best = min(cheb(g0, u) for u in cands)
        near = [u for u in cands if cheb(g0, u) == best]
        u = self.pick(near, f"nudge {what}")
        if u != g0:
            self.M["nudges"] += 1
        return u

    def roll_unit(self, t):
        if (TILE_W, TILE_H) == (5, 6):
            r = self.die(6, "row")
            c = self.die(10, "column")
            c = c if c <= 5 else c - 5
            return unit_at(t, r, c)
        DICE = (4, 6, 8, 10, 12, 20)
        r = (self.die(TILE_H, "row") if TILE_H in DICE
             else self.pick(list(range(1, TILE_H + 1)), "row (choice)"))
        c = (self.die(TILE_W, "column") if TILE_W in DICE
             else self.pick(list(range(1, TILE_W + 1)), "column (choice)"))
        return unit_at(t, r, c)

    # ------------------------------------------------ fill
    def fill_quota(self, t, quota):
        wt = getattr(self, "_work_tile", None)
        if wt is not None:
            t = wt
            self._work_tile = None
            self.log(f"    the current working panel is the new panel {tname(t)}")
        done = 0
        while done < quota:
            if self.tiles[t] >= AREA:
                if self.cfg["alive"]:
                    self.rework_walk(t, quota - done)
                else:
                    n = quota - done
                    self.M["embellish"] += n
                    self.embellish_tile[t] = self.embellish_tile.get(t, 0) + n
                    self.ev(f"the panel is full: embellish {n} units")
                return
            self.fill_one(t)
            done += 1

    def rework_walk(self, t, steps):
        land = self.roll_unit(t)
        order = sorted(tile_units(t), key=lambda u: (u[1], u[0]))
        i = order.index(land)
        for k in range(steps):
            self.rework_body(order[(i + k) % len(order)])

    def rework_body(self, g):
        self.M["reworks"] += 1
        if g in self.wild or g in self.marks:
            self.M["embellish"] += 1
            self.embellish[g] = self.embellish.get(g, 0) + 1
            self.ev("the land holds: embellish")
            return
        if g in self.people and not self.cfg["fragile"]:
            self.M["embellish"] += 1
            self.embellish[g] = self.embellish.get(g, 0) + 1
            self.ev("the town holds: embellish")
            return
        cur = self.base[g]
        fd = MOOD_FD[self._mood]
        nbs = [self.base[n] for n in self.side_nb(g)
               if n in self.base and n not in self.wild]
        if not nbs:
            return
        if fd <= 5:
            tally = {}
            for r in nbs:
                tally[r] = tally.get(r, 0) + 1
            top = max(tally.values())
            dom = self.pick([r for r, c in tally.items() if c == top],
                            "rework dominant")
            want = cur + (1 if dom > cur else (-1 if dom < cur else 0))
        elif fd <= 7:
            want = cur + (1 if cur < PL else (-1 if cur > PL else 0))
        else:
            if cur == PL:
                want = self.pick([CO, HI], "away direction")
            else:
                want = max(0, cur - 1) if cur < PL else min(7, cur + 1)
        lo, hi = self.legal_interval(g)
        if lo > hi or want == cur:
            self.M["embellish"] += 1
            self.embellish[g] = self.embellish.get(g, 0) + 1
            self.ev("settled: embellish")
            return
        if self.cfg["semi"]:
            self.trace_unit(g, "walk")
            return
        new = min(max(want, lo), hi)
        if (new == CO or cur == CO) and not any(
                self.base.get(n) in WATER for n in self.side_nb(g)):
            new = PL
        if new == cur:
            self.M["embellish"] += 1
            self.embellish[g] = self.embellish.get(g, 0) + 1
            self.ev("settled: embellish")
            return
        if new in (PL, CO) and cur not in (PL, CO):
            for n in self.side_nb(g):
                if self.dens(n) >= 2:
                    self.M["embellish"] += 1
                    self.embellish[g] = self.embellish.get(g, 0) + 1
                    self.ev("the city holds the shore: embellish")
                    return
        r, c = rc_of(g)
        self.base[g] = new
        self.ev(f"rework r{r}c{c}: {RNAME[cur]} -> {RNAME[new]}")
        if g in self.people:
            kind = self.people[g]
            allowed = {PL} if kind.startswith("farm") else {PL, CO}
            if new not in allowed:
                del self.people[g]
                self.ev(f"the ground gives way, the homes are lost at r{r}c{c} {tname(tile_of(g))}")
                self.cascade()

    def fill_one(self, t):
        self.M["fills"] += 1
        empties = [u for u in tile_units(t) if u not in self.base]
        counts = {u: sum(1 for n in self.side_nb(u) if n in self.base) for u in empties}
        mx = max(counts.values())
        if mx == 0:
            g = self.roll_unit(t)  # guaranteed empty (tile has no filled units)
        else:
            g = self.pick([u for u in empties if counts[u] == mx], "fill spot")
        fd = MOOD_FD[self._mood]
        nbs = [self.base[n] for n in self.side_nb(g)
               if n in self.base and n not in self.wild]
        if not nbs:
            fr = self.die(6, "first elevation")
            rung = {1: SH, 2: CO, 3: PL, 4: PL, 5: HI, 6: MO}[fr]
        else:
            tally = {}
            for r in nbs:
                tally[r] = tally.get(r, 0) + 1
            top = max(tally.values())
            dom = self.pick([r for r, c in tally.items() if c == top], "dominant tie")
            rung = dom
            if fd in (6, 7):
                rung = dom + (1 if dom < PL else (-1 if dom > PL else 0))
            elif fd == 8:
                if dom == PL:
                    rung = self.pick([CO, HI], "away direction")
                elif dom < PL:
                    rung = max(0, dom - 1)
                else:
                    rung = min(7, dom + 1)
        lo, hi = self.legal_interval(g)
        if lo > hi:
            rung = min(n for n in nbs) + 1
            self.M["cliffs"] += 1
            self.log("    CLIFF")
        else:
            rung = min(max(rung, lo), hi)
        self.paint(g, rung, "fill")

    # ------------------------------------------------ cards
    def card_calm(self, t):
        self.log("    calm: nothing")
        return None

    def card_ridge(self, t, great=False):
        cands = [u for u in tile_units(t) if u not in self.base
                 and self.cap_class(u, HI, HEIGHTS) is not None]
        if not cands and self.cfg["semi"]:
            cands = sorted(tile_units(t))
        if not cands:
            self.skip("greatridge" if great else "ridge", "no legal seed")
            return None
        g = self.pick(cands, "ridge seed (choice)")
        h = self.pick(list(range(8)), "heading (choice)")
        if great and self.cfg["greatridge_die"]:
            L = (self.die(self.cfg["greatridge_die"], "length")
                 + self.cfg["greatridge_add"])
        else:
            L = self.pick(list(range(4, 11)) if great else list(range(2, 6)),
                          "length (choice)")
        self._stroke_choice = True
        self.stroke(g, HI, h, L, HEIGHTS, "climb", "ridge")
        self._stroke_choice = False
        return None

    def card_basin(self, t):
        on_tile = [u for u in tile_units(t)
                   if u in self.base and self.base[u] in WATER and u not in self.wild]
        across = []
        for d, pairs in self.border_pairs(t):
            for inside, outside in pairs:
                if (outside in self.base and self.base[outside] in WATER
                        and outside not in self.wild and inside not in self.base
                        and self.cap_class(inside, self.base[outside], WATER) is not None):
                    across.append((outside, inside))
        if on_tile or across:
            cands = [(u, None) for u in on_tile] + across
            start, facing = self.pick(cands, "basin start")
            L = self.die(self.cfg["stroke_die"], "len") + self.cfg["stroke_add"]
            ref = self.base[start]
            if facing is None:
                h = self.die(8, "heading") - 1
                tgt = (start[0] + DIRS[h][0], start[1] + DIRS[h][1])
                if not self.exists(tgt) or (tgt in self.base
                                             and not self.cfg["semi"]):
                    self.skip("basin", "grow blocked immediately")
                    return None
                self.stroke(tgt, max(0, ref - 1), h, L, WATER, "dig", "basin grow")
            else:
                dx, dy = facing[0] - start[0], facing[1] - start[1]
                h = DIRS.index((dx, dy))
                self.stroke(facing, max(0, ref - 1), h, L, WATER, "dig", "basin grow")
            return None
        g0 = self.roll_unit(t)
        g = self.nudge_unit(t, g0, lambda u: u not in self.base and
                            self.cap_class(u, SH, WATER) is not None, "basin seed")
        if g is None and self.cfg["semi"]:
            g = g0
        if g is None:
            self.skip("basin", "no legal seed")
            return None
        h = self.die(8, "heading") - 1
        L = self.die(self.cfg["stroke_die"], "len") + self.cfg["stroke_add"]
        self.stroke(g, SH, h, L, WATER, "dig", "basin seed")
        return None

    def card_extend(self, t):
        runs = []
        for d, pairs in self.border_pairs(t):
            i = 0
            while i < len(pairs):
                out = pairs[i][1]
                cls = None
                if out in self.base and out not in self.wild:
                    if self.base[out] in WATER:
                        cls = WATER
                    elif self.base[out] in HEIGHTS:
                        cls = HEIGHTS
                if cls is None:
                    i += 1
                    continue
                j = i
                while (j + 1 < len(pairs) and pairs[j + 1][1] in self.base
                       and pairs[j + 1][1] not in self.wild
                       and self.base[pairs[j + 1][1]] in cls):
                    j += 1
                seg = pairs[i:j + 1]
                open_facing = [(k, seg_k) for k, seg_k in enumerate(seg)
                               if seg_k[0] not in self.base
                               and self.cap_class(seg_k[0], self.base[seg_k[1]], cls) is not None]
                if not open_facing and self.cfg["semi"]:
                    mid = (len(seg) - 1) / 2
                    open_facing = [min(enumerate(seg),
                                       key=lambda kv: abs(kv[0] - mid))]
                if open_facing:
                    runs.append((j - i + 1, d, cls, seg, open_facing))
                i = j + 1
        if not runs:
            self.skip("extend", "no open runs")
            return None
        cap = self.cfg["extend_cap"] or 10**9
        def counted(r):  # runs of cap or more count the same (rule 9.1)
            return min(r[0], cap)
        best = max(counted(r) for r in runs)
        idxs = [i for i, r in enumerate(runs) if counted(r) == best]
        length, d, cls, seg, open_facing = runs[self.pick(idxs, "extend run")]
        mid = (len(seg) - 1) / 2
        bestd = min(abs(k - mid) for k, _ in open_facing)
        k, (inside, outside) = self.pick(
            [(k, p) for k, p in open_facing if abs(k - mid) == bestd], "extend entry")
        heading = (d + 4) % 8  # inward
        L = self.die(self.cfg["stroke_die"], "len") + self.cfg["stroke_add"]
        self.log(f"    extend: run len {length} ({'water' if cls is WATER else 'heights'}) "
                 f"on {DNAME[d]} border")
        self.stroke(inside, self.base[outside], heading, L, cls, "carry", "extend")
        return None

    def card_free(self, t):
        cls = WATER if self.pick([0, 1], "free class (choice)") == 0 else HEIGHTS
        seedr = SH if cls is WATER else HI
        cands = sorted(u for u in tile_units(t) if u not in self.base
                       and self.cap_class(u, seedr, cls) is not None)
        if not cands and self.cfg["semi"]:
            cands = sorted(tile_units(t))
        if not cands:
            self.skip("freestroke", "no legal seed")
            return None
        g = self.pick(cands, "free seed (choice)")
        h = self.pick(list(range(8)), "heading (choice)")
        L = self.die(self.cfg["stroke_die"], "len") + self.cfg["stroke_add"]
        self.stroke(g, seedr, h, L, cls,
                    "dig" if cls is WATER else "climb", "free stroke")
        return None

    # ------------------------------------------------ settlement
    def dens(self, u):
        return DENS.get(self.people.get(u), 0)

    def constrains(self, u):
        # fields are not people: a farmed unit never restricts a density step
        return (u in self.base and self.base[u] in (PL, CO)
                and u not in self.wild
                and not str(self.people.get(u, "")).startswith("farm"))

    def dens_legal(self, u, d):
        for n in self.side_nb(u):
            if self.constrains(n) and abs(d - self.dens(n)) > 1:
                return False
        return True

    def neighbors_of_height(self, u, need):
        n = 0
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                v = (u[0] + dx, u[1] + dy)
                if (dx or dy) and v in self.people and not str(
                        self.people[v]).startswith("farm"):
                    n += 1
        return n >= need

    def note_first(self, kind):
        name = DNAMES.get(kind)
        if name and name not in self.first:
            self.first[name] = self.era

    def cascade(self):
        while True:
            viol = sorted(u for u in self.people
                          if self.people[u] in DOWN
                          and any(self.constrains(n)
                                  and self.dens(n) < self.dens(u) - 1
                                  for n in self.side_nb(u)))
            if not viol:
                return
            u = viol[0]
            self.people[u] = DOWN[self.people[u]]
            self.M["crumbles"] += 1
            r, c = rc_of(u)
            self.ev(f"the city crumbles at r{r}c{c} {tname(tile_of(u))}")

    def settlement_components(self, t):
        zone = set(tile_units(t))
        tx, ty = t
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = tx + dx, ty + dy
            if nx == 0: nx = 1 if dx > 0 else -1
            if ny == 0: ny = 1 if dy > 0 else -1
            if (nx, ny) in self.tiles:
                zone.update(tile_units((nx, ny)))
        seeds = [u for u in self.people
                 if self.people[u].startswith(("rural", "urb")) and u in zone]
        comps, seen = [], set()
        for s in seeds:
            if s in seen:
                continue
            comp, q = set(), [s]
            while q:
                u = q.pop()
                if u in comp:
                    continue
                comp.add(u)
                seen.add(u)
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        v = (u[0] + dx, u[1] + dy)
                        if v in self.people and v not in comp:
                            q.append(v)
            comps.append(sorted(comp))
        return comps

    def place_people(self, cand_units, kind, bases):
        """Try to put overlay kind on one legal unit among cand_units."""
        d = DENS[kind]
        ok = []
        for u in cand_units:
            if u in self.people or u in self.wild:
                continue
            if not (kind.startswith("farm") or self.dens_legal(u, d)):
                continue
            if u in self.base:
                if self.base[u] in bases:
                    ok.append((u, None))
            elif self.exists(u):
                lo, hi = self.legal_interval(u)
                legal = [b for b in bases if lo <= b <= hi]
                if legal:
                    ok.append((u, tuple(legal)))
        if not ok:
            return False
        u, legal = self.pick(ok, f"place {kind}")
        if legal is not None:
            b = legal[0] if len(legal) == 1 else self.pick(list(legal), "people base")
            self.paint(u, b, "people base")
        self.people[u] = kind
        self.note_first(kind)
        r, c = rc_of(u)
        self.ev(f"people {kind} at r{r}c{c} {tname(tile_of(u))}")
        return True

    def rural_spot(self, comp):
        cands = self.touching(comp)
        if comp:
            top = max(self.dens(u) for u in comp)
            if top >= 1:
                anchors = [u for u in comp if self.dens(u) == top]
                near = [c for c in cands
                        if any(cheb(c, a) <= 1 for a in anchors)
                        and c not in self.people and c not in self.wild
                        and self.dens_legal(c, 1)]
                if near:
                    return self.place_people(near, "rural", {PL, CO})
        return self.place_people(cands, "rural", {PL, CO})

    def try_upgrade(self, comp):
        risers = [u for u in comp if self.people.get(u) in UP
                  and self.dens_legal(u, self.dens(u) + 1)
                  and (self.dens(u) + 1 < 3
                       or self.neighbors_of_height(u, self.dens(u)))]
        if risers:
            top = max(self.dens(u) for u in risers)
            u = self.pick([u for u in risers if self.dens(u) == top], "riser")
            self.people[u] = UP[self.people[u]]
            self.note_first(self.people[u])
            self.log(f"    upgrade to {self.people[u]}")
            return True
        if self.rural_spot(comp):
            self.log("    cannot climb, sprawls")
            return True
        return False

    def grow_once(self, comp):
        g = self.die(6, "grow")
        if g <= 2:
            lows = sorted(u for u in comp if self.people.get(u) == "farm_lo")
            if lows:
                u = lows[0] if len(lows) == 1 else self.pick(lows, "deepen field")
                self.people[u] = "farm_hi"
                r0, c0 = rc_of(u)
                self.ev(f"the field deepens at r{r0}c{c0} {tname(tile_of(u))}")
            elif not self.place_people(self.touching(comp), "farm_lo", {PL}):
                self.skip("settlement", "no room for farmland")
        elif g <= 4:
            if not self.rural_spot(comp):
                self.skip("settlement", "no room for rural")
        else:
            if not self.try_upgrade(comp):
                self.skip("settlement", "nothing can grow")

    def city_lives(self, t):
        comps = self.settlement_components(t)
        if not comps:
            return
        key = lambda c: (max(self.dens(u) for u in c), len(c))
        best = max(key(c) for c in comps)
        tied = [i for i, c in enumerate(comps) if key(c) == best]
        comp = comps[tied[0] if len(tied) == 1 else self.pick(tied, "living city")]
        self.log("    the city lives: climb or sprawl")
        self.try_upgrade(list(comp))

    def touching(self, comp):
        s = set()
        for u in comp:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    v = (u[0] + dx, u[1] + dy)
                    if v not in comp and self.exists(v):
                        s.add(v)
        return sorted(s)

    def card_settlement(self, t):
        comps = self.settlement_components(t)
        if comps:
            key = lambda c: (max(self.dens(u) for u in c), len(c))
            best = max(key(c) for c in comps)
            tied = [i for i, c in enumerate(comps) if key(c) == best]
            comp = comps[tied[0] if len(tied) == 1 else self.pick(tied, "lead city")]
            for _ in range(2):
                comp = [u for u in self.people
                        if any(cheb(u, v) <= 1 for v in comp)] or comp
                self.grow_once(comp)
            return None
        g0 = self.roll_unit(t)
        home = self.nudge_unit(
            t, g0, lambda u: u in self.base and self.base[u] in (PL, CO)
            and u not in self.people and u not in self.wild, "home")
        if home is None:
            if g0 in self.base:
                self.trace_unit(g0, "settlement")
            else:
                self.skip("settlement", "no legal home", spirit="leave a waymark")
            return None
        f = self.die(6, "foundation")
        def put(u, kind, why):
            self.people[u] = kind
            r0, c0 = rc_of(u)
            self.ev(f"people {kind} at r{r0}c{c0} {tname(tile_of(u))} ({why})")
        if f <= 3:
            self.log("    found hamlet")
            put(home, "rural", "found hamlet")
        elif f <= 5:
            self.log("    found village")
            put(home, "rural", "found village")
            self.place_people(self.touching([home]), "rural", {PL, CO})
        else:
            self.log("    found town")
            for n in self.side_nb(home):
                if self.constrains(n) and n not in self.people:
                    put(n, "rural", "town ring")
            if self.dens_legal(home, 2):
                put(home, "urb_lo", "town core")
                self.note_first("urb_lo")
            else:
                put(home, "rural", "town core, capped")
        comp = [u for u in self.people if cheb(u, home) <= 2]
        kind = "farm_lo" if self.die(4, "farm intensity") <= 2 else "farm_hi"
        self.place_people(self.touching(comp), kind, {PL})
        return None

    # ------------------------------------------------ anomaly
    def card_anomaly(self, t):
        a = self.die(12, "anomaly")
        g0 = self.roll_unit(t)
        frag = self.cfg["fragile"]
        def water_u(u): return (u in self.base and self.base[u] in WATER
                                and u not in self.wild
                                and (u not in self.people or frag))
        def dry_u(u): return (u in self.base and self.base[u] >= CO
                              and u not in self.wild
                              and (u not in self.people or frag))
        def strike(u):
            if frag and u in self.people:
                del self.people[u]
                self.ev("the anomaly strikes the homes")
                self._hit = True
        self._hit = False
        def beside(u, pred):
            return any(pred(n) for n in self.side_nb(u))
        name, done = "?", False
        if a == 1:
            name = "lone island"
            g = self.nudge_unit(t, g0, water_u, name)
            if g: strike(g); self.base[g] = HI; self.wild.add(g); done = True
        elif a == 2:
            name = "sunken land"
            g = self.nudge_unit(t, g0, lambda u: (dry_u(u) or (u not in self.base))
                                and beside(u, lambda n: n in self.base and self.base[n] in WATER), name)
            if g:
                strike(g)
                if g not in self.base: self.paint(g, CO, name)
                else: self.base[g] = CO
                self.set_mark(g, "sunken"); done = True
        elif a == 3:
            name = "crater lake"
            g = self.nudge_unit(t, g0, lambda u: u in self.base and self.base[u] == MO
                                and u not in self.wild, name)
            if g: self.base[g] = SH; self.wild.add(g); done = True
        elif a == 4:
            name = "archipelago"
            n = self.die(4, "islets")
            prev = g0
            for _ in range(n):
                g = self.nudge_unit(t, prev, lambda u: water_u(u) and cheb(u, prev) <= 2, name)
                if g is None: break
                strike(g)
                self.base[g] = CO; self.wild.add(g); prev = g; done = True
        elif a == 5:
            name = "marsh"
            g = self.nudge_unit(t, g0, lambda u: (u in self.base and self.base[u] == CO
                                and u not in self.wild
                                and (u not in self.people or frag)) or (u not in self.base
                                and beside(u, lambda n: n in self.base and self.base[n] in WATER)), name)
            if g:
                strike(g)
                if g not in self.base: self.paint(g, CO, name)
                self.set_mark(g, "marsh"); done = True
        elif a == 6:
            name = "trench"
            g = self.nudge_unit(t, g0, water_u, name)
            if g: strike(g); self.base[g] = VD; self.wild.add(g); done = True
        elif a == 7:
            name = "mesa"
            g = self.nudge_unit(t, g0, lambda u: (u in self.base and self.base[u] == PL
                                and u not in self.wild and u not in self.people)
                                or (u not in self.base and beside(u, lambda n: n in self.base and self.base[n] == PL)), name)
            if g:
                strike(g)
                if g not in self.base: self.paint(g, MO, name)
                else: self.base[g] = MO
                self.wild.add(g); done = True
        elif a == 8:
            name = "oasis"
            def far(u):
                return not any((u[0]+dx, u[1]+dy) in self.base and self.base[(u[0]+dx, u[1]+dy)] in WATER
                               for dx in range(-3, 4) for dy in range(-3, 4))
            g = self.nudge_unit(t, g0, lambda u: dry_u(u) and far(u), name)
            if g:
                strike(g)
                self.base[g] = SH; self.wild.add(g)
                self.place_people(self.touching([g]), "farm_lo", {PL})
                done = True
        elif a == 9:
            name = "volcano"
            g = self.nudge_unit(t, g0, lambda u: (u not in self.base) or
                                (u in self.base and self.base[u] in HEIGHTS and u not in self.wild), name)
            if g:
                if g not in self.base: self.paint(g, MO, name)
                else: self.base[g] = MO
                self.set_mark(g, "volcano"); done = True
                for nb in [(g[0]+dx, g[1]+dy) for dx in (-1, 0, 1)
                           for dy in (-1, 0, 1) if (dx, dy) != (0, 0)]:
                    if nb in self.base and nb not in self.wild:
                        strike(nb)
                        self.base[nb] = HI
                self.ev("the volcano raises its ring: the land around becomes hills")
        elif a == 10:
            name = "canyon"
            g = self.nudge_unit(t, g0, dry_u, name)
            if g: strike(g); self.set_mark(g, "canyon"); done = True
        elif a == 11:
            name = "old ruins"
            def farp(u):
                return not any((u[0]+dx, u[1]+dy) in self.people
                               for dx in range(-3, 4) for dy in range(-3, 4))
            g = self.nudge_unit(t, g0, lambda u: dry_u(u) and farp(u), name)
            if g: strike(g); self.set_mark(g, "ruins"); done = True
        else:
            name = "wonder"
            g = self.nudge_unit(t, g0, dry_u, name)
            if g: strike(g); self.set_mark(g, "star"); done = True
        if done:
            self.log(f"    anomaly: {name}")
        if self._hit:
            self.cascade()
        if not done:
            self.skip("anomaly", f"{name} does not fit")
        return None

    # ------------------------------------------------ add a tile
    def card_addpanel(self, t):
        cands = set()
        for tk in self.tiles:
            tx, ty = tk
            for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                nx, ny = tx + dx, ty + dy
                if nx == 0: nx = 1 if dx > 0 else -1
                if ny == 0: ny = 1 if dy > 0 else -1
                if (nx, ny) not in self.tiles and self.tile_touches((nx, ny)):
                    cands.add((nx, ny))
        cands = sorted(cands)
        if not cands:
            self.skip("addpanel", "no open positions")
            return None
        key = lambda c: c[0] * c[0] + c[1] * c[1]  # distance score, circular growth
        s = min(key(c) for c in cands)
        cands = [c for c in cands if key(c) == s]
        loose = [c for c in cands if self.loose_end(c)]
        if loose:
            cands = loose
        new = self.pick(cands, "panel position")
        self.tiles[new] = 0
        self.stack.append(new)
        self._work_tile = new
        self.added_per_era[self.era] = self.added_per_era.get(self.era, 0) + 1
        self.ev(f"new panel {tname(new)} (score {new[0]*new[0]+new[1]*new[1]})")
        return None

    def tile_touches(self, tk):
        tx, ty = tk
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            nx, ny = tx + dx, ty + dy
            if nx == 0: nx = 1 if dx > 0 else -1
            if ny == 0: ny = 1 if dy > 0 else -1
            if (nx, ny) in self.tiles:
                return True
        return False

    def loose_end(self, tk):
        for u in tile_units(tk):
            for n in self.side_nb(u):
                if tile_of(n) in self.tiles and n in self.base and \
                        self.base[n] in WATER | HEIGHTS:
                    return True
        return False

    # ------------------------------------------------ turn loop
    CARDS = None

    def work_table(self):
        wa = dict(WORK_LIVING if self.cfg["alive"] else WORK)
        wa.update(self.cfg.get("work") or {})
        return wa

    def build_deck(self):
        wa = self.work_table()
        on = self.cfg["work_spread"]
        cards = []
        for k, n in self.cfg["deck"].items():
            cards += [dict(k=k, w=w, base=True, i=())
                      for w in spread_work(wa[k], n, on)]
        self.rng.shuffle(cards)
        return deque(cards)

    def chance(self, p, purpose):
        hit = self.rng.chance_permille(int(round(p * 1000)))
        self.log(f"    chance {purpose}: {'yes' if hit else 'no'}")
        return hit



    def run(self):
        set_geometry(self.cfg["tile_w"], self.cfg["tile_h"])
        # genesis
        if (TILE_W, TILE_H) == (5, 6):
            layout = [(-1, 2), (1, 2),
                      (-2, 1), (-1, 1), (1, 1), (2, 1),
                      (-2, -1), (-1, -1), (1, -1), (2, -1),
                      (-1, -2), (1, -2)]
        else:
            layout = [(-1, 1), (1, 1), (-1, -1), (1, -1)]
        self._genesis = list(layout)
        for tk in layout:
            self.tiles[tk] = 0
            self.stack.append(tk)
        self.log(f"=== JERRYMAPPING, simulator run ===")
        self.log(f"seed: {self.seed}  eras: {self.eras_wanted}")
        deck = self.build_deck()
        self._marker = None
        self._card_no = 0
        era_visits = 0
        dispatch = dict(extend=self.card_extend, basin=self.card_basin,
                        ridge=lambda t: self.card_ridge(t, False),
                        greatridge=lambda t: self.card_ridge(t, True),
                        settlement=self.card_settlement,
                        calm=self.card_calm, anomaly=self.card_anomaly,
                        freestroke=self.card_free, addpanel=self.card_addpanel)
        self.log(f"--- era 1 ---")
        while self.era <= self.eras_wanted:
            c = deck.popleft()
            card, cwork = c["k"], c["w"]
            if not self.stack:
                self.M["free_tiles"] += 1
                self.log(f"[e{self.era}] stack empty: a panel is added for free")
                self.card_addpanel(None)
            if card == "addpanel":
                self.visit_no += 1
                era_visits += 1
                self.log(f"[e{self.era} a{era_visits:02d}] the new panel | ADDPANEL")
                self._step = 0
                self._mood = (self.cfg.get("mood") or {}).get(card, MOOD[card])
                quota = self.card_addpanel(None)
                t = self._work_tile
                self._cur_tile = t
                if quota is None:
                    quota = cwork
                    self.log(f"    work {quota}, mood {self._mood}")
                if t is not None:
                    self.fill_quota(t, quota)
            else:
                t = self.stack.popleft()
                self.visit_no += 1
                era_visits += 1
                self.log(f"[e{self.era} a{era_visits:02d}] panel {tname(t)} | {card.upper()}")
                self._cur_tile = t
                self._step = 0
                self._mood = (self.cfg.get("mood") or {}).get(card, MOOD[card])
                quota = dispatch[card](t)
                if quota is None:
                    quota = cwork
                    self.log(f"    work {quota}, mood {self._mood}")
                self.fill_quota(t, quota)
                if self.cfg["alive"] and self.tiles[t] >= AREA:
                    self.city_lives(t)
                if self.tiles[t] >= AREA:
                    if t not in self.atlas:
                        self.atlas.add(t)
                        if (self.cfg["archive_chance"]
                                and self.chance(self.cfg["archive_chance"] / 100,
                                                "archive")):
                            self.binder.add(t)
                            self.log(f"    panel {tname(t)} COMPLETE, to the Atlas")
                        self.completed_per_era[self.era] = \
                            self.completed_per_era.get(self.era, 0) + 1
                    if t not in self.binder:
                        self.stack.append(t)
                        self.log(f"    panel {tname(t)} full, stays in play")
                else:
                    self.stack.append(t)
                    self.log(f"    panel to back of stack ({self.tiles[t]}/{AREA})")
            deck.append(c)
            do_shuffle = False
            if self._marker is None:
                self._marker = c
            elif c is self._marker:
                do_shuffle = True
                self.log("    the deck completed its cycle")
                self._marker = None
            if do_shuffle:
                tmp = list(deck)
                self.rng.shuffle(tmp)
                deck = deque(tmp)
                self._marker = None
                self.ev("the deck is shuffled")
            if era_visits == 25:
                self.era_summary(era_visits)
                era_visits = 0
                if self.era == 3:
                    self.cov_era3 = sum(self.tiles[k] for k in self._genesis) / (AREA * 1.0 * len(self._genesis))
                self.era += 1
                if self.era > self.eras_wanted:
                    break
                wa = self.work_table()
                if self.era >= self.wake_era and not self.woken:
                    for w in spread_work(wa["addpanel"], self.cfg["addpanel"],
                                         self.cfg["work_spread"]):
                        deck.append(dict(k="addpanel", w=w, base=True, i=()))
                    self.woken = True
                    self.log(f"    the Add Panel card joins the back of the deck")
                self.log(f"--- era {self.era} ---")
        self.deck_size = len(deck)
        self.composed_n = sum(1 for x in deck if not x["base"])
        return self

    # ------------------------------------------------ reporting
    def rung_shares(self):
        n = len(self.base)
        cnt = [0] * 8
        for r in self.base.values():
            cnt[r] += 1
        return n, [c / n * 100 for c in cnt] if n else [0] * 8

    def era_summary(self, visits):
        n, sh = self.rung_shares()
        w = sum(sh[:4]); h = sum(sh[6:])
        row = (f"era {self.era}: ages {visits} | painted {n} | "
               f"water {w:.0f}% coastal {sh[4]:.0f}% plain {sh[5]:.0f}% "
               f"hills {sh[6]:.0f}% mtn {sh[7]:.0f}% | "
               f"done {len(self.atlas)}/{len(self.tiles)} panels | "
               + (f"archived {len(self.binder)} | " if self.cfg["archive_chance"] else "") +
               f"cliffs {self.M['cliffs']} merges {self.M['merges']}")
        self.era_rows.append(row)
        self.log("=== " + row)

    def gradient(self):
        tot = n = steep = 0
        for g, r in self.base.items():
            if g in self.wild:
                continue
            for d in ((1, 0), (0, 1)):
                v = (g[0] + d[0], g[1] + d[1])
                if v in self.base and v not in self.wild:
                    dr = abs(r - self.base[v])
                    tot += dr; n += 1
                    if dr >= 2:
                        steep += 1
        return (tot / n if n else 0, 100 * steep / n if n else 0)

    def biggest(self, cls):
        seen, best = set(), 0
        for g, r in self.base.items():
            if r in cls and g not in seen:
                comp, q = 0, [g]
                while q:
                    u = q.pop()
                    if u in seen or self.base.get(u) not in cls:
                        continue
                    seen.add(u); comp += 1
                    for d in SIDES:
                        q.append((u[0] + d[0], u[1] + d[1]))
                best = max(best, comp)
        return best

    def final_report(self):
        n, sh = self.rung_shares()
        lines = ["", "===== FINAL METRICS ====="]
        lines += self.era_rows
        w = sum(sh[:4])
        lines.append(f"total units {n} | panels {len(self.tiles)} "
                     f"(atlas {len(self.atlas)})")
        lines.append("elevation shares: " + " ".join(
            f"{RNAME[i]} {sh[i]:.1f}%" for i in range(8)))
        lines.append(f"aggregates: water {w:.1f}% | "
                     f"plain {sh[5]:.1f}% (30-35) | hills {sh[6]:.1f}% (10-15) | "
                     f"mountains {sh[7]:.1f}% (5-8)")
        if self.cov_era3 is not None:
            lines.append(f"genesis coverage at end of era 3: {self.cov_era3*100:.0f}% "
                         f"(claim: most of 360 units)")
        lines.append(f"skips: " + (", ".join(f"{k} {v}" for k, v in
                     sorted(self.skips.items())) or "none"))
        lines.append(f"cliffs {self.M['cliffs']} | nudges {self.M['nudges']} | "
                     f"merges {self.M['merges']} | free panels {self.M['free_tiles']}")
        ppl = {}
        for v in self.people.values():
            ppl[v] = ppl.get(v, 0) + 1
        lines.append("people: " + (", ".join(f"{k} {v}" for k, v in sorted(ppl.items()))
                                   or "none"))
        lines.append(f"deck: {self.deck_size} cards, {self.composed_n} composed")
        lines.append(f"embellishment: {self.M['embellish']} steps "
                     f"across {len(self.embellish)} units")
        lines.append("city firsts: " + (", ".join(f"{k} era {v}"
                     for k, v in sorted(self.first.items())) or "no urban")
                     + f" | reworks {self.M['reworks']} | crumbles {self.M['crumbles']}")
        rs = {}

        return "\n".join(lines)

# ---------------------------------------------------------------- render
PALETTE = {VD: "#14364F", DP: "#205E82", MD: "#4193BC", SH: "#A7D5E4",
           CO: "#E8D18F", PL: "#8FBE6E", HI: "#B3A15E", MO: "#77573F"}
PEOPLE_COL = {"farm_lo": "#C9DFA0", "farm_hi": "#5E8F45", "rural": "#C7A472",
              "urb_lo": "#D3D3D3", "urb_md": "#A6A6A6", "urb_hi": "#6B6B6B"}

def render(sim, path, upx=16, patina=True):
    from PIL import Image, ImageDraw
    xs = [g[0] for t in sim.tiles for g in tile_units(t)]
    ys = [g[1] for t in sim.tiles for g in tile_units(t)]
    x0, y0 = min(xs), min(ys)
    W = (max(xs) - x0 + 1) * upx + 20
    H = (max(ys) - y0 + 1) * upx + 20
    img = Image.new("RGB", (W, H), "#F3EFE7")
    d = ImageDraw.Draw(img)
    def px(g):
        return (10 + (g[0] - x0) * upx, 10 + (g[1] - y0) * upx)
    combined = dict(getattr(sim, "embellish", {}))
    for tk, n in getattr(sim, "embellish_tile", {}).items():
        # a panel level flourish has no unit: the player chooses one. Place it on
        # painted ground, richest first, so the mark shows where the map is worked.
        us = [u for u in sorted(tile_units(tk)) if u in sim.base]
        if not us:
            continue
        us.sort(key=lambda u: (-combined.get(u, 0), u))
        for i in range(n):
            g = us[i % len(us)]
            combined[g] = combined.get(g, 0) + 1
    for t in sim.tiles:
        for g in tile_units(t):
            x, y = px(g)
            oln = "#00000022" if upx >= 8 else None
            if g in sim.base:
                col = PALETTE[sim.base[g]]
                if sim.marks.get(g) == "sunken":
                    col = "#7FAF9C"
                d.rectangle([x, y, x + upx, y + upx], fill=col, outline=oln)
                c = combined.get(g, 0)
                if patina and c and upx >= 6:
                    r = max(1, upx // 10)
                    dark = tuple(int(int(col[i:i+2], 16) * 0.55)
                                 for i in (1, 3, 5))
                    for k, (ox, oy) in enumerate(
                            ((0.30, 0.34), (0.68, 0.52), (0.44, 0.74))):
                        if k >= min(c, 3):
                            break
                        d.ellipse([x + ox * upx - r, y + oy * upx - r,
                                   x + ox * upx + r, y + oy * upx + r],
                                  fill=dark)
            else:
                d.rectangle([x, y, x + upx, y + upx], fill="#FFFFFF",
                            outline="#D8D2C6" if upx >= 8 else None)
            if g in sim.people:
                d.rectangle([x + 1, y + 1, x + upx - 1, y + upx - 1],
                            fill=PEOPLE_COL[sim.people[g]])
                if upx < 8:
                    pass
                elif sim.people[g].startswith("farm"):
                    for i in (1, 2):
                        d.line([x + 2, y + i * upx // 3, x + upx - 2, y + i * upx // 3],
                               fill="#00000055")
                if upx >= 8 and sim.people[g] == "rural":
                    d.rectangle([x + upx // 3, y + upx // 2, x + 2 * upx // 3,
                                 y + upx - 3], fill="#6B4E2E")
            m = sim.marks.get(g) if upx >= 8 else None
            if m == "marsh":
                for i in range(3):
                    d.line([x + 3 + i * 4, y + upx - 4, x + 3 + i * 4, y + upx - 8],
                           fill="#2E5E50", width=1)
            elif m == "volcano":
                d.polygon([(x + upx // 2, y + 2), (x + 3, y + upx // 2),
                           (x + upx - 3, y + upx // 2)], fill="#C0392B")
            elif m == "canyon":
                d.line([x + 2, y + upx - 3, x + upx // 2, y + 3, x + upx - 2,
                        y + upx - 3], fill="#5A3E22", width=2)
            elif m == "ruins":
                d.line([x + 3, y + 3, x + upx - 3, y + upx - 3], fill="#555555", width=2)
                d.line([x + 3, y + upx - 3, x + upx - 3, y + 3], fill="#555555", width=2)
            elif m == "star":
                cx, cy = x + upx // 2, y + upx // 2
                for dx, dy in ((0, 5), (5, 0), (4, 4), (-4, 4)):
                    d.line([cx - dx, cy - dy, cx + dx, cy + dy], fill="#B8860B", width=2)
    for t in sim.tiles:
        ox, oy = tile_origin(t)
        x, y = px((ox, oy))
        d.rectangle([x, y, x + TILE_W * upx, y + TILE_H * upx],
                    outline="#4A4238", width=2 if upx >= 8 else 1)
    img.save(path)

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eras", type=int, default=8)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default="runs")
    ap.add_argument("--no-render", action="store_true",
                    help="skip PNG output (behavior neutral; log bytes unchanged)")
    ap.add_argument("--snapshots", action="store_true")
    ap.add_argument("--alive", action="store_true",
                    help="the Living Map: no Atlas, full panels rework, cities live")
    ap.add_argument("--tile", default="5x6",
                    help="tile geometry WxH: 5x6 mini-map (canon), 8x10 full-map, or any")
    ap.add_argument("--addpanel", type=int, default=None,
                    help="Add a Tile copies at the wake (full-map recipe: 2)")
    ap.add_argument("--archive-chance", type=float, default=0,
                    help="percent chance a panel is archived upon completion")
    ap.add_argument("--stroke-die", type=int, default=4)
    ap.add_argument("--stroke-add", type=int, default=1)
    ap.add_argument("--greatridge-die", type=int, default=None)
    ap.add_argument("--greatridge-add", type=int, default=0)
    ap.add_argument("--extend-cap", type=int, default=4)
    ap.add_argument("--semi", action="store_true",
                    help="the Semi-Living Map: the land rests, the people flow")
    ap.add_argument("--no-patina", action="store_true",
                    help="do not trace embellishments in rendered maps")
    ap.add_argument("--flat-work", action="store_true",
                    help="disable the per-card work spread (canon: on)")
    ap.add_argument("--living-deck", action="store_true",
                    help="the Living Deck: the deck composes, retires, and shuffles itself")
    ap.add_argument("--ld-start", type=int, default=5,
                    help="era the Add new card enters")
    ap.add_argument("--ld-add", type=float, default=0.30)
    ap.add_argument("--ld-retire", type=float, default=0.33)
    ap.add_argument("--ld-shuffle", type=float, default=0.25)
    ap.add_argument("--ld-floor", type=int, default=40,
                    help="Retire rests while the deck is under this size")
    ap.add_argument("--ld-ceiling", type=int, default=60,
                    help="Retire cuts two at or above this size")
    ap.add_argument("--work", default=None,
                    help="type average overrides, e.g. calm=8,settlement=5")
    ap.add_argument("--mood", default=None,
                    help="mood overrides, e.g. freestroke=settle,calm=settle")
    ap.add_argument("--fragile", action="store_true",
                    help="Fragile Cities: reworks and anomalies can destroy homes")

    args = ap.parse_args()
    seed = args.seed if args.seed is not None else random.SystemRandom().randint(1, 10**7)
    os.makedirs(args.out, exist_ok=True)
    tw, th = (int(v) for v in args.tile.lower().split("x"))
    sim = Sim(seed, args.eras, dict(alive=True, semi=True,
                                    archive_chance=args.archive_chance,
                                    stroke_die=args.stroke_die, stroke_add=args.stroke_add,
                                    greatridge_die=args.greatridge_die,
                                    greatridge_add=args.greatridge_add,
                                    extend_cap=args.extend_cap, fragile=True,
                                    tile_w=tw, tile_h=th, addpanel=args.addpanel,
                                    ld_retire=args.ld_retire,
                                    ld_shuffle=args.ld_shuffle,
                                    ld_floor=args.ld_floor,
                                    work_spread=not args.flat_work,
                                    mood=(dict(p.split("=") for p in args.mood.split(","))
                                          if args.mood else None),
                                    work=(dict(p.split("=") for p in args.work.split(","))
                                          and {k: int(v) for k, v in
                                               (p.split("=") for p in args.work.split(","))}
                                          if args.work else None)))
    # patch: snapshot per era
    if args.snapshots and not args.no_render:
        orig = sim.era_summary
        def snap(v):
            orig(v)
            render(sim, os.path.join(args.out, f"seed{seed}_era{sim.era}.png"),
                   patina=not args.no_patina)
        sim.era_summary = snap
    sim.run()
    if not args.no_render:
        render(sim, os.path.join(args.out, f"seed{seed}_final.png"),
               patina=not args.no_patina)
    report = sim.final_report()
    print(f"seed {seed}")
    print(report)
    with open(os.path.join(args.out, f"seed{seed}_log.txt"), "w") as f:
        f.write("\n".join(sim.loglines) + "\n" + report + "\n")

if __name__ == "__main__":
    main()
