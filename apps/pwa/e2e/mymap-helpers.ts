// Shared machinery of the My map e2e suites: the synthetic fixture (a known
// rectangle projected through a pinhole camera onto a light wooden table
// under a shadow band) and the steps that walk a scan through the flow.
// This file holds no tests; both digitalizer specs import it.
import { expect, type Page } from "@playwright/test";

export const FIXTURE = {
  W: 500,
  H: 600,
  tiltX: 0.45,
  tiltY: 0.2,
  dist: 1000,
  f: 800,
  frameW: 1024,
  frameH: 768,
};

export interface FixtureOpts {
  W?: number;
  H?: number;
  paper?: string; // the sheet's color — versions can differ visibly
}

export interface Truth {
  dataUrl: string;
  corners: { x: number; y: number }[];
}

export async function makeFixture(page: Page, opts: FixtureOpts = {}): Promise<Truth> {
  return page.evaluate(
    (fx) => {
      const { W, H, tiltX, tiltY, dist, f, frameW, frameH, paper } = fx;
      const cx = frameW / 2, cy = frameH / 2;
      const corners3 = [
        [-W / 2, -H / 2, 0],
        [W / 2, -H / 2, 0],
        [W / 2, H / 2, 0],
        [-W / 2, H / 2, 0],
      ];
      const sx = Math.sin(tiltX), cxr = Math.cos(tiltX);
      const sy = Math.sin(tiltY), cyr = Math.cos(tiltY);
      const proj = ([X, Y, Z]: number[]) => {
        const y1 = cxr * Y - sx * Z, z1 = sx * Y + cxr * Z;
        const x2 = cyr * X + sy * z1, z2 = -sy * X + cyr * z1 + dist;
        return { x: (f * x2) / z2 + cx, y: (f * y1) / z2 + cy };
      };
      const quad = corners3.map(proj);
      const cv = document.createElement("canvas");
      cv.width = frameW;
      cv.height = frameH;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#ba9469"; // the light wooden table
      g.fillRect(0, 0, frameW, frameH);
      g.fillStyle = paper;
      g.beginPath();
      quad.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
      g.fill();
      const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
      g.strokeStyle = "#7a6f5c";
      g.lineWidth = 2;
      for (let k = 1; k < 5; k++) {
        const t = k / 5;
        const a = lerp(quad[0], quad[3], t), b = lerp(quad[1], quad[2], t);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        const a = lerp(quad[0], quad[1], t), b = lerp(quad[3], quad[2], t);
        g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
      }
      const shade = g.createLinearGradient(0, 0, frameW, frameH);
      shade.addColorStop(0, "rgba(0,0,0,0.30)");
      shade.addColorStop(0.5, "rgba(0,0,0,0.10)");
      shade.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = shade;
      g.fillRect(0, 0, frameW, frameH);
      return { dataUrl: cv.toDataURL("image/png"), corners: quad };
    },
    { ...FIXTURE, ...opts, paper: opts.paper ?? "#efe8d8" },
  );
}

export async function feedFixture(page: Page, t: Truth, name = "fixture.png"): Promise<void> {
  await page.setInputFiles('[data-testid="input-scan-gallery"]', {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(t.dataUrl.split(",")[1], "base64"),
  });
}

export const handlePos = async (page: Page, i: number) => {
  const h = page.getByTestId(`quad-handle-${i}`);
  return {
    x: Number(await h.getAttribute("data-x")),
    y: Number(await h.getAttribute("data-y")),
  };
};

// Walk one scan to the filing stage (crop → straighten → adjust → continue).
export async function scanToFile(page: Page, t: Truth): Promise<void> {
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
  await page.getByTestId("btn-to-file").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "file");
}

export async function saveScan(page: Page): Promise<void> {
  await page.getByTestId("btn-save-scan").click();
  await expect(page.getByTestId("scan-flow")).toHaveCount(0, { timeout: 20_000 });
}

// Scrub the timeline slider to an absolute epoch-ms value.
export async function scrubTo(page: Page, value: number | "min" | "max"): Promise<void> {
  await page.getByTestId("timeline-slider").evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const target =
      v === "min" ? input.min : v === "max" ? input.max : String(v);
    input.value = target;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
