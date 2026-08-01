// The typed face of the WASM engine: the jm_* C API and nothing else.
// The app speaks CONTRACTS surfaces through it; no rules live on this side.
import initModule from "@engine/jerrymap.mjs";
import wasmUrl from "@engine/jerrymap.wasm?url";

import type { JmConfig, JmEvent, JmTime, WorldState } from "../contracts/schema";

interface EmModule {
  _jm_version(): number;
  _jm_lineage(): number;
  _jm_patina(state: number): number;
  _jm_create(cfg: number, seed: bigint, eras: number): number;
  _jm_load(state: number): number;
  _jm_step(h: number): number;
  _jm_run(h: number): void;
  _jm_log(h: number): number;
  _jm_report(h: number): number;
  _jm_state(h: number): number;
  _jm_events(h: number): number;
  _jm_time(h: number): number;
  _jm_free(h: number): void;
  _malloc(n: number): number;
  _free(p: number): void;
  UTF8ToString(p: number): string;
  stringToUTF8(s: string, p: number, n: number): void;
  lengthBytesUTF8(s: string): number;
}

export class Engine {
  private constructor(private m: EmModule) {}

  static async load(): Promise<Engine> {
    const m = (await initModule({
      locateFile: (f: string) => (f.endsWith(".wasm") ? wasmUrl : f),
    })) as EmModule;
    return new Engine(m);
  }

  private withCStr<T>(s: string, f: (p: number) => T): T {
    const n = this.m.lengthBytesUTF8(s) + 1;
    const p = this.m._malloc(n);
    try {
      this.m.stringToUTF8(s, p, n);
      return f(p);
    } finally {
      this.m._free(p);
    }
  }

  version(): string {
    return this.m.UTF8ToString(this.m._jm_version());
  }

  // The rules lineage (CONTRACTS §9), read from the engine — never duplicated
  // app-side. Seeds do not survive a lineage break, so worlds and configs
  // carry it and testers compare against it.
  lineage(): string {
    return this.m.UTF8ToString(this.m._jm_lineage());
  }

  // Where the rework marks go (CONTRACTS §2.5). The engine decides, every
  // renderer consumes: a second implementation is a second corner bias waiting
  // to happen. Stateless, so a world merely being viewed still draws its patina.
  patina(stateJson: string): [number, number, number][] {
    return JSON.parse(
      this.withCStr(stateJson, (p) => this.m.UTF8ToString(this.m._jm_patina(p))),
    ) as [number, number, number][];
  }

  create(config: JmConfig, seed: number, eras: number): number {
    const h = this.withCStr(JSON.stringify(config), (p) =>
      this.m._jm_create(p, BigInt(seed), eras),
    );
    if (!h) throw new Error("jm_create rejected the config");
    return h;
  }

  loadState(stateJson: string): number {
    const h = this.withCStr(stateJson, (p) => this.m._jm_load(p));
    if (!h) throw new Error("jm_load rejected the document");
    return h;
  }

  step(h: number): boolean {
    return this.m._jm_step(h) === 1;
  }
  run(h: number): void {
    this.m._jm_run(h);
  }
  log(h: number): string {
    return this.m.UTF8ToString(this.m._jm_log(h));
  }
  report(h: number): string {
    return this.m.UTF8ToString(this.m._jm_report(h));
  }
  stateJson(h: number): string {
    return this.m.UTF8ToString(this.m._jm_state(h));
  }
  state(h: number): WorldState {
    return JSON.parse(this.stateJson(h)) as WorldState;
  }
  events(h: number): JmEvent[] {
    return JSON.parse(this.m.UTF8ToString(this.m._jm_events(h))) as JmEvent[];
  }
  time(h: number): JmTime {
    return JSON.parse(this.m.UTF8ToString(this.m._jm_time(h))) as JmTime;
  }
  free(h: number): void {
    this.m._jm_free(h);
  }
}
