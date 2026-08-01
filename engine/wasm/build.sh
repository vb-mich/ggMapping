#!/usr/bin/env bash
# Build the WASM engine, two flavors from the same sources:
#   node — the identity-gate runner: NODERAWFS, links the CLI main, runs under
#          `node dist/jerrymap.js --seed 42 --eras 20 --out DIR`
#   web  — the PWA's engine: no filesystem, MODULARIZE'd ES6 module exposing
#          only the jm_* C API (dist/web/jerrymap.mjs + .wasm)
# Usage: build.sh [node|web|all]   (default: all)
set -euo pipefail
cd "$(dirname "$0")"
what="${1:-all}"

# Every engine source except the CLI, which only the node flavor links. Globbed
# on purpose: the native build uses src/*.cpp, and a hand-kept list here drifts
# from it silently (a new file simply fails to link, or worse, links in one
# flavor only). FORK_NOTES §v0.7 housekeeping calls out exactly this hazard.
CORE=$(ls ../src/*.cpp | grep -v '/cli\.cpp$' | tr '\n' ' ')

if [[ "$what" == "node" || "$what" == "all" ]]; then
  mkdir -p dist
  emcc -std=c++20 -O3 -Wall -I../include \
    ../cli/main.cpp ../src/cli.cpp $CORE bindings.cpp \
    -o dist/jerrymap.js \
    -sNODERAWFS=1 -sALLOW_MEMORY_GROWTH=1 -sEXIT_RUNTIME=1 \
    -sSTACK_SIZE=2097152 -fexceptions \
    -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
    "-sEXPORTED_FUNCTIONS=_main,_jm_version,_jm_lineage,_jm_patina,_jm_create,_jm_load,_jm_step,_jm_run,_jm_log,_jm_report,_jm_state,_jm_events,_jm_time,_jm_free,_malloc,_free"
fi

if [[ "$what" == "web" || "$what" == "all" ]]; then
  mkdir -p dist/web
  emcc -std=c++20 -O3 -Wall -I../include \
    $CORE bindings.cpp \
    -o dist/web/jerrymap.mjs \
    --no-entry \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node \
    -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sSTACK_SIZE=2097152 -fexceptions \
    -sWASM_BIGINT=1 \
    -sEXPORTED_RUNTIME_METHODS=ccall,cwrap,UTF8ToString,stringToUTF8,lengthBytesUTF8 \
    "-sEXPORTED_FUNCTIONS=_jm_version,_jm_lineage,_jm_patina,_jm_create,_jm_load,_jm_step,_jm_run,_jm_log,_jm_report,_jm_state,_jm_events,_jm_time,_jm_free,_malloc,_free"
fi

ls -la dist/ dist/web/ 2>/dev/null || ls -la dist/
