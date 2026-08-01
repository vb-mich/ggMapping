# /reference — the founding document and the living twin

`sim.py` is the Python **v0.4** reference simulator: the founding document. Its
freeze is behavioral — rules, text, and formatting untouchable; behavior-neutral
tooling changes proven by the gate (`--no-render`) are the only edits allowed
(CONTRACTS §8.4). It stays here as history; its lineage retired with v0.5.

`sim_v08.py` is the Python twin: the oracle of the current gate, lineage
**v0.8**. Under the twin-implementation regime, every rules increment lands in
the Python twin and the C++ engine together, and the full matrix must be
byte-identical three ways (python, native, wasm) before the increment is law.
The v0.8 delta — the chapter 11 fields experiment promoted into canon, so the
dial is gone end to end and the rules cannot be turned off — is specified in
`docs/FORK_NOTES.md` §v0.8. It supersedes `sim_v07.py`.

`sample_log_seed42_v08.txt` is the twin's own **canon** output for `--seed 42
--eras 20` (LF line endings), the browser-smoke golden. Regenerate
only to prove the twin unchanged:

```bash
python reference/sim_v08.py --seed 42 --eras 20 --out /tmp/oracle --no-render
```

`history-v0.4/`, `history-v0.5/` and `history-v0.7/` hold the retired fixtures
of earlier lineages — named for the **lineage** whose worlds they describe, not for the twin
revision that produced them. The RNG contract and its official test vectors live
in `docs/FORK_NOTES.md` §v0.4 and `docs/CONTRACTS.md` §3 (unchanged since). The
old Mersenne-era build (pre-v0.4) and its sample log were accidental pastes and
were removed; the research repo is the historical archive.
