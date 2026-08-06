// The browser glue of the scan pipeline: decode a photo, find (or default) a
// quad, rectify to the estimated true proportions, adjust, and encode WebP
// with a JPEG fallback. All picture math lives in geometry.ts / raster.ts /
// detect.ts (unit-tested pure code); this file only touches the DOM APIs.
import {
  defaultQuad,
  estimateAspect,
  rectifiedSize,
  type AspectMethod,
  type Quad,
} from "./geometry";
import { resize, warpPerspective, type Raster } from "./raster";

export type PipelineFailure = "decode" | "encode";

export class PipelineError extends Error {
  kind: PipelineFailure;
  constructor(kind: PipelineFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

// Decode a photographed file into an RGBA raster, bounded so a 12-megapixel
// photo does not become a 50 MB buffer: we only ever output ~1600 px, so
// decoding beyond ~2400 px buys nothing.
export async function decodeToRaster(file: Blob, maxEdge = 2400): Promise<Raster> {
  let source: ImageBitmap | HTMLImageElement;
  let w: number, h: number;
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file);
      source = bmp;
      w = bmp.width;
      h = bmp.height;
    } else {
      const img = await decodeViaImg(file);
      source = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
  } catch (e) {
    throw new PipelineError("decode", String(e));
  }
  if (!w || !h) throw new PipelineError("decode", "empty image");
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, cw, ch);
  if ("close" in source) source.close();
  return ctx.getImageData(0, 0, cw, ch);
}

function decodeViaImg(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

// Detection, lazily: the detector chunk loads on first use of the scan
// screen, never with the app shell. Any failure — including a failed chunk
// load — degrades to the default quad; the vertices are draggable either way.
export async function findQuad(src: Raster): Promise<{ quad: Quad; detected: boolean }> {
  try {
    const scale = Math.min(1, 384 / Math.max(src.width, src.height));
    const small =
      scale < 1
        ? resize(src, Math.round(src.width * scale), Math.round(src.height * scale))
        : src;
    const { detectQuad } = await import("./detect");
    const found = detectQuad(small);
    if (found) {
      const back = 1 / (scale < 1 ? scale : 1);
      return {
        quad: found.map((p) => ({ x: p.x * back, y: p.y * back })) as Quad,
        detected: true,
      };
    }
  } catch {
    // fall through to the default
  }
  return { quad: defaultQuad(src.width, src.height), detected: false };
}

// Rectify: the output proportions come from the photo itself (the scanner is
// units- and size-agnostic), the longest edge lands near 1600 px.
export interface Rectified {
  raster: Raster;
  ratio: number;
  method: AspectMethod;
}

export function rectify(src: Raster, quad: Quad): Rectified {
  const { ratio, method } = estimateAspect(quad, src.width, src.height);
  const { w, h } = rectifiedSize(quad, ratio);
  return { raster: warpPerspective(src, quad, w, h), ratio, method };
}

export function toImageData(r: Raster): ImageData {
  return new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
}

// IMPORT AS IS — for pictures that are already scans: digital mapmaking
// exports whose borders are the image borders. No corners, no
// rectification, no adjustment. Within limits the FILE ITSELF is stored,
// byte for byte; an oversized or exotic input still goes through the
// pipeline's downscale and encoding. Only the thumbnail is ever derived.
export const AS_IS_MAX_EDGE = 1600; // the downscale target when verbatim is off the table
// Verbatim reaches to the mobile canvas ceiling: a drawn export downscaled
// loses exactly the crispness the tester imported it for, so the file is
// kept untouched as far as devices can display it.
export const VERBATIM_MAX_EDGE = 4096;
const VERBATIM_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

export function verbatimPlan(width: number, height: number, mime: string): boolean {
  return Math.max(width, height) <= VERBATIM_MAX_EDGE && VERBATIM_MIMES.has(mime);
}

export async function importAsIs(file: Blob): Promise<Encoded & { verbatim: boolean }> {
  let w = 0;
  let h = 0;
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file);
      w = bmp.width;
      h = bmp.height;
      bmp.close();
    } else {
      const img = await decodeViaImg(file);
      w = img.naturalWidth;
      h = img.naturalHeight;
    }
  } catch (e) {
    throw new PipelineError("decode", String(e));
  }
  if (!w || !h) throw new PipelineError("decode", "empty image");
  if (verbatimPlan(w, h, file.type)) {
    const small = await decodeToRaster(file, 512);
    const { thumb } = await encodeScan(small);
    return { image: file, thumb, mime: file.type, width: w, height: h, verbatim: true };
  }
  const raster = await decodeToRaster(file, AS_IS_MAX_EDGE);
  const enc = await encodeScan(raster);
  return { ...enc, verbatim: false };
}

// Encode the canonical scan: WebP where the canvas can produce it, JPEG
// where it cannot (Safari), plus the atlas thumbnail.
export interface Encoded {
  image: Blob;
  thumb: Blob;
  mime: string;
  width: number;
  height: number;
}

// The compression review's ruling (measured on fixtures, numbers in the
// README): within LOSSY webp, raising quality from 0.82 toward 0.95 pays
// 2.4–3.6× the bytes and barely touches the visible artifacts — ink-stroke
// fringing and gradient banding come from chroma subsampling, not the
// quality knob. But content where that loss is VISIBLE — flat, drawn,
// digital — compresses losslessly at comparable size. So the encoder looks
// before it chooses: flat content goes lossless (webp q=1.0), photographs
// keep 0.82.
export const SCAN_QUALITY = {
  webpPhoto: 0.82,
  jpeg: 0.85,
  thumb: 0.7,
  flatForLossless: 0.3,
} as const;

// The fraction of pixels identical to their right neighbor: a drawn export
// is mostly flat runs, a photograph almost never is.
export function flatRatio(r: Raster): number {
  const { width: w, height: h, data } = r;
  let same = 0;
  let total = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (
        data[i] === data[i + 4] &&
        data[i + 1] === data[i + 5] &&
        data[i + 2] === data[i + 6]
      ) {
        same++;
      }
      total++;
    }
  }
  return total ? same / total : 0;
}

export async function encodeScan(r: Raster): Promise<Encoded> {
  let image: Blob;
  if (flatRatio(r) >= SCAN_QUALITY.flatForLossless) {
    // flat content: try lossless, keep it only while it stays affordable
    // (resampling can smear flatness and make lossless dear)
    const lossless = await encodeRaster(r, 1.0);
    if (lossless.type === "image/webp") {
      const lossy = await encodeRaster(r, SCAN_QUALITY.webpPhoto);
      image = lossless.size <= lossy.size * 2 ? lossless : lossy;
    } else {
      image = lossless; // jpeg fallback platform: no lossless exists
    }
  } else {
    image = await encodeRaster(r, SCAN_QUALITY.webpPhoto);
  }
  const scale = 256 / Math.max(r.width, r.height);
  const thumb =
    scale < 1
      ? await encodeRaster(
          resize(r, Math.max(1, Math.round(r.width * scale)), Math.max(1, Math.round(r.height * scale))),
          SCAN_QUALITY.thumb,
        )
      : image;
  return { image, thumb, mime: image.type, width: r.width, height: r.height };
}

async function encodeRaster(r: Raster, quality: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = r.width;
  canvas.height = r.height;
  canvas.getContext("2d")!.putImageData(toImageData(r), 0, 0);
  const webp = await toBlob(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await toBlob(canvas, "image/jpeg", SCAN_QUALITY.jpeg);
  if (jpeg && jpeg.type === "image/jpeg") return jpeg;
  throw new PipelineError("encode", "the canvas could not encode the scan");
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
