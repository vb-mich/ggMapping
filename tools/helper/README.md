# tools/helper — the play helper (stub)

Future conversation. The re-roll machinery designed in CONTRACTS.md §4: record an
auto run's decision stream, let the player inspect any decision (purpose, domain,
result), override it, and replay the rest through the ScriptedDecider. Also the
save/resume front end over the state schema (§6).

The engine already ships the primitives this tool needs: `--record`, `--replay`,
`--save`, `--load`.
