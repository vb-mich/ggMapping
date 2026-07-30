# apps/pwa — the Jerrymapping PWA shell (stub)

Future conversation. The PWA renders worlds and drives play sessions on top of the
WASM engine (`engine/wasm`), speaking only the CONTRACTS.md surfaces:

* loads/saves worlds via the state schema (§6),
* renders from the structured event stream (§5) — never by parsing log text,
* routes all randomness through a Decider (§4) so the helper tool can re-roll,
* uses panel/age/rework vocabulary everywhere (§1).

Nothing here yet beyond this contract pointer. Do not add engine logic to the app;
the engine is the single source of rules.
