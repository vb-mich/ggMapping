# /reference — the frozen oracle

`sim.py` is the Python v0.4 reference simulator: the founding document, and the
**oracle** for the byte-identity gate (CONTRACTS §8) until succession — enacted at
`v0.4-succession`. The freeze is behavioral: rules, text, and formatting are
untouchable; behavior-neutral tooling changes proven by the gate (`--no-render` is
the first) are the only edits allowed (CONTRACTS §8.4). Bug fixes happen in the C++
engine only after the fork notes bless them as a new lineage; this file stays as
history.

`sample_log_seed42.txt` is the oracle's own output for `--seed 42 --eras 20`
(v0.4 world lineage, LF line endings). Regenerate only to prove the oracle unchanged:

```bash
python reference/sim.py --seed 42 --eras 20 --out /tmp/oracle
```

The RNG contract and its official test vectors live in `docs/FORK_NOTES.md` §v0.4 and
`docs/CONTRACTS.md` §3. The old Mersenne-era build (pre-v0.4) and its sample log were
accidental pastes and were removed; the research repo is the historical archive.
