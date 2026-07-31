// Files: save/load the CONTRACTS §6 world document, export PNG from the
// canvas, export the log text, copy the shareable config JSON. Local only.
import { useSignal } from "@preact/signals";

import { mapCanvas } from "../map/canvasRef";
import { STRINGS } from "../strings";
import { loadWorld, logText, seed, shareableConfig, worldJson } from "../state";

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function FilesBar() {
  const copied = useSignal(false);
  const loadError = useSignal(false);

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
        <label class="file-button">
          {STRINGS.loadWorld}
          <input
            type="file"
            accept=".json,application/json"
            data-testid="input-load"
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = "";
              if (!f) return;
              loadError.value = !loadWorld(await f.text());
            }}
          />
        </label>
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
      {loadError.value && <p class="error">{STRINGS.loadFailed}</p>}
    </section>
  );
}
