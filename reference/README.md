# /reference — the founding document and the living twin

`sim.py` is the Python **v0.4** reference simulator: the founding document. Its
freeze is behavioral — rules, text, and formatting untouchable; behavior-neutral
tooling changes proven by the gate (`--no-render`) are the only edits allowed
(CONTRACTS §8.4). It stays here as history; its lineage retired with the v0.5
increment.

`sim_v05.py` is the Python **v0.5** twin: the oracle of the current gate. Under
the twin-implementation regime, every rules increment lands in the Python twin
and the C++ engine together, and the nine-cell matrix must be byte-identical
three ways (python, native, wasm) before the increment is law. The v0.5 deltas —
the depth erratum (plain Add Panel, whole-game cycle-marker shuffle) and the
rename ledger — are specified in `docs/FORK_NOTES.md` §v0.5.

`sample_log_seed42.txt` is the v0.5 twin's own output for `--seed 42 --eras 20`
(LF line endings), the browser-smoke golden. Regenerate only to prove the twin
unchanged:

```bash
python reference/sim_v05.py --seed 42 --eras 20 --out /tmp/oracle --no-render
```

`history-v0.4/` holds the retired v0.4 fixtures. The RNG contract and its
official test vectors live in `docs/FORK_NOTES.md` §v0.4 and `docs/CONTRACTS.md`
§3 (unchanged in v0.5). The old Mersenne-era build (pre-v0.4) and its sample log
were accidental pastes and were removed; the research repo is the historical
archive.
