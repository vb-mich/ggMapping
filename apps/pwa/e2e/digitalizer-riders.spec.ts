// Act 1.6, the tester's four riders, end to end: import-as-is stores the
// file byte for byte; the temperature slider round-trips into the saved
// scan; a panel's whole history re-tags to another coordinate (an occupied
// target asks before histories merge); and the encoder keeps drawn content
// lossless through the pipeline.
import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { STRINGS } from "../src/strings";
import { feedFixture, makeFixture, saveScan, scanToFile } from "./mymap-helpers";

// a small drawn PNG made in-page; returns its bytes for byte-comparison
async function drawnPng(page: Page, w: number, h: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ w, h }) => {
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#e8f0e2";
      g.fillRect(0, 0, w, h);
      g.strokeStyle = "#20469b";
      g.lineWidth = 4;
      for (let k = 1; k < 6; k++) {
        g.beginPath();
        g.moveTo(0, (h / 6) * k);
        g.lineTo(w, (h / 6) * k - 12);
        g.stroke();
      }
      g.fillStyle = "#1a3fbf";
      g.fillRect(w / 2 - 60, h / 2 - 60, 120, 120);
      return cv.toDataURL("image/png");
    },
    { w, h },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

const sha256OfStored = (page: Page) =>
  page.evaluate(async () => {
    const open = indexedDB.open("jm-digitalizer");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const scans = await new Promise<{ created: number; mime: string; image: Blob; width: number; height: number; bytes: number }[]>(
      (res, rej) => {
        const r = db.transaction("scans", "readonly").objectStore("scans").getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      },
    );
    db.close();
    const newest = scans.sort((a, b) => b.created - a.created)[0];
    const digest = await crypto.subtle.digest("SHA-256", await newest.image.arrayBuffer());
    return {
      sha: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""),
      mime: newest.mime,
      width: newest.width,
      height: newest.height,
      bytes: newest.bytes,
    };
  });

test("import as is: the file is the scan, byte for byte", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await page.getByTestId("toggle-as-is").check();
  await expect(page.getByText(STRINGS.mmImportAsIsHint)).toBeVisible();
  if (test.info().project.name === "mobile") {
    await page.screenshot({ path: "e2e-artifacts/rider-as-is.png" });
  }

  // the tester's real case: a mapmaking export larger than the photo cap,
  // whose borders are already the image borders
  const png = await drawnPng(page, 2000, 2400);
  await page.setInputFiles('[data-testid="input-scan-gallery"]', {
    name: "export.png",
    mimeType: "image/png",
    buffer: png,
  });
  // no corners, no light: straight to the filing stage
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "file", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E1");
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();

  const stored = await sha256OfStored(page);
  const wanted = createHash("sha256").update(png).digest("hex");
  expect(stored.sha).toBe(wanted); // byte-identical: nothing touched it
  expect(stored.mime).toBe("image/png");
  expect(stored.width).toBe(2000);
  expect(stored.height).toBe(2400);
});

test("the temperature slider round-trips into the saved scan", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });

  await expect(page.getByTestId("temperature-value")).toHaveText("0");
  const shot = () =>
    page.getByTestId("adjust-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const before = await shot();
  await page.getByTestId("slider-temperature").fill("-100");
  await expect(page.getByTestId("temperature-value")).toHaveText("-100");
  await expect.poll(shot).not.toBe(before);
  if (test.info().project.name === "mobile") {
    await page.screenshot({ path: "e2e-artifacts/rider-temperature.png" });
  }
  await page.getByTestId("slider-temperature").fill("0");
  await expect(page.getByTestId("temperature-value")).toHaveText("0");
  await page.getByTestId("slider-temperature").fill("-100");

  await page.getByTestId("btn-to-file").click();
  await saveScan(page);

  // the stored pixels went cool: blue above red on a fixture that is warm
  const means = await page.evaluate(async () => {
    const open = indexedDB.open("jm-digitalizer");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const scans = await new Promise<{ created: number; image: Blob }[]>((res, rej) => {
      const r = db.transaction("scans", "readonly").objectStore("scans").getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    const newest = scans.sort((a, b) => b.created - a.created)[0];
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = URL.createObjectURL(newest.image);
    });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let r = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 40) {
      r += d[i];
      b += d[i + 2];
      n++;
    }
    return { r: r / n, b: b / n };
  });
  expect(means.b).toBeGreaterThan(means.r); // cooled past the paper's warmth
});

test("auto-fix gives the scanner look and the toggle undoes it", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  // the helpers' fixture already wears a warm paper, wood, and a shade band
  const t = await makeFixture(page);
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });

  const paper = () =>
    page.getByTestId("adjust-canvas").evaluate((c) => {
      const cv = c as HTMLCanvasElement;
      const g = cv.getContext("2d")!;
      const grab = (fx: number, fy: number) => {
        const d = g.getImageData(
          Math.round(cv.width * fx),
          Math.round(cv.height * fy),
          6,
          6,
        ).data;
        const m = [0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          m[0] += d[i];
          m[1] += d[i + 1];
          m[2] += d[i + 2];
        }
        return m.map((v) => v / 36);
      };
      return { a: grab(0.3, 0.2), b: grab(0.7, 0.8) };
    });

  const before = await paper();
  await page.getByTestId("btn-auto-fix").click();
  await expect(page.getByTestId("btn-auto-fix")).toHaveClass(/active/, { timeout: 20_000 });
  // the canvas repaints asynchronously after the toggle: poll for the look
  await expect
    .poll(async () => {
      const p = await paper();
      return Math.min(...p.a, ...p.b);
    }, { timeout: 15_000 })
    .toBeGreaterThan(210);
  const after = await paper();
  // bright, neutral, and uniform — in both corners of the sheet
  for (const p of [after.a, after.b]) {
    expect(Math.min(...p)).toBeGreaterThan(210);
    expect(Math.max(...p) - Math.min(...p)).toBeLessThan(14);
  }
  // and it genuinely changed something the warm original could not show
  expect(Math.max(...before.a) - Math.min(...before.a)).toBeGreaterThan(14);

  // off again: the original returns — polled, same reason
  await page.getByTestId("btn-auto-fix").click();
  await expect(page.getByTestId("btn-auto-fix")).not.toHaveClass(/active/);
  await expect
    .poll(async () => Math.round((await paper()).a[0]), { timeout: 15_000 })
    .toBe(Math.round(before.a[0]));

  // save WITH the fix: the stored scan carries the scanner look
  await page.getByTestId("btn-auto-fix").click();
  await expect(page.getByTestId("btn-auto-fix")).toHaveClass(/active/);
  if (test.info().project.name === "mobile") {
    await page.screenshot({ path: "e2e-artifacts/rider-auto-fix.png" });
  }
  await page.getByTestId("btn-to-file").click();
  await saveScan(page);
  const stored = await page.evaluate(async () => {
    const open = indexedDB.open("jm-digitalizer");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const scans = await new Promise<{ created: number; image: Blob }[]>((res, rej) => {
      const r = db.transaction("scans", "readonly").objectStore("scans").getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    const newest = scans.sort((a, b) => b.created - a.created)[0];
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = URL.createObjectURL(newest.image);
    });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth;
    cv.height = img.naturalHeight;
    const g = cv.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(
      Math.round(cv.width * 0.3),
      Math.round(cv.height * 0.2),
      8,
      8,
    ).data;
    const m = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      m[0] += d[i];
      m[1] += d[i + 1];
      m[2] += d[i + 2];
    }
    return m.map((v) => v / 64);
  });
  expect(Math.min(...stored)).toBeGreaterThan(200);
  expect(Math.max(...stored) - Math.min(...stored)).toBeLessThan(16);
});

test("a panel's history moves to another coordinate; an occupied target asks to merge", async ({
  page,
}) => {
  await page.goto("/#/map");
  // two versions at N1/E1
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page, { paper: "#b8c8ee" }));
  await page.getByTestId("coord-e-down").click();
  await page.getByTestId("input-scan-note").fill("the blue rework");
  await saveScan(page);
  // one resident at N1/E2
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await page.getByTestId("input-scan-note").fill("the resident");
  await saveScan(page);

  // move N1/E1 → N1/E3 (empty): all versions travel together
  await page.getByTestId("atlas-cell-1,1").click();
  await page.getByTestId("btn-move-panel").click();
  await page.getByTestId("coord-e-up").click();
  await page.getByTestId("coord-e-up").click();
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E3");
  await page.getByTestId("btn-move-go").click();
  await expect(page).toHaveURL(/#\/map\/panel\/3\/1$/);
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("panel-meta")).toContainText("the blue rework");
  await page.getByTestId("btn-back-atlas").click();
  await expect(page.getByTestId("atlas-cell-3,1")).toBeVisible();
  await expect(page.getByTestId("atlas-cell-1,1")).toHaveCount(0); // the old spot emptied

  // move N1/E3 → N1/E2 (occupied): the question, then one history
  await page.getByTestId("atlas-cell-3,1").click();
  await page.getByTestId("btn-move-panel").click();
  await page.getByTestId("coord-e-down").click();
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await page.getByTestId("btn-move-go").click();
  const note = page.getByTestId("merge-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText("N1/E2");
  await expect(note).toContainText("the two histories become one");
  // round two made the merge its own deliberate button, away from the slot
  // that asked the question
  await expect(page.getByTestId("btn-move-go")).toHaveCount(0);
  await expect(page.getByTestId("btn-merge-confirm")).toHaveText(STRINGS.mmMergeGo);
  if (test.info().project.name === "mobile") {
    await page.screenshot({ path: "e2e-artifacts/rider-move-merge.png" });
  }
  await page.getByTestId("btn-merge-confirm").click();
  await expect(page).toHaveURL(/#\/map\/panel\/2\/1$/);
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(3);
  // newest first across the merged histories
  await expect(page.getByTestId("version-row-0")).toContainText("the resident");
  await expect(page.getByTestId("version-row-1")).toContainText("the blue rework");
  await page.getByTestId("btn-back-atlas").click();
  await expect(page.getByTestId("atlas-cell-2,1")).toBeVisible();
  await expect(page.getByTestId("mm-footer")).toContainText("3 scans");
});

test("beyond the display ceiling the pipeline still downscales within budget", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await page.getByTestId("toggle-as-is").check();
  // past even the verbatim ceiling: the encoder must take over, and the
  // cost guard must keep the result inside the per-scan budget
  const png = await drawnPng(page, 4200, 5040);
  await page.setInputFiles('[data-testid="input-scan-gallery"]', {
    name: "huge-export.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "file", {
    timeout: 30_000,
  });
  await saveScan(page);

  const stored = await sha256OfStored(page);
  expect(stored.mime).toBe("image/webp");
  expect(Math.max(stored.width, stored.height)).toBeLessThanOrEqual(1600);
  expect(stored.bytes).toBeLessThan(300 * 1024); // the budget holds
});
