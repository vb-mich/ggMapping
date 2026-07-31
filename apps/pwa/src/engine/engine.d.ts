// The Emscripten web-flavored module: a MODULARIZE'd ES6 factory.
declare module "@engine/jerrymap.mjs" {
  const initModule: (opts?: {
    locateFile?: (file: string) => string;
  }) => Promise<unknown>;
  export default initModule;
}

declare module "@engine/jerrymap.wasm?url" {
  const url: string;
  export default url;
}

// Build identity, injected by vite.config.ts (package version + git sha).
declare const __JM_VERSION__: string;
