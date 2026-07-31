import { useEffect } from "preact/hooks";

import { DISPLAY_NAME, STRINGS } from "../strings";
import {
  addpanelCopies,
  applyTheme,
  backToCanon,
  cancelRun,
  deckCopies,
  errorMessage,
  eras,
  flatWork,
  moodOverrides,
  panelSize,
  progressEra,
  requestDeckPreview,
  reroll,
  resumeWorld,
  seed,
  startRun,
  status,
  theme,
  workOverrides,
} from "../state";
import { ConfigPanel } from "./ConfigPanel";
import { DeckEditor } from "./DeckEditor";
import { FilesBar } from "./FilesBar";
import { MapView } from "./MapView";
import { NavPanel } from "./NavPanel";
import { NowPanel } from "./NowPanel";
import { RecordView } from "./RecordView";
import { StatsStrip } from "./StatsStrip";

function RunBar() {
  const s = status.value;
  return (
    <div class="runbar card">
      <span class="seed-chip" data-testid="seed-chip">
        {STRINGS.seed} <b>{seed.value}</b>
      </span>
      {s !== "running" ? (
        <>
          <button class="primary" data-testid="btn-run" onClick={startRun}>
            {STRINGS.run}
          </button>
          <button data-testid="btn-reroll" onClick={reroll}>
            {STRINGS.reroll}
          </button>
          <button class="ghost" data-testid="btn-canon" onClick={backToCanon}>
            {STRINGS.backToCanon}
          </button>
        </>
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
    flatWork.value,
  ]);

  return (
    <>
      <header>
        <h1>
          {DISPLAY_NAME} <small>{STRINGS.tagline}</small>
        </h1>
        <button
          class="ghost theme-toggle"
          data-testid="btn-theme"
          onClick={() => applyTheme(theme.value === "dark" ? "light" : "dark")}
        >
          {theme.value === "dark" ? STRINGS.themeLight : STRINGS.themeDark}
        </button>
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
          <div class="now-nav">
            <NowPanel />
            <NavPanel />
          </div>
          <StatsStrip />
          <RecordView />
        </div>
      </main>
    </>
  );
}
