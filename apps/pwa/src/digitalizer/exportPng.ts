// The whole-map PNG: the atlas as one picture, honoring the timeline — the
// file is the map as it was at the selected moment. Geometry lives in
// stitch.ts (pure, unit-tested); this file only drives a canvas.
import { download } from "../ui/download";
import * as db from "./db";
import { containFit, stitchLayout } from "./stitch";

export interface PngExport {
  quality: "low" | "high";
  transparent: boolean;
  fileBase: string; // without extension
}

export interface PngExportResult {
  capped: boolean;
  width: number;
  height: number;
}

export async function exportMapPng(
  shown: db.ScanMeta[],
  opts: PngExport,
): Promise<PngExportResult> {
  if (!shown.length) throw new Error("empty");
  const items = shown.map((s) => ({ tx: s.tx, ty: s.ty, width: s.width, height: s.height }));
  // high: cells sized from the map's own scans (median height); low: thumbs
  const heights = items.map((s) => s.height).sort((a, b) => a - b);
  const baseCellH = opts.quality === "high" ? heights[heights.length >> 1] : 256;
  const layout = stitchLayout(items, baseCellH);

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const g = canvas.getContext("2d")!;
  if (!opts.transparent) {
    const bg =
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#171512";
    g.fillStyle = bg;
    g.fillRect(0, 0, layout.width, layout.height);
  }

  // tiled drawing: one scan at a time, decoded, drawn, released
  for (const s of shown) {
    const cell = layout.cells.get(`${s.tx},${s.ty}`)!;
    const blob = opts.quality === "high" ? (await db.getScan(s.id))?.image : s.thumb;
    if (!blob) continue;
    const bmp = await createImageBitmap(blob);
    const fit = containFit(bmp.width, bmp.height, cell);
    g.drawImage(bmp, fit.x, fit.y, fit.w, fit.h);
    bmp.close();
  }

  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!png) throw new Error("the canvas could not encode the export");
  download(`${opts.fileBase}.png`, png);
  return { capped: layout.capped, width: layout.width, height: layout.height };
}
