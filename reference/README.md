# /reference — the founding document and the living twin

`sim.py` is the Python **v0.4** reference simulator: the founding document. Its
freeze is behavioral — rules, text, and formatting untouchable; behavior-neutral
tooling changes proven by the gate (`--no-render`) are the only edits allowed
(CONTRACTS §8.4). It stays here as history; its lineage retired with the v0.5
increment.

`sim_v06.py` is the Python twin: the oracle of the current gate. Under the
twin-implementation regime, every rules increment lands in the Python twin and
the C++ engine together, and the nine-cell matrix must be byte-identical three
ways (python, native, wasm) before the increment is law. The twin carries the
v0.5 lineage (the depth erratum and the rename ledger, `docs/FORK_NOTES.md`
§v0.5) plus the **v0.6 experimental fields dial** (`--exp-fields`, §v0.6) —
default OFF, so the canon lineage and every fixture are untouched. It supersedes
the pre-dial `sim_v05.py`, whose behavior it reproduces byte-for-byte with the
dial off.

`sample_log_seed42.txt` is the twin's own **canon** output for `--seed 42
--eras 20` (dial off, LF line endings), the browser-smoke golden. Regenerate
only to prove the twin unchanged:

```bash
python reference/sim_v06.py --seed 42 --eras 20 --out /tmp/oracle --no-render
```

`history-v0.4/` holds the retired v0.4 fixtures. The RNG contract and its
official test vectors live in `docs/FORK_NOTES.md` §v0.4 and `docs/CONTRACTS.md`
§3 (unchanged in v0.5). The old Mersenne-era build (pre-v0.4) and its sample log
were accidental pastes and were removed; the research repo is the historical
archive.
