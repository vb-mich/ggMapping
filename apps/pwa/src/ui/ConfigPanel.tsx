// Run setup. Labels turn bold dark-orange when a parameter leaves canon
// (the handbook's defaults), like the desktop tool.
import { STRINGS } from "../strings";
import {
  archiveChance,
  eras,
  extendCap,
  grAdd,
  grDie,
  grMode,
  panelSize,
  customW,
  customH,
  maxPanels,
  percentToPermille,
  randomSeed,
  seed,
  strokeAdd,
  strokeDie,
} from "../state";
import { Spinner } from "./Spinner";

function SpinField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testid?: string;
  hint?: string;
  offCanon?: boolean;
  wide?: boolean;
  tip?: string;
}) {
  return (
    <label class={`field ${props.offCanon ? "off-canon" : ""}`}>
      <span data-tip={props.tip}>{props.label}</span>
      <Spinner value={props.value} min={props.min} max={props.max}
        onChange={props.onChange} testid={props.testid} label={props.label}
        wide={props.wide} />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function ConfigPanel() {
  const permille = percentToPermille(archiveChance.value);
  const archiveBad = Number.isNaN(permille);
  const grRolled = grMode.value === "rolled";
  return (
    <section class="card">
      <h2>{STRINGS.configTitle}</h2>
      <div class="field-row">
        <SpinField label={STRINGS.seed} value={seed.value} min={1} max={9999999}
          onChange={(v) => (seed.value = v)} testid="input-seed" wide
          tip={STRINGS.tipSeed} />
        <button class="ghost" data-testid="btn-randomize" onClick={() => (seed.value = randomSeed())}>
          {STRINGS.randomize}
        </button>
      </div>
      <div class="field-row">
        <SpinField label={STRINGS.eras} value={eras.value} min={1} max={500}
          onChange={(v) => (eras.value = v)} testid="input-eras"
          tip={STRINGS.tipEras} />
        <label class={`field ${panelSize.value !== "5x6" ? "off-canon" : ""}`}>
          <span data-tip={STRINGS.tipPanelSize}>{STRINGS.panelSize}</span>
          <select
            value={panelSize.value}
            data-testid="select-panel-size"
            onChange={(e) =>
              (panelSize.value = (e.target as HTMLSelectElement)
                .value as "5x6" | "8x10" | "custom")
            }
          >
            <option value="5x6">{STRINGS.panelSizeMini}</option>
            <option value="8x10">{STRINGS.panelSizeFull}</option>
            <option value="custom">{STRINGS.panelSizeCustom}</option>
          </select>
        </label>
      </div>
      {panelSize.value === "custom" && (
        <div class="field-row">
          <SpinField label={STRINGS.customW} value={customW.value} min={2} max={12}
            onChange={(v) => (customW.value = v)} testid="input-custom-w"
            tip={STRINGS.tipPanelSize} />
          <SpinField label={STRINGS.customH} value={customH.value} min={2} max={12}
            onChange={(v) => (customH.value = v)} testid="input-custom-h"
            tip={STRINGS.tipPanelSize} />
        </div>
      )}

      <h3>{STRINGS.dialsTitle}</h3>
      <div class="field-row">
        <label class={`field ${archiveBad ? "invalid" : ""} ${permille > 0 ? "off-canon" : ""}`}>
          <span data-tip={STRINGS.tipArchiveChance}>{STRINGS.archiveChance}</span>
          <input
            type="text"
            inputMode="decimal"
            value={archiveChance.value}
            data-testid="input-archive-chance"
            onInput={(e) => (archiveChance.value = (e.target as HTMLInputElement).value)}
          />
        </label>
        <SpinField label={STRINGS.extendCap} value={extendCap.value} min={0} max={20}
          onChange={(v) => (extendCap.value = v)} hint={STRINGS.extendCapHint}
          offCanon={extendCap.value !== 4} tip={STRINGS.tipExtendCap} />
        <SpinField label={STRINGS.mapCap} value={maxPanels.value} min={0} max={1000}
          onChange={(v) => (maxPanels.value = v)} hint={STRINGS.mapCapHint}
          offCanon={maxPanels.value !== 0} tip={STRINGS.tipMapCap}
          testid="input-max-panels" />
      </div>
      <div class="field-row">
        <SpinField label={STRINGS.strokeDie} value={strokeDie.value} min={2} max={20}
          onChange={(v) => (strokeDie.value = v)} offCanon={strokeDie.value !== 4}
          tip={STRINGS.tipStrokeDie} />
        <SpinField label={STRINGS.strokeAdd} value={strokeAdd.value} min={0} max={10}
          onChange={(v) => (strokeAdd.value = v)} offCanon={strokeAdd.value !== 1}
          tip={STRINGS.tipStrokeAdd} />
      </div>
      <div class="field-row">
        <label class={`field ${grRolled ? "off-canon" : ""}`}>
          <span data-tip={STRINGS.tipGreatridgeMode}>{STRINGS.greatridgeMode}</span>
          <select
            value={grMode.value}
            data-testid="select-gr-mode"
            onChange={(e) => (grMode.value = (e.target as HTMLSelectElement).value as "choice" | "rolled")}
          >
            <option value="choice">{STRINGS.greatridgeChoice}</option>
            <option value="rolled">{STRINGS.greatridgeRolled}</option>
          </select>
        </label>
        {grRolled && (
          <>
            <SpinField label={STRINGS.greatridgeDie} value={grDie.value} min={2} max={20}
              onChange={(v) => (grDie.value = v)} offCanon tip={STRINGS.tipGreatridgeDie} />
            <SpinField label={STRINGS.greatridgeAdd} value={grAdd.value} min={0} max={10}
              onChange={(v) => (grAdd.value = v)} offCanon tip={STRINGS.tipGreatridgeAdd} />
          </>
        )}
      </div>
    </section>
  );
}
