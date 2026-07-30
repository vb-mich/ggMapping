# engine — the C++20 headless core

A byte-exact port of `reference/sim.py` (the v0.4 oracle) under the CONTRACTS.md law:
no floats (the report layer emulates CPython's binary64 formatting in pure integers,
`src/softfloat.cpp`), no globals (geometry and all state live in `Sim`), every random
draw through the `Decider`, every output line rendered from the structured event
stream (`src/events.cpp`).

## Build (native)

Any C++20 compiler with `__int128` (GCC, Clang, Emscripten); no dependencies:

```bash
g++ -std=c++20 -O2 -Wall -Iengine/include -o build/jerrymap engine/cli/main.cpp engine/src/*.cpp
```

## Tests

```bash
python engine/tests/golden/generate_softfloat_cases.py   # regenerates CPython goldens
g++ -std=c++20 -O2 -Wall -Iengine/include -o build/engine_tests engine/tests/test_engine.cpp engine/src/*.cpp
build/engine_tests engine/tests/golden/softfloat_cases.txt
```

The RNG vectors run first and gate everything else (CONTRACTS §3).

## CLI

Same flags and defaults as the reference (CONTRACTS §7). Engine extensions:

| flag | what |
|---|---|
| `--record FILE` | write the decision tape (JSONL, CONTRACTS §4) |
| `--replay FILE` | drive the run from a tape via the ScriptedDecider |
| `--save FILE` | write the state document (CONTRACTS §6) at run end |
| `--save-at N --save FILE` | stop after N ages, save, write the partial log |
| `--load FILE` | resume from a state document (other config flags ignored) |

## WASM

```bash
bash engine/wasm/build.sh        # needs emcc on PATH (emsdk)
node engine/wasm/dist/jerrymap.js --seed 42 --eras 20 --out /tmp/w
```

The module is Node-flavored (NODERAWFS) so the identity gate can run it against
Python and native byte-for-byte; it also exports the `jm_*` C API
(`engine/wasm/bindings.cpp`) for the PWA conversation. The gate:

```bash
python scripts/run_gate.py --native build/jerrymap --wasm engine/wasm/dist/jerrymap.js
python scripts/run_proofs.py --native build/jerrymap
```
