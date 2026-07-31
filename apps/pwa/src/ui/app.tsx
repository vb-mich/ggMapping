import { useEffect } from "preact/hooks";

import { DISPLAY_NAME, STRINGS } from "../strings";
import {
  addpanelCopies,
  cancelRun,
  deckCopies,
  errorMessage,
  eras,
  moodOverrides,
  panelSize,
  progressEra,
  requestDeckPreview,
  resumeWorld,
  seed,
  startRun,
  status,
  workOverrides,
} from "../state";
import { ConfigPanel } from "./ConfigPanel";
import { DeckEditor } from "./DeckEditor";
import { FilesBar } from "./FilesBar";
import { MapView } from "./MapView";
import { RecordView } from "./RecordView";

function RunBar() {
  const s = status.value;
  return (
    <div class="runbar card">
      <span class="seed-chip" data-testid="seed-chip">
        {STRINGS.seed} <b>{seed.value}</b>
      </span>
      {s !== "running" ? (
        <button class="primary" data-testid="btn-run" onClick={startRun}>
          {STRINGS.run}
        </button>
      ) : (
        <button data-testid="btn-cancel" onClick={cancelRun}>
          {STRINGS.cancel}
        </button>
      )}
      {s === "paused" && (
        <button data-testid="btn-continue" onClick={resumeWorld}>
          {STRINGS.continueRun}
        </button>
      )}
      <span class="status" data-testid="run-status" data-status={s}>
        {s === "running" && `${STRINGS.running} ${progressEra.value}/${eras.value}`}
        {s === "done" && STRINGS.runDone}
        {s === "paused" && STRINGS.runCanceled}
        {s === "error" && `${STRINGS.runFailed}: ${errorMessage.value}`}
      </span>
    </div>
  );
}

export function App() {
  // Keep the deck preview fresh: the engine derives the printed work numbers.
  useEffect(() => {
    const t = setTimeout(requestDeckPreview, 250);
    return () => clearTimeout(t);
  }, [
    deckCopies.value,
    addpanelCopies.value,
    workOverrides.value,
    moodOverrides.value,
    panelSize.value,
  ]);

  return (
    <>
      <header>
        <h1>
          {DISPLAY_NAME} <small>{STRINGS.tagline}</small>
        </h1>
      </header>
      <RunBar />
      <main>
        <div class="col-side">
          <ConfigPanel />
          <DeckEditor />
          <FilesBar />
        </div>
        <div class="col-main">
          <MapView />
          <RecordView />
        </div>
      </main>
    </>
  );
}
