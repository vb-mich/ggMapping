// The Experimental group (CONTRACTS §11, handbook chapter 11): rules under
// test, NOT part of the game. Deliberately set apart from the dials — its own
// card, its own accent, and a standing warning above the switches.
import { STRINGS } from "../strings";
import { expFields } from "../state";

export function ExperimentalPanel() {
  return (
    <section class="card experimental" data-testid="experimental-panel">
      <div class="exp-head">
        <h2>{STRINGS.expTitle}</h2>
        <span class="chip exp-chip">{STRINGS.expBadge}</span>
      </div>
      <p class="exp-warning">{STRINGS.expNotGame}</p>
      <label class="toggle exp-switch">
        <input
          type="checkbox"
          checked={expFields.value}
          data-testid="toggle-exp-fields"
          onChange={(e) =>
            (expFields.value = (e.target as HTMLInputElement).checked)
          }
        />
        <b>{STRINGS.expFieldsLabel}</b>
      </label>
      <p class="note exp-desc">{STRINGS.expFieldsDesc}</p>
    </section>
  );
}
