// The minimal e2e law of the simulator: a run completes and paints, a deck
// edit changes the run, save-load roundtrips a world byte-identically, and
// the PNG export produces a nonempty image.
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

async function setRun(page: Page, seed: number, eras: number) {
  await page.getByTestId("input-seed").fill(String(seed));
  await page.getByTestId("input-eras").fill(String(eras));
}

async function runToDone(page: Page) {
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("run-status")).toHaveAttribute(
    "data-status",
    "done",
    { timeout: 90_000 },
  );
}

const recordText = (page: Page) =>
  page.getByTestId("record-list").textContent() as Promise<string>;

async function detailsOn(page: Page) {
  const t = page.getByTestId("toggle-details");
  if (!(await t.isChecked())) await t.click();
}

test("a run completes and paints", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);

  // the canvas painted: many distinct colors, not a blank sheet
  const colors = await page.evaluate(() => {
    const cv = document.querySelector(
      '[data-testid="map-canvas"]',
    ) as HTMLCanvasElement;
    const d = cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data;
    const seen = new Set<string>();
    for (let i = 0; i < d.length; i += 200)
      seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return seen.size;
  });
  expect(colors).toBeGreaterThan(5);

  await expect(page.getByTestId("era-rows")).toContainText("era 1:");
  await expect(page.getByTestId("final-report")).toContainText("FINAL METRICS");

  // compact by default: the run frame and era summaries only
  const compact = await recordText(page);
  expect(compact).toContain("=== era 1:");
  expect(compact).not.toContain("paint r");
  await detailsOn(page);
  expect((await recordText(page)).length).toBeGreaterThan(1000);
});

test("a deck edit changes the run", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);
  await detailsOn(page);
  const before = await recordText(page);

  await page.getByTestId("deck-inc-calm").click();
  await expect(page.getByTestId("deck-totals")).toContainText("21 cards");
  await runToDone(page);
  await detailsOn(page);
  const after = await recordText(page);
  expect(after).not.toBe(before);
});

test("navigation shows true engine state at any age", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);

  const snap = () =>
    page.evaluate(() =>
      (document.querySelector('[data-testid="map-canvas"]') as HTMLCanvasElement).toDataURL(),
    );
  await expect(page.getByTestId("now-line")).toContainText("Era 3 · Age 25/25");
  const atEnd = await snap();

  await page.getByTestId("nav-prev-era").click();
  await expect(page.getByTestId("now-line")).toContainText("Era 2 · Age 0/25");
  const atEra2 = await snap();
  expect(atEra2).not.toBe(atEnd);

  await page.getByTestId("nav-next-age").click();
  await expect(page.getByTestId("now-line")).toContainText("Era 2 · Age 1/25");
  await expect(page.getByTestId("now-excerpt")).toContainText("[e2 a01]");

  await page.getByTestId("nav-last").click();
  await expect(page.getByTestId("now-line")).toContainText("Era 3 · Age 25/25");
  expect(await snap()).toBe(atEnd);
});

test("the theme defaults to dark and switches", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("btn-theme").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("save-load roundtrips a world byte-identically", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);

  const dl1 = page.waitForEvent("download");
  await page.getByTestId("btn-save").click();
  const file1 = await (await dl1).path();
  const bytes1 = readFileSync(file1);

  await page.getByTestId("input-load").setInputFiles(file1);
  await expect(page.getByTestId("run-status")).toHaveAttribute(
    "data-status",
    "paused",
  );

  const dl2 = page.waitForEvent("download");
  await page.getByTestId("btn-save").click();
  const bytes2 = readFileSync(await (await dl2).path());
  expect(bytes2.equals(bytes1)).toBe(true);

  // and through the engine: Continue re-enters, finishes, and the world
  // re-serializes from engine state
  await page.getByTestId("btn-continue").click();
  await expect(page.getByTestId("run-status")).toHaveAttribute(
    "data-status",
    "done",
    { timeout: 60_000 },
  );
  const dl3 = page.waitForEvent("download");
  await page.getByTestId("btn-save").click();
  const bytes3 = readFileSync(await (await dl3).path());
  expect(bytes3.equals(bytes1)).toBe(true);
});

test("the PNG export produces a nonempty image", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);

  const dl = page.waitForEvent("download");
  await page.getByTestId("btn-export-png").click();
  const bytes = readFileSync(await (await dl).path());
  expect(bytes.length).toBeGreaterThan(1000);
  // PNG signature
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});

test("screenshots at mobile and desktop widths", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 5);
  await runToDone(page);
  await page.screenshot({ path: "e2e-artifacts/desktop.png", fullPage: false });
  await page.screenshot({ path: "e2e-artifacts/desktop-full.png", fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e-artifacts/mobile.png", fullPage: false });
});
