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

// Encode the canonical scan: WebP where the canvas can produce it, JPEG
// where it cannot (Safari), plus the atlas thumbnail.
export interface Encoded {
  image: Blob;
  thumb: Blob;
  mime: string;
  width: number;
  height: number;
}

export async function encodeScan(r: Raster): Promise<Encoded> {
  const image = await encodeRaster(r, 0.82);
  const scale = 256 / Math.max(r.width, r.height);
  const thumb =
    scale < 1
      ? await encodeRaster(
          resize(r, Math.max(1, Math.round(r.width * scale)), Math.max(1, Math.round(r.height * scale))),
          0.7,
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
  const jpeg = await toBlob(canvas, "image/jpeg", Math.min(1, quality + 0.03));
  if (jpeg && jpeg.type === "image/jpeg") return jpeg;
  throw new PipelineError("encode", "the canvas could not encode the scan");
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
