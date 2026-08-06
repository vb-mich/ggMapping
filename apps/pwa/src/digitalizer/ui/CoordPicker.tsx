// The coordinate picker: two steppers over the map convention's nonzero
// grid, the resulting panel name writ large. Shared by the scan flow's
// filing stage and the panel detail's move flow.
import { panelName } from "../../contracts/geometry";
import { stepCoord } from "../db";

export function CoordPicker({
  coord,
  onChange,
}: {
  coord: { tx: number; ty: number };
  onChange: (c: { tx: number; ty: number }) => void;
}) {
  const { tx, ty } = coord;
  const ns = ty > 0 ? `N${ty}` : `S${-ty}`;
  const ew = tx > 0 ? `E${tx}` : `W${-tx}`;
  return (
    <div class="coord-picker" data-testid="coord-picker" data-tx={tx} data-ty={ty}>
      <div class="coord-name" data-testid="coord-name">
        {panelName(tx, ty)}
      </div>
      <div class="coord-axes">
        <span class="spin">
          <button
            class="spin-btn"
            data-testid="coord-n-down"
            onClick={() => onChange({ tx, ty: stepCoord(ty, -1) })}
          >
            ▼
          </button>
          <b>{ns}</b>
          <button
            class="spin-btn"
            data-testid="coord-n-up"
            onClick={() => onChange({ tx, ty: stepCoord(ty, 1) })}
          >
            ▲
          </button>
        </span>
        <span class="spin">
          <button
            class="spin-btn"
            data-testid="coord-e-down"
            onClick={() => onChange({ tx: stepCoord(tx, -1), ty })}
          >
            ◀
          </button>
          <b>{ew}</b>
          <button
            class="spin-btn"
            data-testid="coord-e-up"
            onClick={() => onChange({ tx: stepCoord(tx, 1), ty })}
          >
            ▶
          </button>
        </span>
      </div>
    </div>
  );
}
