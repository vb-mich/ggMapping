// The e2e law of My map: detection lands near the known corners of a
// synthetic panel (and the manual quad path completes regardless), the
// rectified output carries the fixture's true proportions (the scanner is
// size-agnostic — it recovers them from the photo), a saved scan lands on the
// atlas at its coordinate and survives a reload, a second scan of the same
// panel becomes the newest while the first stays as history, deletion asks
// first with wording that promises no recovery, and the detector chunk loads
// lazily — never with the app shell.
import { expect, test } from "@playwright/test";

import { STRINGS } from "../src/strings";
import {
  FIXTURE,
  feedFixture,
  handlePos,
  makeFixture,
  saveScan,
  scanToFile,
} from "./mymap-helpers";

test("the empty state explains the tool, and the shell never loads the detector", async ({
  page,
}) => {
  await page.goto("/#/map");
  await expect(page.getByTestId("atlas-empty")).toContainText("panel by panel");
  await expect(page.getByTestId("mm-footer")).toContainText("0 scans");

  // the detector chunk is not part of the shell...
  const before = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name),
  );
  expect(before.filter((n) => /detect-/.test(n))).toHaveLength(0);

  // ...it arrives on first use of the scan screen
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  const after = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name),
  );
  expect(after.filter((n) => /detect-/.test(n)).length).toBeGreaterThan(0);
});

test("detection lands near the known corners; the rectified output has the true proportions", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await feedFixture(page, t);

  await expect(page.getByTestId("detect-note")).toHaveText(STRINGS.mmDetected);
  const tol = Math.hypot(FIXTURE.frameW, FIXTURE.frameH) * 0.04; // 4% of the diagonal
  for (let i = 0; i < 4; i++) {
    const p = await handlePos(page, i);
    const truth = t.corners[i];
    expect(Math.hypot(p.x - truth.x, p.y - truth.y)).toBeLessThan(tol);
  }

  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
  const facts = page.getByTestId("rect-facts");
  const w = Number(await facts.getAttribute("data-width"));
  const h = Number(await facts.getAttribute("data-height"));
  const trueRatio = FIXTURE.W / FIXTURE.H; // 5:6 — but only the photo knows it
  expect(Math.abs(w / h - trueRatio)).toBeLessThan(trueRatio * 0.05);

  // the adjustment pair changes the preview, and each bar wears its number:
  // 0 at the neutral center, signed once moved
  await expect(page.getByTestId("exposure-value")).toHaveText("0");
  await expect(page.getByTestId("contrast-value")).toHaveText("0");
  const shot = () =>
    page
      .getByTestId("adjust-canvas")
      .evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const before = await shot();
  await page.getByTestId("slider-exposure").fill("60");
  await expect(page.getByTestId("exposure-value")).toHaveText("+60");
  await page.getByTestId("slider-contrast").fill("-25");
  await expect(page.getByTestId("contrast-value")).toHaveText("-25");
  await page.getByTestId("slider-contrast").fill("0");
  await expect(page.getByTestId("contrast-value")).toHaveText("0");
  await expect.poll(shot).not.toBe(before);

  // filing offers N1/E1 for the first scan of a map
  await page.getByTestId("btn-to-file").click();
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E1");
  await saveScan(page);

  // the atlas shows it at its coordinate, and the archive counts it
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
  await expect(page.getByTestId("mm-footer")).toContainText("1 scan ·");
});

test("the manual quad path completes: corners drag, the scan still files", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");

  // drag corner 0 well away from where detection put it
  const svg = page.getByTestId("quad-editor");
  const box = (await svg.boundingBox())!;
  const imgW = Number(await svg.getAttribute("data-w"));
  const imgH = Number(await svg.getAttribute("data-h"));
  const toScreen = (p: { x: number; y: number }) => ({
    x: box.x + (p.x / imgW) * box.width,
    y: box.y + (p.y / imgH) * box.height,
  });
  const start = toScreen(await handlePos(page, 0));
  const target = { x: 100, y: 90 };
  const end = toScreen(target);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  // while a handle drags, the loupe magnifies the spot the finger covers
  await expect(page.getByTestId("drag-loupe")).toBeVisible();
  if (test.info().project.name === "mobile") {
    await page.screenshot({ path: "e2e-artifacts/mymap-loupe.png" });
  }
  await page.mouse.up();
  await expect(page.getByTestId("drag-loupe")).toBeHidden();

  const moved = await handlePos(page, 0);
  expect(Math.hypot(moved.x - target.x, moved.y - target.y)).toBeLessThan(imgW * 0.03);

  // dragging a mid-edge handle translates its whole edge: both corners move
  const midHandle = page.getByTestId("quad-mid-0");
  const mid = {
    x: Number(await midHandle.getAttribute("data-x")),
    y: Number(await midHandle.getAttribute("data-y")),
  };
  const c0 = await handlePos(page, 0);
  const c1 = await handlePos(page, 1);
  const delta = { x: -40, y: 35 };
  const midStart = toScreen(mid);
  const midEnd = toScreen({ x: mid.x + delta.x, y: mid.y + delta.y });
  await page.mouse.move(midStart.x, midStart.y);
  await page.mouse.down();
  await page.mouse.move(midEnd.x, midEnd.y, { steps: 8 });
  await page.mouse.up();
  const c0b = await handlePos(page, 0);
  const c1b = await handlePos(page, 1);
  const tol = imgW * 0.03;
  expect(Math.hypot(c0b.x - (c0.x + delta.x), c0b.y - (c0.y + delta.y))).toBeLessThan(tol);
  expect(Math.hypot(c1b.x - (c1.x + delta.x), c1b.y - (c1.y + delta.y))).toBeLessThan(tol);

  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
  await page.getByTestId("btn-to-file").click();
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
});

test("the atlas pans and zooms on its very first open", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);

  // a fresh open: the atlas paints its empty state first, then the grid
  // arrives when the scans load — pan and zoom must work RIGHT THEN, with
  // no detour through a panel (the ref-timing regression of act 1.5)
  await page.reload();
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
  const transform = () =>
    page.locator(".atlas-plane").evaluate((el) => (el as HTMLElement).style.transform || "");
  const before = await transform();

  // the default view holds the map in the middle of the viewport
  const vpBox = (await page.getByTestId("atlas").boundingBox())!;
  const plBox = (await page.locator(".atlas-plane").boundingBox())!;
  expect(Math.abs(plBox.x + plBox.width / 2 - (vpBox.x + vpBox.width / 2))).toBeLessThan(2);
  expect(Math.abs(plBox.y + plBox.height / 2 - (vpBox.y + vpBox.height / 2))).toBeLessThan(2);

  const box = (await page.getByTestId("atlas").boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy + 50, { steps: 6 });
  await page.mouse.up();
  await expect.poll(transform).not.toBe(before);
  expect(await transform()).toContain("translate");
  // and the drag was not mistaken for a tap: still on the atlas
  await expect(page.getByTestId("atlas")).toBeVisible();

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -200);
  await expect.poll(transform).toMatch(/scale\(1\.\d/);
});

test("a saved scan survives a reload: persistence across sessions", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await scanToFile(page, t);
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
  await expect(page.getByTestId("mm-footer")).toContainText("1 scan ·");
});

test("a second scan of the same panel becomes the newest; the first stays as history; deleting asks first", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await scanToFile(page, t);
  await saveScan(page);

  // the picker now offers the East neighbor (E, S, W, N rule)...
  await page.getByTestId("btn-scan").click();
  const t2 = await makeFixture(page);
  await scanToFile(page, t2);
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  // ...but this is a re-scan of N1/E1: one step West
  await page.getByTestId("coord-e-down").click();
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E1");
  await expect(page.getByTestId("version-note")).toContainText("becomes the newest");
  await page.getByTestId("input-scan-note").fill("after the rework");
  await saveScan(page);

  // one panel on the atlas, two versions in its history, newest first
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
  await expect(page.getByTestId("mm-footer")).toContainText("2 scans");
  await page.getByTestId("atlas-cell-1,1").click();
  await expect(page.getByTestId("panel-detail")).toBeVisible();
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("version-row-0")).toContainText("after the rework");
  await expect(page.getByTestId("panel-meta")).toContainText("after the rework");

  // deletion asks first, and the wording promises no recovery anywhere
  await page.getByTestId("btn-delete-0").click();
  const confirm = page.getByTestId("delete-confirm");
  await expect(confirm).toContainText(STRINGS.mmDeleteWarn);
  await page.getByTestId("btn-delete-cancel").click();
  await expect(confirm).toHaveCount(0);
  await page.getByTestId("btn-delete-0").click();
  await page.getByTestId("btn-delete-forever").click();
  await expect(page.getByTestId("version-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("panel-meta")).not.toContainText("after the rework");
});

test("the atlas keeps its gaps visible and its maps apart", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await scanToFile(page, t);
  await saveScan(page);

  // a second panel two columns east leaves a visible gap at N1/E2
  await page.getByTestId("btn-scan").click();
  const t2 = await makeFixture(page);
  await scanToFile(page, t2);
  await page.getByTestId("coord-e-up").click(); // N1/E2 -> N1/E3
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E3");
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
  await expect(page.getByTestId("atlas-cell-3,1")).toBeVisible();
  await expect(page.getByTestId("atlas-gap-2,1")).toBeVisible();

  // an empty panel invites its first scan: tapping the gap opens the flow
  // with the gap's coordinate preset — and the flow's back arrow walks out
  await page.getByTestId("atlas-gap-2,1").click();
  await expect(page.getByTestId("scan-flow")).toBeVisible();
  await page.getByTestId("btn-scan-close").click();
  await expect(page.getByTestId("atlas")).toBeVisible();
  await page.getByTestId("atlas-gap-2,1").click();
  const t3 = await makeFixture(page);
  await scanToFile(page, t3);
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await page.getByTestId("btn-scan-close").click(); // abandon, save nothing
  await expect(page.getByTestId("atlas-gap-2,1")).toBeVisible();

  // a new map starts empty; the first map's scans stay its own
  await page.getByTestId("btn-new-map").click();
  await page.getByTestId("input-map-name").fill("The second table");
  await page.getByTestId("btn-map-create").click();
  await expect(page.getByTestId("atlas-empty")).toBeVisible();
  await expect(page.getByTestId("mm-footer")).toContainText("2 scans"); // device-wide facts
  await page.getByTestId("map-select").selectOption({ label: "My first map" });
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
});

test("screenshots of the scan flow and the atlas at phone width", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "captured on the phone viewport only");

  await page.goto("/#/map");
  await page.screenshot({ path: "e2e-artifacts/mymap-empty.png" });

  await page.getByTestId("btn-scan").click();
  await page.screenshot({ path: "e2e-artifacts/mymap-capture.png" });
  const t = await makeFixture(page);
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.screenshot({ path: "e2e-artifacts/mymap-crop.png" });

  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
  await page.screenshot({ path: "e2e-artifacts/mymap-adjust.png" });

  await page.getByTestId("btn-to-file").click();
  await page.screenshot({ path: "e2e-artifacts/mymap-file.png" });
  await saveScan(page);

  // a few more panels so the atlas reads as a map
  for (const [dir, times] of [["coord-e-up", 0], ["coord-n-down", 1]] as const) {
    await page.getByTestId("btn-scan").click();
    const tn = await makeFixture(page);
    await scanToFile(page, tn);
    for (let i = 0; i < times; i++) await page.getByTestId(dir).click();
    await saveScan(page);
  }
  await page.screenshot({ path: "e2e-artifacts/mymap-atlas.png" });

  await page.getByTestId("atlas-cell-1,1").click();
  await expect(page.getByTestId("panel-detail")).toBeVisible();
  await expect(page.getByTestId("panel-image")).toBeVisible();
  await page.screenshot({ path: "e2e-artifacts/mymap-panel.png" });
});
