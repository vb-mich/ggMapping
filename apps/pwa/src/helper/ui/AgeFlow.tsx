// The age at the table: the age-start glance, the card picker, the guided
// question loop (spatial taps, the dice triplet, previews, undo), the
// proposal review with its honesty marks, and commit. One component,
// phase-driven off the live session.
import { useSignal } from "@preact/signals";

import { STRINGS } from "../../strings";
import { panelName } from "../../contracts/geometry";
import type { HelperQuestion, JmEvent } from "../../contracts/schema";
import { geoOf } from "../core";
import type { HelperSession } from "../session";
import {
  acceptProposal,
  answer,
  beginAge,
  commitAge,
  drawForMe,
  reopenLast,
  rollForMe,
  setModePref,
  takeover,
  undo,
} from "../store";
import { candidateLabel, cardBookHash, CARD_NAMES, DICE_CHAPTER, dieQuestion } from "./labels";
import { rulesHash } from "../../router";

function EventLines(props: { events: JmEvent[]; from?: number; testid?: string }) {
  const lines: string[] = [];
  for (const e of props.events.slice(props.from ?? 0)) for (const t of e.text) lines.push(t);
  if (!lines.length) return null;
  return (
    <pre class="age-log" data-testid={props.testid ?? "age-log"}>
      {lines.join("\n")}
    </pre>
  );
}

// The card picker, mirroring the deck state: this cycle's unrevealed cards.
function CardPicker(props: { s: HelperSession; mode: "guided" | "proposal" }) {
  const remaining = props.s.remaining();
  const forced = remaining.length === 1 && remaining[0].count === 1;
  return (
    <div class="card-picker" data-testid="card-picker">
      <h3>{STRINGS.hpWhichCard}</h3>
      {forced && <p class="hint">{STRINGS.hpForcedCard}</p>}
      <div class="picker-cards">
        {remaining.map((c) => (
          <button
            key={`${c.kind}|${c.work}`}
            class="picker-card"
            data-testid={`pick-card-${c.kind}-${c.work}`}
            onClick={() => beginAge({ kind: c.kind, work: c.work }, props.mode)}
          >
            <b>{CARD_NAMES[c.kind] ?? c.kind}</b>
            <span class="work">{c.work}</span>
            {c.count > 1 && <span class="count">×{c.count}</span>}
          </button>
        ))}
      </div>
      <button class="ghost" data-testid="btn-draw-for-me" onClick={() => drawForMe(props.mode)}>
        {STRINGS.hpDrawForMe}
      </button>
    </div>
  );
}

// The dice triplet, three buttons of equal dignity (the book's own options).
function DieCard(props: { q: HelperQuestion }) {
  const expand = useSignal<"enter" | "choose" | null>(null);
  const q = props.q;
  const faces = [...Array(q.domain).keys()].map((i) => i + 1);
  return (
    <div data-testid="die-question">
      <h3>
        {dieQuestion(q.purpose, q.domain)}{" "}
        <a class="book-link" href={rulesHash(DICE_CHAPTER)} data-testid="die-book-link">
          {STRINGS.hpBookLink}
        </a>
      </h3>
      <div class="dice-triplet">
        <button
          class={expand.value === "enter" ? "primary" : ""}
          data-testid="die-enter"
          onClick={() => (expand.value = expand.value === "enter" ? null : "enter")}
        >
          {STRINGS.hpEnterRoll}
        </button>
        <button data-testid="die-roll" onClick={() => rollForMe()}>
          {STRINGS.hpRollForMe}
        </button>
        <button
          class={expand.value === "choose" ? "primary" : ""}
          data-testid="die-choose"
          title={STRINGS.hpChooseHint}
          onClick={() => (expand.value = expand.value === "choose" ? null : "choose")}
        >
          {STRINGS.hpChooseOutcome}
        </button>
      </div>
      {expand.value && (
        <div class="die-faces" data-testid="die-faces">
          {faces.map((f) => (
            <button
              key={f}
              data-testid={`die-face-${f}`}
              onClick={() => answer(f, expand.value === "enter" ? "entered" : "chosen")}
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChanceCard(props: { q: HelperQuestion }) {
  const q = props.q;
  return (
    <div data-testid="chance-question">
      <h3>{STRINGS.hpChanceQuestion.replace("{pct}", String(q.domain / 10))}</h3>
      <div class="dice-triplet">
        <button data-testid="chance-yes" onClick={() => answer(true, "entered")}>
          {STRINGS.hpChanceYes}
        </button>
        <button data-testid="chance-no" onClick={() => answer(false, "entered")}>
          {STRINGS.hpChanceNo}
        </button>
        <button data-testid="chance-roll" onClick={() => rollForMe()}>
          {STRINGS.hpRollForMe}
        </button>
      </div>
    </div>
  );
}

function PickCard(props: { s: HelperSession; q: HelperQuestion }) {
  const q = props.q;
  const geo = geoOf(props.s.current());
  const spatial =
    (q.cands ?? []).some((c) => typeof c === "object") ||
    q.purpose === "panel position" ||
    (q.ctx?.length ?? 0) > 0;
  return (
    <div data-testid="pick-question">
      <h3>
        {STRINGS.hpQuestionChip}: {q.purpose}
      </h3>
      {spatial && (
        <p class="hint">
          {q.purpose === "panel position" ? STRINGS.hpTapPanel : STRINGS.hpTapCandidate}
        </p>
      )}
      <div class="pick-list" data-testid="pick-list">
        {(q.cands ?? []).map((c, i) => (
          <button key={i} data-testid={`pick-cand-${i}`} onClick={() => answer(i, "player")}>
            {candidateLabel(q.purpose, geo, c, q.ctx?.[i] ?? null)}
          </button>
        ))}
      </div>
    </div>
  );
}

// One proposal row: the decision, its answer in words, the suggestion mark.
function proposalLine(
  s: HelperSession,
  row: { rec: { kind: string; purpose: string; domain: number; result: unknown } },
): string {
  const geo = geoOf(s.current());
  const r = row.rec;
  if (r.kind === "die") return `d${r.domain} = ${r.result} (${r.purpose})`;
  if (r.kind === "chance") return `${r.purpose}: ${r.result ? "yes" : "no"}`;
  if (r.kind === "shuffle") return STRINGS.hpShuffleNote;
  return `${r.purpose}: choice ${(r.result as number) + 1} of ${r.domain}`;
  void geo;
}

function ProposalCard(props: { s: HelperSession }) {
  const rows = props.s.proposalRows();
  return (
    <div data-testid="proposal-card">
      <h3>{STRINGS.hpProposalTitle}</h3>
      <p class="hint">{STRINGS.hpProposalHint}</p>
      <ol class="proposal-rows">
        {rows.map((row, i) => (
          <li key={i}>
            <button
              class="proposal-row"
              data-testid={`proposal-row-${i}`}
              title={STRINGS.hpSuggestionHint}
              onClick={() => takeover(i)}
            >
              <span>{proposalLine(props.s, row)}</span>
              {row.source === "policy" && (
                <em class="chip suggestion" data-testid={`suggestion-${i}`}>
                  {STRINGS.hpSuggestion}
                </em>
              )}
              <span class="takeover">{STRINGS.hpTakeover}</span>
            </button>
          </li>
        ))}
      </ol>
      <button class="primary" data-testid="btn-accept-proposal" onClick={() => acceptProposal()}>
        {STRINGS.hpAccept}
      </button>
    </div>
  );
}

export function AgeFlow(props: {
  s: HelperSession;
  mode: "guided" | "proposal";
  readOnly: boolean;
  glanceOk: boolean;
  onGlanceOk: () => void;
  missingSpread: [number, number][];
  onEnterPanel: (panel: [number, number]) => void;
}) {
  const s = props.s;
  const view = s.view;
  const open = s.open;

  if (props.readOnly) return null;

  // no age open: the glance, then the picker
  if (!open) {
    const lastIsAge = s.entries[s.entries.length - 1]?.type === "age";
    return (
      <section class="card age-flow" data-testid="age-flow-idle">
        {!props.glanceOk ? (
          <div data-testid="glance">
            <p>{STRINGS.hpGlance}</p>
            {props.missingSpread.length > 0 && (
              <p class="hint" data-testid="spread-missing">
                {STRINGS.hpSpreadMissing.replace(
                  "{names}",
                  props.missingSpread.map(([tx, ty]) => panelName(tx, ty)).join(", "),
                )}
              </p>
            )}
            <div class="row">
              {props.missingSpread.map(([tx, ty]) => (
                <button
                  key={`${tx},${ty}`}
                  data-testid={`enter-panel-${tx}-${ty}`}
                  onClick={() => props.onEnterPanel([tx, ty])}
                >
                  {STRINGS.hpEnterPanel.replace("{name}", panelName(tx, ty))}
                </button>
              ))}
              <button
                class="primary"
                data-testid="btn-glance-ok"
                disabled={props.missingSpread.length > 0}
                onClick={props.onGlanceOk}
              >
                {STRINGS.hpGlanceMatch}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div class="row mode-toggle" data-testid="mode-toggle" title={STRINGS.hpModeHint}>
              <button
                class={props.mode === "guided" ? "primary" : ""}
                data-testid="mode-guided"
                onClick={() => setModePref("guided")}
              >
                {STRINGS.hpModeGuided}
              </button>
              <button
                class={props.mode === "proposal" ? "primary" : ""}
                data-testid="mode-proposal"
                onClick={() => setModePref("proposal")}
              >
                {STRINGS.hpModeProposal}
              </button>
            </div>
            <CardPicker s={s} mode={props.mode} />
            {lastIsAge && (
              <button class="ghost" data-testid="btn-reopen" onClick={() => reopenLast()}>
                {STRINGS.hpReopen}
              </button>
            )}
          </>
        )}
      </section>
    );
  }

  // an age is open
  if (view?.kind === "question") {
    const q = view.question;
    return (
      <section class="card age-flow" data-testid="age-flow-question">
        <div class="age-header">
          <b>{CARD_NAMES[open.card.kind] ?? open.card.kind}</b>
          <span class="work">{open.card.work}</span>
          <a class="book-link" href={cardBookHash(open.card.kind)} data-testid="card-book-link">
            {STRINGS.hpBookLink}
          </a>
        </div>
        <EventLines events={view.events} testid="age-events" />
        {q.kind === "die" && <DieCard q={q} />}
        {q.kind === "chance" && <ChanceCard q={q} />}
        {q.kind === "pick" && <PickCard s={s} q={q} />}
        {open.script.some((r) => r.source !== "auto") && (
          <button class="ghost" data-testid="btn-undo" onClick={() => undo()}>
            {STRINGS.hpUndo}
          </button>
        )}
      </section>
    );
  }

  if (view?.kind === "closed") {
    const isProposal = open.proposal !== null && open.proposal.takeoverAt === null;
    return (
      <section class="card age-flow" data-testid="age-flow-closed">
        <div class="age-header">
          <b>{CARD_NAMES[open.card.kind] ?? open.card.kind}</b>
          <span class="work">{open.card.work}</span>
          <a class="book-link" href={cardBookHash(open.card.kind)}>
            {STRINGS.hpBookLink}
          </a>
        </div>
        <EventLines events={view.events} testid="age-events" />
        {isProposal ? (
          <ProposalCard s={s} />
        ) : (
          <>
            <p class="hint">{view.finished ? STRINGS.hpFinished : STRINGS.hpAgeClosed}</p>
            <div class="row">
              <button class="primary" data-testid="btn-commit" onClick={() => commitAge()}>
                {STRINGS.hpCommit}
              </button>
              {open.script.some((r) => r.source !== "auto") && (
                <button class="ghost" data-testid="btn-undo" onClick={() => undo()}>
                  {STRINGS.hpUndo}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    );
  }

  return null;
}
