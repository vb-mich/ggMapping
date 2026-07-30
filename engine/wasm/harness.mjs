#!/usr/bin/env node
// Node identity-gate harness: runs the WASM engine module with the reference
// CLI surface. Usage: node harness.mjs dist/jerrymap.js --seed 42 --eras 20 --out DIR
import { spawnSync } from "node:child_process";

const [modulePath, ...args] = process.argv.slice(2);
if (!modulePath) {
  console.error("usage: node harness.mjs <jerrymap.js> [cli flags...]");
  process.exit(2);
}
const r = spawnSync(process.execPath, [modulePath, ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
