// The scan flow: capture → corners → light → file. The vertices are always
// draggable; detection only proposes. The rectified proportions come from the
// photo itself (size-agnostic scanner), and every failure is a sentence on
// the screen, never a dead end.
import { useEffect, useRef, useState } from "preact/hooks";

import { STRINGS } from "../../strings";
import { panelName } from "../../contracts/geometry";
import { go } from "../../router";
import { orderQuad, rotateQuadCW, type Quad } from "../geometry";
import { autoLevels, applyLut, buildLut, resize, rotate90, type Raster } from "../raster";
import {
  decodeToRaster,
  encodeScan,
  findQuad,
  rectify,
  toImageData,
  PipelineError,
  type Rectified,
} from "../pipeline";
import { defaultCoord, stepCoord } from "../db";
import { presetCoord, saveScan, scans, storeDead, versionsOf } from "../store";
import { QuadEditor } from "./QuadEditor";

type Stage = "pick" | "crop" | "adjust" | "file";

// let the busy spinner paint before a long synchronous stretch
const breathe = () => new Promise((r) => setTimeout(r, 30));

export function ScanFlow() {
  const [stage, setStage] = useState<Stage>("pick");
  const [busy, setBusy] = useState(false);
  const [flowError, setFlowError] = useState("");
  const [quad, setQuad] = useState<Quad | null>(null);
  const [detected, setDetected] = useState(false);
  const [exposure, setExposure] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [coord, setCoord] = useState<{ tx: number; ty: number } | null>(null);
  const [note, setNote] = useState("");

  const src = useRef<Raster | null>(null);
  const rect = useRef<Rectified | null>(null);
  const levels = useRef({ lo: 0, hi: 255 });
  const preview = useRef<Raster | null>(null);
  const adjustCanvas = useRef<HTMLCanvasElement>(null);

  const onFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // the same photo can be picked again
    if (!file) return;
    setFlowError("");
    setBusy(true);
    try {
      src.current = await decodeToRaster(file);
      const found = await findQuad(src.current);
      setQuad(found.quad);
      setDetected(found.detected);
      setStage("crop");
    } catch (err) {
      setFlowError(
        err instanceof PipelineError && err.kind === "decode"
          ? STRINGS.mmDecodeFailed
          : String((err as Error)?.message ?? err),
      );
    } finally {
      setBusy(false);
    }
  };

  // repeatable quarter turn: the image rotates, the quad rides along
  const onRotate = () => {
    if (!src.current || !quad) return;
    const oldH = src.current.height;
    src.current = rotate90(src.current);
    setQuad(rotateQuadCW(quad, oldH));
  };

  const onStraighten = async () => {
    if (!src.current || !quad) return;
    setBusy(true);
    await breathe();
    try {
      rect.current = rectify(src.current, orderQuad(quad));
      levels.current = autoLevels(rect.current.raster);
      const r = rect.current.raster;
      const scale = Math.min(1, 480 / Math.max(r.width, r.height));
      preview.current =
        scale < 1
          ? resize(r, Math.round(r.width * scale), Math.round(r.height * scale))
          : r;
      setExposure(0);
      setContrast(0);
      setStage("adjust");
    } finally {
      setBusy(false);
    }
  };

  // live adjust preview
  useEffect(() => {
    if (stage !== "adjust" || !preview.current || !adjustCanvas.current) return;
    const lut = buildLut({ ...levels.current, exposure, contrast });
    const shown = applyLut(preview.current, lut);
    const cv = adjustCanvas.current;
    cv.width = shown.width;
    cv.height = shown.height;
    cv.getContext("2d")!.putImageData(toImageData(shown), 0, 0);
  }, [stage, exposure, contrast]);

  const onToFile = () => {
    setCoord(presetCoord.value ?? defaultCoord(scans.value));
    presetCoord.value = null;
    setStage("file");
  };

  const onSave = async () => {
    if (!rect.current || !coord) return;
    setBusy(true);
    await breathe();
    try {
      const lut = buildLut({ ...levels.current, exposure, contrast });
      const full = applyLut(rect.current.raster, lut);
      const enc = await encodeScan(full);
      const ok = await saveScan({ ...coord, note: note.trim(), ...enc });
      if (ok) go("#/map");
    } catch (err) {
      setFlowError(
        err instanceof PipelineError
          ? STRINGS.mmEncodeFailed
          : String((err as Error)?.message ?? err),
      );
    } finally {
      setBusy(false);
    }
  };

  const existing = coord ? versionsOf(coord.tx, coord.ty).length : 0;

  return (
    <div class="card scan-flow" data-testid="scan-flow" data-stage={stage}>
      {stage === "pick" && (
        <>
          <h2>{STRINGS.mmScanButton}</h2>
          <p class="note">{STRINGS.mmPickHint}</p>
          <div class="files-row">
            <label class="file-button primary-file">
              {STRINGS.mmCamera}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                data-testid="input-scan-camera"
                onChange={onFile}
              />
            </label>
            <label class="file-button">
              {STRINGS.mmGallery}
              <input
                type="file"
                accept="image/*"
                data-testid="input-scan-gallery"
                onChange={onFile}
              />
            </label>
          </div>
          {storeDead.value && <p class="note error">{STRINGS.mmNoStore}</p>}
        </>
      )}

      {stage === "crop" && src.current && quad && (
        <>
          <h2>{STRINGS.mmCropTitle}</h2>
          <p class="note" data-testid="detect-note">
            {detected ? STRINGS.mmDetected : STRINGS.mmNotDetected}
          </p>
          <QuadEditor raster={src.current} quad={quad} onChange={setQuad} />
          <div class="flow-buttons">
            <button data-testid="btn-crop-back" onClick={() => setStage("pick")}>
              {STRINGS.mmBack}
            </button>
            <button data-testid="btn-rotate" onClick={onRotate}>
              ⟳ {STRINGS.mmRotate}
            </button>
            <button class="primary" data-testid="btn-straighten" onClick={onStraighten}>
              {STRINGS.mmStraighten}
            </button>
          </div>
        </>
      )}

      {stage === "adjust" && rect.current && (
        <>
          <h2>{STRINGS.mmAdjustTitle}</h2>
          <canvas ref={adjustCanvas} class="adjust-canvas" data-testid="adjust-canvas" />
          <span
            data-testid="rect-facts"
            data-width={rect.current.raster.width}
            data-height={rect.current.raster.height}
            data-method={rect.current.method}
            hidden
          />
          <div class="field">
            <span>{STRINGS.mmExposure}</span>
            <input
              type="range"
              min={-100}
              max={100}
              value={exposure}
              data-testid="slider-exposure"
              onInput={(e) => setExposure(Number((e.currentTarget as HTMLInputElement).value))}
            />
          </div>
          <div class="field">
            <span>{STRINGS.mmContrast}</span>
            <input
              type="range"
              min={-100}
              max={100}
              value={contrast}
              data-testid="slider-contrast"
              onInput={(e) => setContrast(Number((e.currentTarget as HTMLInputElement).value))}
            />
          </div>
          <div class="flow-buttons">
            <button data-testid="btn-adjust-back" onClick={() => setStage("crop")}>
              {STRINGS.mmBack}
            </button>
            <button class="primary" data-testid="btn-to-file" onClick={onToFile}>
              {STRINGS.mmContinue}
            </button>
          </div>
        </>
      )}

      {stage === "file" && coord && (
        <>
          <h2>{STRINGS.mmFileTitle}</h2>
          <CoordPicker coord={coord} onChange={setCoord} />
          {existing > 0 && (
            <p class="note" data-testid="version-note">
              {STRINGS.mmAlreadyScanned.replace("{n}", String(existing))}
            </p>
          )}
          <div class="field">
            <span>{STRINGS.mmNote}</span>
            <input
              type="text"
              value={note}
              data-testid="input-scan-note"
              onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)}
            />
          </div>
          <div class="flow-buttons">
            <button data-testid="btn-file-back" onClick={() => setStage("adjust")}>
              {STRINGS.mmBack}
            </button>
            <button
              class="primary"
              data-testid="btn-save-scan"
              disabled={storeDead.value}
              onClick={onSave}
            >
              {STRINGS.mmSaveScan}
            </button>
          </div>
        </>
      )}

      {flowError && (
        <p class="note error" data-testid="flow-error" role="status">
          {flowError}
        </p>
      )}
      {busy && (
        <p class="note" data-testid="scan-busy" role="status">
          {STRINGS.mmWorking}
        </p>
      )}
    </div>
  );
}

function CoordPicker({
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
