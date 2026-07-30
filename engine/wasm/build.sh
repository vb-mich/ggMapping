#!/usr/bin/env bash
# Build the WASM engine (Node-flavored: NODERAWFS so the CLI main reads and
# writes the real filesystem under `node`). The PWA conversation will add a
# browser-flavored build (no NODERAWFS, MODULARIZE) from the same sources.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
emcc -std=c++20 -O3 -Wall -I../include \
  ../cli/main.cpp ../src/softfloat.cpp ../src/json.cpp ../src/events.cpp \
  ../src/sim.cpp ../src/state.cpp ../src/cli.cpp bindings.cpp \
  -o dist/jerrymap.js \
  -sNODERAWFS=1 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1 \
  -sSTACK_SIZE=2097152 \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
  "-sEXPORTED_FUNCTIONS=_main,_jm_version,_jm_create,_jm_load,_jm_step,_jm_run,_jm_log,_jm_report,_jm_state,_jm_free,_malloc,_free"
ls -la dist/
