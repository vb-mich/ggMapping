// The blur lab: it drives the REAL digitalizer modules in a browser and
// writes numbers and goldens to disk, so a fresh clone can reproduce both.
//
// Run the dev server first (npm run dev), then from apps/pwa:
//   node tests/tools/blur-lab.mjs goldens     write auto-fix goldens and hashes
//   node tests/tools/blur-lab.mjs measure     write the round-trip table
//   node tests/tools/blur-lab.mjs determinism auto-fix twice, compare
//
// Output lands in tests/goldens/autofix-sandy-r3/ and tests/reports/.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const HERE = dirname(fileURLToPath(import.meta.url));
const PWA = join(HERE, "..", "..");
const GOLDENS = join(PWA, "tests", "goldens", "autofix-sandy-r3");
const REPORTS = join(PWA, "tests", "reports");
const BASE = process.env.JM_DEV || "http://localhost:5173";

// one representative panel per map keeps the goldens small; every scan still
// gets a hash, so determinism is checked across the whole donated set
const REPRESENTATIVE = {
  "My first map": "0032eff7-4d00-4660-a173-e4ba442a3a95.jpg",
  "Second map - whiteboard": "daaf3324-4377-4876-99f2-78a3b328d5cf.jpg",
  "Player handbook map": "36bad3fc-8083-44c3-aedd-ccfa36d92b8a.jpg",
};

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + "/#/map", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.addScriptTag({
    type: "module",
    content: `
      const P = await import("/src/digitalizer/pipeline.ts");
      const R = await import("/src/digitalizer/raster.ts");
      const G = await import("/src/digitalizer/geometry.ts");
      window.__mods = { P, R, G };
      window.__ready = true;
    `,
  });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await page.addScriptTag({ content: HELPERS });
  try {
    return await fn(page);
  } finally {
    if (errors.length) console.error("page errors:", errors.slice(0, 3));
    await browser.close();
  }
}

// installed into the page: decoding, metrics, and the auto-fix run
const HELPERS = `
window.__fetchFile = async (name) => {
  const b = await (await fetch("/tests/fixtures/sandy-r3/scans/" + name)).blob();
  return new File([b], name, { type: "image/jpeg" });
};
window.__toRaster = async (blob, maxEdge) => {
  const bmp = await createImageBitmap(blob);
  const s = maxEdge ? Math.min(1, maxEdge / Math.max(bmp.width, bmp.height)) : 1;
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return g.getImageData(0, 0, w, h);
};
window.__resampleTo = (img, w, h) => {
  const a = document.createElement("canvas");
  a.width = img.width; a.height = img.height;
  a.getContext("2d").putImageData(img, 0, 0);
  const b = document.createElement("canvas");
  b.width = w; b.height = h;
  const g = b.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(a, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
};
window.__luma = (img) => {
  const n = img.width * img.height, y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    y[i] = 0.299 * img.data[j] + 0.587 * img.data[j+1] + 0.114 * img.data[j+2];
  }
  return { y, w: img.width, h: img.height };
};
window.__ssim = (A, B) => {
  if (A.w !== B.w || A.h !== B.h) return null;
  const C1 = (0.01*255)**2, C2 = (0.03*255)**2, win = 8, stride = 4;
  let tot = 0, cnt = 0;
  for (let y0 = 0; y0 + win <= A.h; y0 += stride) {
    for (let x0 = 0; x0 + win <= A.w; x0 += stride) {
      let ma = 0, mb = 0;
      for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) {
        const i = (y0+y)*A.w + (x0+x); ma += A.y[i]; mb += B.y[i];
      }
      const n = win*win; ma /= n; mb /= n;
      let va = 0, vb = 0, cov = 0;
      for (let y = 0; y < win; y++) for (let x = 0; x < win; x++) {
        const i = (y0+y)*A.w + (x0+x);
        const da = A.y[i]-ma, db = B.y[i]-mb;
        va += da*da; vb += db*db; cov += da*db;
      }
      va /= n-1; vb /= n-1; cov /= n-1;
      tot += ((2*ma*mb + C1)*(2*cov + C2)) / ((ma*ma + mb*mb + C1)*(va + vb + C2));
      cnt++;
    }
  }
  return cnt ? tot/cnt : null;
};
window.__lapVar = (L) => {
  const { y, w, h } = L;
  let s = 0, s2 = 0, n = 0;
  for (let j = 1; j < h-1; j++) for (let i = 1; i < w-1; i++) {
    const k = j*w + i;
    const v = y[k-w] + y[k+w] + y[k-1] + y[k+1] - 4*y[k];
    s += v; s2 += v*v; n++;
  }
  return s2/n - (s/n)*(s/n);
};
window.__sha256 = async (bytes) => {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2,"0")).join("");
};
// auto-fix over a stored scan, returned as raw RGBA plus a hash
window.__autofix = async (name) => {
  const file = await window.__fetchFile(name);
  const img = await window.__toRaster(file);
  const raster = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const fixed = window.__mods.R.autoFix(raster);
  const hash = await window.__sha256(fixed.data);
  return { w: fixed.width, h: fixed.height, hash };
};
window.__autofixPng = async (name) => {
  const file = await window.__fetchFile(name);
  const img = await window.__toRaster(file);
  const raster = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const fixed = window.__mods.R.autoFix(raster);
  const cv = document.createElement("canvas");
  cv.width = fixed.width; cv.height = fixed.height;
  cv.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(fixed.data), fixed.width, fixed.height), 0, 0);
  const blob = await new Promise(r => cv.toBlob(r, "image/png"));
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { base64: btoa(String.fromCharCode(...buf.subarray(0, 0))) , size: buf.length,
           chunks: null, dataUrl: cv.toDataURL("image/png") };
};
window.__manifest = async () =>
  await (await fetch("/tests/fixtures/sandy-r3/manifest.json")).json();
`;

const scansOf = (man) =>
  man.scans.map((s) => ({
    file: s.imageEntry.replace("scans/", ""),
    map: man.maps.find((m) => m.id === s.mapId).name,
    panel: `${s.tx},${s.ty}`,
  }));

async function goldens() {
  mkdirSync(GOLDENS, { recursive: true });
  await withPage(async (page) => {
    const man = await page.evaluate(() => window.__manifest());
    const list = scansOf(man);
    // hashes for the whole set
    const hashes = {};
    for (const rec of list) {
      const r = await page.evaluate((n) => window.__autofix(n), rec.file);
      hashes[rec.file] = { map: rec.map, panel: rec.panel, w: r.w, h: r.h, sha256: r.hash };
      process.stdout.write(".");
    }
    writeFileSync(join(GOLDENS, "hashes.json"), JSON.stringify(hashes, null, 1) + "\n");
    // one picture per map
    for (const [map, file] of Object.entries(REPRESENTATIVE)) {
      const r = await page.evaluate((n) => window.__autofixPng(n), file);
      const b64 = r.dataUrl.split(",")[1];
      const name = map.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".png";
      writeFileSync(join(GOLDENS, name), Buffer.from(b64, "base64"));
      console.log(`\ngolden ${name} <- ${file}`);
    }
    console.log(`hashes for ${Object.keys(hashes).length} scans`);
  });
}

async function determinism() {
  await withPage(async (page) => {
    const man = await page.evaluate(() => window.__manifest());
    const list = scansOf(man);
    let same = 0;
    const differing = [];
    for (const rec of list) {
      const a = await page.evaluate((n) => window.__autofix(n), rec.file);
      const b = await page.evaluate((n) => window.__autofix(n), rec.file);
      if (a.hash === b.hash) same++;
      else differing.push(rec.file);
    }
    console.log(`auto-fix determinism: ${same}/${list.length} identical on a second run`);
    if (differing.length) console.log("differing:", differing.join(", "));
    // and against the recorded goldens, when they exist
    const hp = join(GOLDENS, "hashes.json");
    if (existsSync(hp)) {
      const golden = JSON.parse(readFileSync(hp, "utf8"));
      let match = 0;
      const drift = [];
      for (const rec of list) {
        const r = await page.evaluate((n) => window.__autofix(n), rec.file);
        if (golden[rec.file] && golden[rec.file].sha256 === r.hash) match++;
        else drift.push(rec.file);
      }
      console.log(`against goldens: ${match}/${list.length} unchanged`);
      if (drift.length) console.log("drifted:", drift.slice(0, 6).join(", "));
    }
  });
}

async function measure() {
  mkdirSync(REPORTS, { recursive: true });
  const rows = await withPage(async (page) => {
    const man = await page.evaluate(() => window.__manifest());
    const list = scansOf(man);
    const out = [];
    for (const rec of list) {
      const r = await page.evaluate(async (name) => {
        const { P, G } = window.__mods;
        const file = await window.__fetchFile(name);
        const inImg = await window.__toRaster(file);
        const inL = window.__luma(inImg);
        // PATH A: the digital-file upload path, import as is
        const a = await P.importAsIs(file);
        let aSsim = 1, aLap = window.__lapVar(inL);
        if (a.image !== file) {
          const aImg = await window.__toRaster(a.image);
          const aL = window.__luma(aImg);
          aSsim = window.__ssim(inL, aL);
          aLap = window.__lapVar(aL);
        }
        // PATH B: crop and straighten with the quad on the image's corners
        const src = await P.decodeToRaster(file);
        const quad = G.orderQuad([
          { x: 0, y: 0 }, { x: src.width, y: 0 },
          { x: src.width, y: src.height }, { x: 0, y: src.height },
        ]);
        const rect = P.rectify(src, quad);
        const enc = await P.encodeScan(rect.raster);
        const bImg = await window.__toRaster(enc.image);
        const bL = window.__luma(bImg);
        const refB = window.__luma(window.__resampleTo(inImg, bImg.width, bImg.height));
        return {
          inW: inImg.width, inH: inImg.height, inKB: +(file.size / 1024).toFixed(1),
          inLap: +window.__lapVar(inL).toFixed(0),
          aVerbatim: a.verbatim, aKB: +(a.image.size / 1024).toFixed(1),
          aSsim: +aSsim.toFixed(4), aLap: +aLap.toFixed(0),
          bW: bImg.width, bH: bImg.height, bMime: enc.mime,
          bKB: +(enc.image.size / 1024).toFixed(1),
          bSsim: +window.__ssim(refB, bL).toFixed(4), bLap: +window.__lapVar(bL).toFixed(0),
          bFlat: +P.flatRatio(rect.raster).toFixed(3),
        };
      }, rec.file);
      out.push({ ...rec, ...r });
      process.stdout.write(".");
    }
    return out;
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const path = join(REPORTS, `round-trip-${stamp}.json`);
  writeFileSync(path, JSON.stringify(rows, null, 1) + "\n");
  console.log(`\nwrote ${path}`);
  // per map summary
  const maps = [...new Set(rows.map((r) => r.map))];
  for (const m of maps) {
    const g = rows.filter((r) => r.map === m);
    const avg = (k) => +(g.reduce((s, r) => s + r[k], 0) / g.length).toFixed(4);
    console.log(
      `${m}: n=${g.length} verbatim=${g.filter((r) => r.aVerbatim).length}/${g.length}` +
      ` A_ssim=${avg("aSsim")} A_kb=${avg("aKB")}` +
      ` B_ssim=${avg("bSsim")} B_kb=${avg("bKB")}` +
      ` in_kb=${avg("inKB")} in_lap=${avg("inLap")} B_lap=${avg("bLap")}`,
    );
  }
}

// The perceptual half of the acceptance: the same panel at the same zoom,
// before and after, on a phone-sized viewport.
async function shots(label) {
  mkdirSync(REPORTS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 3, // a real phone's pixel ratio, where the blur shows
  });
  await page.goto(BASE + "/#/map", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  // a fresh map holding one of the tester's panels
  await page.evaluate(async () => {
    const db = await import("/src/digitalizer/db.ts");
    const man = await (await fetch("/tests/fixtures/sandy-r3/manifest.json")).json();
    const rec = man.scans.find(
      (s) => s.imageEntry.includes("0032eff7"),
    );
    const map = await db.createMap("Blur shot " + Math.random().toString(36).slice(2, 7));
    const image = await (await fetch("/" + "tests/fixtures/sandy-r3/" + rec.imageEntry)).blob();
    const thumb = await (await fetch("/" + "tests/fixtures/sandy-r3/" + rec.thumbEntry)).blob();
    await db.addScan({
      mapId: map.id, tx: rec.tx, ty: rec.ty, note: "", mime: "image/jpeg",
      width: rec.width, height: rec.height, image, thumb,
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".atlas-cell img", { timeout: 15000 });
  await page.waitForTimeout(400);
  // zoom to about 2x with the wheel, the same way a finger pinches
  const box = await page.locator('[data-testid="atlas"]').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -120); // 1.15^5 = 2.01
  await page.waitForTimeout(300);
  // drag the panel into the middle so both shots frame the same thing
  const cellBox = await page.locator(".atlas-cell").first().boundingBox();
  const dx = cx - (cellBox.x + cellBox.width / 2);
  const dy = cy - (cellBox.y + cellBox.height / 2);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 5 });
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1500); // let any full-resolution swap land
  const info = await page.evaluate(() => {
    const im = document.querySelector(".atlas-cell img");
    const r = im.getBoundingClientRect();
    const plane = document.querySelector(".atlas-plane");
    return {
      source: `${im.naturalWidth}x${im.naturalHeight}`,
      cssBox: `${Math.round(r.width)}x${Math.round(r.height)}`,
      devicePx: `${Math.round(r.width * devicePixelRatio)}x${Math.round(r.height * devicePixelRatio)}`,
      upscale: +(r.width * devicePixelRatio / im.naturalWidth).toFixed(2),
      transform: plane.style.transform,
      dpr: devicePixelRatio,
    };
  });
  await page.locator('[data-testid="atlas"]').screenshot({
    path: join(REPORTS, `atlas-zoom-${label}.png`),
  });
  console.log(`${label}:`, JSON.stringify(info));
  await browser.close();
}

const cmd = process.argv[2];
if (cmd === "goldens") await goldens();
else if (cmd === "measure") await measure();
else if (cmd === "determinism") await determinism();
else if (cmd === "shots") await shots(process.argv[3] || "after");
else {
  console.log("usage: node tests/tools/blur-lab.mjs goldens|measure|determinism|shots <label>");
  process.exit(1);
}
