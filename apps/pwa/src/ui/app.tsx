import { useSignal } from "@preact/signals";
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
import { beforeProfile, go, route, type Route } from "../router";
import { MyMapScreen } from "../digitalizer/ui/MyMapScreen";

// The Rulebook loads as its own chunk: the book and its parser stay out of
// the shell bundle, and the route pays for them only when opened.
let RulebookLoaded: typeof import("../rulebook/Rulebook").Rulebook | null = null;
function RulebookLazy({ route: r }: { route: Route }) {
  const ready = useSignal(RulebookLoaded !== null);
  useEffect(() => {
    if (!RulebookLoaded)
      void import("../rulebook/Rulebook").then((m) => {
        RulebookLoaded = m.Rulebook;
        ready.value = true;
      });
  }, []);
  if (!ready.value || !RulebookLoaded)
    return <main class="rulebook loading">{STRINGS.rbLoading}…</main>;
  const R = RulebookLoaded;
  return <R route={r} />;
}
import { ProfileScreen } from "../digitalizer/ui/ProfileScreen";
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
          {DISPLAY_NAME}
          {route.value.screen === "sim" && <small> {STRINGS.tagline}</small>}
        </h1>
        <nav class="screen-tabs" data-testid="screen-tabs">
          <button
            class={route.value.screen === "sim" ? "tab active" : "tab"}
            data-testid="tab-simulator"
            aria-current={route.value.screen === "sim" ? "page" : undefined}
            onClick={() => go("#/")}
          >
            {STRINGS.navSimulator}
          </button>
          <button
            class={
              route.value.screen === "sim" || route.value.screen === "rules"
                ? "tab"
                : "tab active"
            }
            data-testid="tab-mymap"
            aria-current={
              route.value.screen !== "sim" && route.value.screen !== "rules"
                ? "page"
                : undefined
            }
            onClick={() => go("#/map")}
          >
            {STRINGS.navMyMap}
          </button>
          <button
            class={route.value.screen === "rules" ? "tab active" : "tab"}
            data-testid="tab-rulebook"
            aria-current={route.value.screen === "rules" ? "page" : undefined}
            onClick={() => go("#/rules")}
          >
            {STRINGS.navRulebook}
          </button>
        </nav>
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
        <button
          class={
            route.value.screen.startsWith("profile")
              ? "ghost profile-btn active"
              : "ghost profile-btn"
          }
          data-testid="btn-profile"
          aria-label={STRINGS.pfTitle}
          title={STRINGS.pfTitle}
          onClick={() =>
            // the gear is a toggle: tap again to step back out
            route.value.screen.startsWith("profile")
              ? go(beforeProfile.value)
              : go("#/profile")
          }
        >
          ⚙
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
      {route.value.screen === "sim" ? (
        <>
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
        </>
      ) : route.value.screen === "rules" ? (
        <RulebookLazy route={route.value} />
      ) : route.value.screen.startsWith("profile") ? (
        <ProfileScreen route={route.value} />
      ) : (
        <MyMapScreen route={route.value} />
      )}
      <footer>
        <small data-testid="app-version">v{__JM_VERSION__}</small>
      </footer>
    </>
  );
}
