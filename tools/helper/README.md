# tools/helper — the play helper

**Shipped, inside the PWA** (`apps/pwa/src/helper/`): the Helper tab is the
interactive companion for playing on paper — guided ages through the engine's
frontier seam (CONTRACTS §4.3), proposal mode over the same machinery, lazy
state entry with checkpoints and overrides, and a record whose replay through
the plain ScriptedDecider is byte-identical (the identity tests in
`apps/pwa/tests/helper-identity.test.ts` prove it on every CI run).

This directory remains the home for any future *standalone* helper tooling
(CLI record surgery over `--record`/`--replay` files, batch re-rolls). The
engine primitives it would need are the same ones the PWA already speaks:
`jm_helper_create`, `jm_helper_age`, and the §4 decision-record format.
