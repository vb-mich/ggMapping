#!/usr/bin/env python3
"""Generate softfloat golden cases from CPython itself: c/n*100 formatted with
:.0f and :.1f, the exact operations the oracle's reports perform."""
import os, random

HERE = os.path.dirname(os.path.abspath(__file__))
out = []
for n in range(1, 65):
    for c in range(0, n + 1):
        v = c / n * 100
        out.append(f"{c} {n} {v:.0f} {v:.1f}")
rng = random.Random(20260730)
for _ in range(4000):
    n = rng.randint(1, 200000)
    c = rng.randint(0, n)
    v = c / n * 100
    out.append(f"{c} {n} {v:.0f} {v:.1f}")
with open(os.path.join(HERE, "softfloat_cases.txt"), "w", newline="\n") as f:
    f.write("\n".join(out) + "\n")
print(f"{len(out)} cases")
