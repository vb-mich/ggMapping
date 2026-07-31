// The numeric spinbox: a value with explicit up/down arrows, like the
// desktop tool's. Typing works too; values clamp to [min, max].
export function Spinner(props: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  testid?: string;
  incTestid?: string;
  decTestid?: string;
  label?: string; // aria label base for the arrows
  wide?: boolean;
}) {
  const clamp = (v: number) => Math.max(props.min, Math.min(props.max, v));
  const nudge = (d: number) => props.onChange(clamp(props.value + d));
  return (
    <span class="spin">
      <input
        type="text"
        inputMode="numeric"
        class={props.wide ? "wide" : undefined}
        value={props.value}
        data-testid={props.testid}
        onInput={(e) => {
          const n = parseInt((e.target as HTMLInputElement).value, 10);
          if (!Number.isNaN(n)) props.onChange(clamp(n));
        }}
      />
      <button class="spin-btn" aria-label={`${props.label ?? ""} +`}
        data-testid={props.incTestid} onClick={() => nudge(1)}>▲</button>
      <button class="spin-btn" aria-label={`${props.label ?? ""} -`}
        data-testid={props.decTestid} onClick={() => nudge(-1)}>▼</button>
    </span>
  );
}
