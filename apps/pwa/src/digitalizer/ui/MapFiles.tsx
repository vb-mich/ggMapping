// The map's files: the whole-map PNG (honoring the timeline position) and
// the archive — a ZIP backup of the current map or all of them, and the
// restore that always lands in a NEW map.
import { useState } from "preact/hooks";

import { STRINGS } from "../../strings";
import { exportMapPng } from "../exportPng";
import { activeMap, atlas, safeFileName, standingBookmark } from "../store";

export function MapFiles() {
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState<"low" | "high">("high");
  const [transparent, setTransparent] = useState(false);
  const [note, setNote] = useState("");

  const onExport = async () => {
    const m = activeMap.value;
    if (!m) return;
    const shown = [...atlas.value.values()];
    if (!shown.length) {
      setNote(STRINGS.mmNothingToExport);
      return;
    }
    setBusy(true);
    setNote("");
    try {
      const bm = standingBookmark.value;
      const fileBase = safeFileName(bm ? `${m.name} - ${bm.name}` : m.name);
      const r = await exportMapPng(shown, { quality, transparent, fileBase });
      setNote(r.capped ? STRINGS.mmCapEngaged : "");
    } catch (e) {
      setNote(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="card map-files" data-testid="map-files">
      <h2>{STRINGS.mmFilesTitle}</h2>
      <div class="files-row">
        <button
          class="primary"
          data-testid="btn-export-png"
          disabled={busy}
          onClick={onExport}
        >
          {STRINGS.mmExportPng}
        </button>
        <label class="map-label">
          <span>{STRINGS.mmQuality}</span>
          <select
            data-testid="export-quality"
            value={quality}
            onChange={(e) =>
              setQuality((e.currentTarget as HTMLSelectElement).value as "low" | "high")
            }
          >
            <option value="high">{STRINGS.mmQualityHigh}</option>
            <option value="low">{STRINGS.mmQualityLow}</option>
          </select>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            data-testid="export-transparent"
            checked={transparent}
            onChange={(e) => setTransparent((e.currentTarget as HTMLInputElement).checked)}
          />
          {STRINGS.mmTransparent}
        </label>
      </div>
      {note && (
        <p class="note" data-testid="export-note" role="status">
          {note}
        </p>
      )}
      {busy && (
        <p class="note" data-testid="files-busy" role="status">
          {STRINGS.mmWorking}
        </p>
      )}
    </div>
  );
}
