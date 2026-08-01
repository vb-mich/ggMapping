import { useEffect } from "preact/hooks";

import { DISPLAY_NAME, STRINGS } from "../strings";
import {
  addpanelCopies,
  applyTheme,
  backToCanon,
  cancelRun,
  deckCopies,
  engineLineage,
  errorMessage,
  eras,
  flatWork,
  foreignLineage,
  moodOverrides,
  panelSize,
  progressEra,
  requestDeckPreview,
  requestLineage,
  reroll,
  resumeWorld,
  retiredKey,
  seed,
  startRun,
  status,
  theme,
  workOverrides,
} from "../state";
import { applyUpdate, updateAvailable } from "../updates";
import { ConfigPanel } from "./ConfigPanel";
import { DeckEditor } from "./DeckEditor";
import { FilesBar } from "./FilesBar";
import { MapView } from "./MapView";
import { NavPanel } from "./NavPanel";
import { NowPanel } from "./NowPanel";
import { ReportCard } from "./ReportCard";
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
  // Ask the engine which rules it speaks, once, at startup.
  useEffect(() => {
    requestLineage();
  }, []);

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
        {engineLineage.value && (
          <span class="chip lineage-chip" data-testid="lineage-badge"
            title={STRINGS.lineageTitle}>
            {STRINGS.lineageLabel} {engineLineage.value}
          </span>
        )}
        <button
          class="ghost theme-toggle"
          data-testid="btn-theme"
          onClick={() => applyTheme(theme.value === "dark" ? "light" : "dark")}
        >
          {theme.value === "dark" ? STRINGS.themeLight : STRINGS.themeDark}
        </button>
      </header>
      {foreignLineage.value && (
        <div class="card notice" data-testid="foreign-lineage-notice" role="status">
          <span>
            {STRINGS.foreignLineageNotice
              .replace("{theirs}", foreignLineage.value)
              .replace("{ours}", engineLineage.value)}
          </span>
          <button class="ghost" data-testid="btn-dismiss-notice"
            onClick={() => (foreignLineage.value = null)}>
            {STRINGS.dismiss}
          </button>
        </div>
      )}
      {retiredKey.value && (
        <div class="card notice" data-testid="retired-key-notice" role="status">
          <span>{STRINGS.retiredKeyNotice.replace("{key}", retiredKey.value)}</span>
          <button class="ghost" data-testid="btn-dismiss-retired"
            onClick={() => (retiredKey.value = null)}>
            {STRINGS.dismiss}
          </button>
        </div>
      )}
      {updateAvailable.value && (
        <button class="primary update-toast" data-testid="btn-update" onClick={applyUpdate}>
          {STRINGS.updateNow}
        </button>
      )}
      <RunBar />
      <main>
        <div class="col-side">
          <ConfigPanel />
          <DeckEditor />
          <FilesBar />
        </div>
        <div class="col-main">
          <div class="now-nav">
            <NavPanel />
            <NowPanel />
          </div>
          <MapView />
          <StatsStrip />
          <ReportCard />
        </div>
      </main>
      <footer>
        <small data-testid="app-version">v{__JM_VERSION__}</small>
      </footer>
    </>
  );
}
