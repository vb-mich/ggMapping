// The second screen of the app: the player's own physical map, digitalized.
// Local-only in act one — the storage layer underneath is where act two's
// sync will attach; nothing here speaks to a network.
import { useEffect, useState } from "preact/hooks";

import { STRINGS } from "../../strings";
import { go, type Route } from "../../router";
import { panelName } from "../../contracts/geometry";
import {
  activeMap,
  facts,
  fmtBytes,
  forgetMerge,
  maps,
  newMap,
  notice,
  pendingUndo,
  refresh,
  storeDead,
  switchMap,
  undoMerge,
} from "../store";
import { Atlas } from "./Atlas";
import { MapFiles } from "./MapFiles";
import { PanelDetail } from "./PanelDetail";
import { ScanFlow } from "./ScanFlow";
import { Timeline } from "./Timeline";

export function MyMapScreen({ route }: { route: Route }) {
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div class="mymap">
      {notice.value && (
        <div class="card notice" data-testid="mm-notice" role="status">
          <span>{notice.value}</span>
          <button class="ghost" data-testid="btn-mm-dismiss" onClick={() => (notice.value = null)}>
            {STRINGS.dismiss}
          </button>
        </div>
      )}

      {/* a merge stays undoable for the rest of the session: the offer
          follows the player across the screen, and only they retire it */}
      {pendingUndo.value && (
        <div class="card notice" data-testid="merge-undo" role="status">
          <span>
            {STRINGS.mmMergeDone
              .replace("{from}", panelName(pendingUndo.value.from.tx, pendingUndo.value.from.ty))
              .replace("{to}", panelName(pendingUndo.value.to.tx, pendingUndo.value.to.ty))
              .replace("{n}", String(pendingUndo.value.ids.length))}
          </span>
          <button data-testid="btn-undo-merge" onClick={undoMerge}>
            {STRINGS.mmUndoMerge}
          </button>
          <button class="ghost" data-testid="btn-keep-merge" onClick={forgetMerge}>
            {STRINGS.dismiss}
          </button>
        </div>
      )}

      {route.screen === "scan" ? (
        <ScanFlow />
      ) : route.screen === "panel" ? (
        <PanelDetail tx={route.tx} ty={route.ty} />
      ) : (
        <>
          <div class="card mymap-bar">
            <button
              class="primary"
              data-testid="btn-scan"
              disabled={storeDead.value}
              onClick={() => go("#/map/scan")}
            >
              {STRINGS.mmScanButton}
            </button>
            <MapPicker />
          </div>
          <Timeline />
          <Atlas />
          <MapFiles />
        </>
      )}

      <p class="mm-footer" data-testid="mm-footer">
        {footerLine()}
      </p>
    </div>
  );
}

function footerLine(): string {
  const f = facts.value;
  if (!f) return "";
  const parts = [
    `${f.scans} ${f.scans === 1 ? STRINGS.mmScanWord : STRINGS.mmScansWord}`,
    fmtBytes(f.bytes),
  ];
  if (f.persisted === true) parts.push(STRINGS.mmPersistent);
  else if (f.persisted === false) parts.push(STRINGS.mmBestEffort);
  return parts.join(" · ");
}

function MapPicker() {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const current = activeMap.value;

  const onCreate = async () => {
    await newMap(name.trim());
    setName("");
    setCreating(false);
  };

  return (
    <span class="map-picker">
      <label class="map-label">
        <span>{STRINGS.mmMapLabel}</span>
        <select
          data-testid="map-select"
          value={current?.id ?? ""}
          onChange={(e) => switchMap((e.currentTarget as HTMLSelectElement).value)}
        >
          {maps.value.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {!creating ? (
        <button class="ghost" data-testid="btn-new-map" onClick={() => setCreating(true)}>
          {STRINGS.mmNewMap}
        </button>
      ) : (
        <span class="map-create">
          <input
            type="text"
            placeholder={STRINGS.mmMapName}
            value={name}
            data-testid="input-map-name"
            onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <button data-testid="btn-map-create" onClick={onCreate}>
            {STRINGS.mmCreate}
          </button>
        </span>
      )}
    </span>
  );
}
