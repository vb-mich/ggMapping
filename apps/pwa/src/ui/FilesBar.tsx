// Files: save/load the CONTRACTS §6 world document, save/load the config
// capsule, export PNG from the canvas, export the log text, copy the
// shareable config JSON. Local only.
import { useSignal } from "@preact/signals";

import { mapCanvas } from "../map/canvasRef";
import { STRINGS } from "../strings";
import {
  loadConfigJson,
  loadWorld,
  logText,
  seed,
  shareableConfig,
  worldJson,
} from "../state";
import { download } from "./download";

function FileButton(props: {
  label: string;
  testid: string;
  onText: (text: string) => Promise<boolean> | boolean;
  onError: () => void;
}) {
  return (
    <label class="file-button">
      {props.label}
      <input
        type="file"
        accept=".json,application/json"
        data-testid={props.testid}
        onChange={async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = "";
          if (!f) return;
          if (!(await props.onText(await f.text()))) props.onError();
        }}
      />
    </label>
  );
}

export function FilesBar() {
  const copied = useSignal(false);
  const error = useSignal("");

  return (
    <section class="card">
      <h2>{STRINGS.filesTitle}</h2>
      <div class="files-row">
        <button
          data-testid="btn-save"
          disabled={!worldJson.value}
          onClick={() =>
            download(
              `jm-world-seed${seed.value}.json`,
              new Blob([worldJson.value], { type: "application/json" }),
            )
          }
        >
          {STRINGS.saveWorld}
        </button>
        <FileButton label={STRINGS.loadWorld} testid="input-load"
          onText={(t) => { error.value = ""; return loadWorld(t); }}
          onError={() => (error.value = STRINGS.loadFailed)} />
        <button
          data-testid="btn-save-config"
          onClick={() =>
            download(
              `jm-config-seed${seed.value}.json`,
              new Blob([shareableConfig()], { type: "application/json" }),
            )
          }
        >
          {STRINGS.saveConfig}
        </button>
        <FileButton label={STRINGS.loadConfig} testid="input-load-config"
          onText={(t) => { error.value = ""; return loadConfigJson(t); }}
          onError={() => (error.value = STRINGS.configLoadFailed)} />
        <button
          data-testid="btn-export-png"
          disabled={!worldJson.value}
          onClick={() =>
            mapCanvas.current?.toBlob(
              (b) => b && download(`jm-map-seed${seed.value}.png`, b),
              "image/png",
            )
          }
        >
          {STRINGS.exportPng}
        </button>
        <button
          data-testid="btn-export-log"
          disabled={!logText.value}
          onClick={() =>
            download(
              `jm-log-seed${seed.value}.txt`,
              new Blob([logText.value], { type: "text/plain" }),
            )
          }
        >
          {STRINGS.exportLog}
        </button>
        <button
          data-testid="btn-copy-config"
          onClick={async () => {
            await navigator.clipboard.writeText(shareableConfig());
            copied.value = true;
            setTimeout(() => (copied.value = false), 1500);
          }}
        >
          {copied.value ? STRINGS.copied : STRINGS.copyConfig}
        </button>
      </div>
      {error.value && <p class="error">{error.value}</p>}
    </section>
  );
}
