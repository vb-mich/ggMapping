# /reference — the frozen oracle

`sim.py` is the Python v0.4 reference simulator: the **oracle** for the byte-identity
gate (CONTRACTS §8) until succession. It is vendored and frozen — no edits, ever.
Bug fixes happen in the C++ engine only after the fork notes bless them as a new
lineage; this file stays as history.

`sample_log_seed42.txt` is the oracle's own output for `--seed 42 --eras 20`
(v0.4 world lineage, LF line endings). Regenerate only to prove the oracle unchanged:

```bash
python reference/sim.py --seed 42 --eras 20 --out /tmp/oracle
```

The RNG contract and its official test vectors live in `docs/FORK_NOTES.md` §v0.4 and
`docs/CONTRACTS.md` §3. The old Mersenne-era build (pre-v0.4) and its sample log were
accidental pastes and were removed; the research repo is the historical archive.
