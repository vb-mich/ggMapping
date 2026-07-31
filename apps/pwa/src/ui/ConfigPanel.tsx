import { STRINGS } from "../strings";
import {
  archiveChance,
  eras,
  extendCap,
  grAdd,
  grDie,
  grMode,
  panelSize,
  percentToPermille,
  randomSeed,
  seed,
  strokeAdd,
  strokeDie,
} from "../state";

function NumberField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testid?: string;
  hint?: string;
}) {
  return (
    <label class="field">
      <span>{props.label}</span>
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        data-testid={props.testid}
        onInput={(e) => {
          const v = parseInt((e.target as HTMLInputElement).value, 10);
          if (!Number.isNaN(v)) props.onChange(Math.max(props.min, Math.min(props.max, v)));
        }}
      />
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function ConfigPanel() {
  const archiveBad = Number.isNaN(percentToPermille(archiveChance.value));
  return (
    <section class="card">
      <h2>{STRINGS.configTitle}</h2>
      <div class="field-row">
        <label class="field grow">
          <span>{STRINGS.seed}</span>
          <input
            type="number"
            min={1}
            max={9999999}
            value={seed.value}
            data-testid="input-seed"
            onInput={(e) => {
              const v = parseInt((e.target as HTMLInputElement).value, 10);
              if (!Number.isNaN(v)) seed.value = v;
            }}
          />
        </label>
        <button class="ghost" data-testid="btn-randomize" onClick={() => (seed.value = randomSeed())}>
          {STRINGS.randomize}
        </button>
      </div>
      <div class="field-row">
        <NumberField label={STRINGS.eras} value={eras.value} min={1} max={60}
          onChange={(v) => (eras.value = v)} testid="input-eras" />
        <label class="field">
          <span>{STRINGS.panelSize}</span>
          <select
            value={panelSize.value}
            data-testid="select-panel-size"
            onChange={(e) => (panelSize.value = (e.target as HTMLSelectElement).value as "5x6" | "8x10")}
          >
            <option value="5x6">{STRINGS.panelSizeMini}</option>
            <option value="8x10">{STRINGS.panelSizeFull}</option>
          </select>
        </label>
      </div>

      <h3>{STRINGS.dialsTitle}</h3>
      <div class="field-row">
        <label class={`field ${archiveBad ? "invalid" : ""}`}>
          <span>{STRINGS.archiveChance}</span>
          <input
            type="text"
            inputMode="decimal"
            value={archiveChance.value}
            data-testid="input-archive-chance"
            onInput={(e) => (archiveChance.value = (e.target as HTMLInputElement).value)}
          />
        </label>
        <NumberField label={STRINGS.extendCap} value={extendCap.value} min={0} max={20}
          onChange={(v) => (extendCap.value = v)} hint={STRINGS.extendCapHint} />
      </div>
      <div class="field-row">
        <NumberField label={STRINGS.strokeDie} value={strokeDie.value} min={2} max={20}
          onChange={(v) => (strokeDie.value = v)} />
        <NumberField label={STRINGS.strokeAdd} value={strokeAdd.value} min={0} max={10}
          onChange={(v) => (strokeAdd.value = v)} />
      </div>
      <div class="field-row">
        <label class="field">
          <span>{STRINGS.greatridgeMode}</span>
          <select
            value={grMode.value}
            data-testid="select-gr-mode"
            onChange={(e) => (grMode.value = (e.target as HTMLSelectElement).value as "choice" | "rolled")}
          >
            <option value="choice">{STRINGS.greatridgeChoice}</option>
            <option value="rolled">{STRINGS.greatridgeRolled}</option>
          </select>
        </label>
        {grMode.value === "rolled" && (
          <>
            <NumberField label={STRINGS.greatridgeDie} value={grDie.value} min={2} max={20}
              onChange={(v) => (grDie.value = v)} />
            <NumberField label={STRINGS.greatridgeAdd} value={grAdd.value} min={0} max={10}
              onChange={(v) => (grAdd.value = v)} />
          </>
        )}
      </div>
    </section>
  );
}
