// The tester's second round, end to end: click-to-add reaches the map's
// outer edges; a merge is never the default action and stays undoable for
// the session; and straightening changes geometry only.
import { expect, test, type Page } from "@playwright/test";

import { STRINGS } from "../src/strings";
import { feedFixture, makeFixture, saveScan, scanToFile } from "./mymap-helpers";

// A digitally-made panel: flat paper, a flat mid-tone field, ink lines, on
// a dark ground so the corners are found. Flat by construction, so what
// comes out can be compared to what went in, value for value.
async function digitalPanel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = 900;
    cv.height = 1100;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#101014";
    g.fillRect(0, 0, 900, 1100);
    g.fillStyle = "#f2efe6"; // paper
    g.fillRect(100, 120, 700, 860);
    g.fillStyle = "#96a582"; // a mid-tone field, where darkening shows
    g.fillRect(140, 560, 620, 300);
    g.fillStyle = "#20469b";
    for (let k = 0; k < 4; k++) g.fillRect(140, 200 + k * 70, 620, 8);
    return cv.toDataURL("image/png");
  });
}

const feedPng = (page: Page, dataUrl: string, name = "panel.png") =>
  page.setInputFiles('[data-testid="input-scan-gallery"]', {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1], "base64"),
  });

// mean RGB of a patch of the newest stored scan, in fractions of its size
const storedPatch = (page: Page, fx: number, fy: number) =>
  page.evaluate(
    async ({ fx, fy }) => {
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
        Math.round(cv.width * fx),
        Math.round(cv.height * fy),
        10,
        10,
      ).data;
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        m[0] += d[i];
        m[1] += d[i + 1];
        m[2] += d[i + 2];
      }
      return m.map((v) => Math.round(v / 100));
    },
    { fx, fy },
  );

test("click-to-add reaches every side of the map, not only its notches", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();

  // all four sides of the lone panel invite a scan — the west one across
  // the coordinate grid's missing zero column
  for (const id of ["atlas-gap-1,2", "atlas-gap-2,1", "atlas-gap-1,-1", "atlas-gap--1,1"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // and the diagonals stay quiet
  for (const id of ["atlas-gap-2,2", "atlas-gap--1,2", "atlas-gap-2,-1", "atlas-gap--1,-1"]) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }

  // an edge position carries its coordinate into the scan flow
  await page.getByTestId("atlas-gap-1,2").click();
  await expect(page.getByTestId("scan-flow")).toBeVisible();
  await scanToFile(page, await makeFixture(page));
  await expect(page.getByTestId("coord-name")).toHaveText("N2/E1");
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,2")).toBeVisible();

  // the map grew north, so the grid did too: a position beyond the new
  // panel is offered now
  await expect(page.getByTestId("atlas-gap-1,3")).toBeVisible();
});

test("merge is never the default action, and stays undoable for the session", async ({
  page,
}) => {
  await page.goto("/#/map");
  // two versions at N1/E1
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await page.getByTestId("input-scan-note").fill("first face");
  await saveScan(page);
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page, { paper: "#b8c8ee" }));
  await page.getByTestId("coord-e-down").click();
  await page.getByTestId("input-scan-note").fill("second face");
  await saveScan(page);
  // one resident at N1/E2
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await page.getByTestId("input-scan-note").fill("the resident");
  await saveScan(page);

  await page.getByTestId("atlas-cell-1,1").click();
  await page.getByTestId("btn-move-panel").click();
  await page.getByTestId("coord-e-up").click();
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await page.getByTestId("btn-move-go").click();

  // the question names both coordinates and what each holds
  const note = page.getByTestId("merge-note");
  await expect(note).toContainText("N1/E1");
  await expect(note).toContainText("N1/E2");
  await expect(note).toContainText("2 scan");
  await expect(note).toContainText("1 scan");
  await expect(note).toContainText(STRINGS.mmMergeUndoable);

  // the button that asked the question is GONE: a second tap where the
  // finger already was cannot merge anything
  await expect(page.getByTestId("btn-move-go")).toHaveCount(0);
  await page.getByTestId("btn-merge-decline").click();
  await expect(page.getByTestId("merge-note")).toHaveCount(0);
  await page.getByTestId("btn-back-atlas").click();
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible(); // nothing moved
  await expect(page.getByTestId("mm-footer")).toContainText("3 scans");

  // the deliberate way through
  await page.getByTestId("atlas-cell-1,1").click();
  await page.getByTestId("btn-move-panel").click();
  await page.getByTestId("coord-e-up").click();
  await page.getByTestId("btn-move-go").click();
  await page.getByTestId("btn-merge-confirm").click();
  await expect(page).toHaveURL(/#\/map\/panel\/2\/1$/);
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(3);

  // and it can be taken back, from anywhere, for the rest of the session
  const undo = page.getByTestId("merge-undo");
  await expect(undo).toContainText("N1/E1");
  await expect(undo).toContainText("N1/E2");
  await page.getByTestId("btn-back-atlas").click();
  await expect(undo).toBeVisible(); // it followed us to the atlas
  await page.getByTestId("btn-undo-merge").click();
  await expect(undo).toHaveCount(0);

  // both histories are whole again, the resident never having moved
  await page.getByTestId("atlas-cell-1,1").click();
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("panel-meta")).toContainText("second face");
  await page.getByTestId("btn-back-atlas").click();
  await page.getByTestId("atlas-cell-2,1").click();
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("panel-meta")).toContainText("the resident");
});

test("straightening changes geometry only: the light is left alone", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const png = await digitalPanel(page);
  await feedPng(page, png);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
  // the three sliders sit at neutral, and nothing was applied behind them
  await expect(page.getByTestId("exposure-value")).toHaveText("0");
  await expect(page.getByTestId("contrast-value")).toHaveText("0");
  await expect(page.getByTestId("temperature-value")).toHaveText("0");
  await page.getByTestId("btn-to-file").click();
  await saveScan(page);

  // what came out is what went in: paper and mid-tone field both faithful
  const paper = await storedPatch(page, 0.5, 0.15);
  const field = await storedPatch(page, 0.5, 0.75);
  const near = (got: number[], want: number[]) =>
    got.every((v, i) => Math.abs(v - want[i]) <= 4);
  expect(near(paper, [0xf2, 0xef, 0xe6]), `paper ${paper}`).toBe(true);
  expect(near(field, [0x96, 0xa5, 0x82]), `field ${field}`).toBe(true);
});
