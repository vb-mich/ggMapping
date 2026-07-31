// The minimal e2e law of the simulator: a run completes and paints, a deck
// edit changes the run, save-load roundtrips a world byte-identically, and
// the PNG export produces a nonempty image.
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { DISPLAY_NAME, STRINGS } from "../src/strings";

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

const reportText = (page: Page) =>
  page.getByTestId("final-report").textContent() as Promise<string>;

async function downloadText(page: Page, testid: string): Promise<string> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(testid).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
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

  await expect(page.getByTestId("final-report")).toContainText("FINAL METRICS");
  await expect(page.getByTestId("final-report")).toContainText("era 1:");
});

test("a deck edit changes the run", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);
  const before = await reportText(page);

  await page.getByTestId("deck-inc-calm").click();
  await expect(page.getByTestId("deck-totals")).toContainText("21 cards");
  await runToDone(page);
  const after = await reportText(page);
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
  await expect.poll(snap).not.toBe(atEnd); // the seeked state lands async

  await page.getByTestId("nav-next-age").click();
  await expect(page.getByTestId("now-line")).toContainText("Era 2 · Age 1/25");
  await expect(page.getByTestId("now-excerpt")).toContainText("[e2 a01]");

  await page.getByTestId("nav-last").click();
  await expect(page.getByTestId("now-line")).toContainText("Era 3 · Age 25/25");
  await expect.poll(snap).toBe(atEnd);
});

test("the built page's static title derives from the display constant", async ({ page }) => {
  const res = await page.request.get("/index.html");
  expect(await res.text()).toContain(
    `<title>${DISPLAY_NAME} — ${STRINGS.tagline}</title>`,
  );
});

test("time travel shows the viewing chip away from the end", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 6);
  await runToDone(page);
  await expect(page.getByTestId("viewing-chip")).toHaveCount(0);

  await page.getByTestId("nav-prev-era").click();
  await expect(page.getByTestId("viewing-chip")).toContainText(
    "viewing era 5 of 6",
  );

  await page.getByTestId("nav-last").click();
  await expect(page.getByTestId("viewing-chip")).toHaveCount(0);
});

test("the experimental badge and config marker appear only with the dial on", async ({
  page,
}) => {
  await page.goto("/");
  await setRun(page, 42, 3);
  await runToDone(page);

  // canon: no badge anywhere, and the exported config says nothing
  await expect(page.getByTestId("experimental-badge")).toHaveCount(0);
  const canonConfig = await downloadText(page, "btn-save-config");
  expect(JSON.parse(canonConfig).experimental).toBeUndefined();
  expect(JSON.parse(canonConfig).config.exp_fields).toBeUndefined();

  // dial on: the badge marks the run and the export marks the file
  await page.getByTestId("toggle-exp-fields").check();
  await expect(page.getByTestId("experimental-badge")).toBeVisible();
  const expConfig = JSON.parse(await downloadText(page, "btn-save-config"));
  expect(expConfig.experimental).toBe(true);
  expect(expConfig.config.exp_fields).toBe(true);

  // and the dialed run really is a different world
  const canonPeople = await page.getByTestId("people-breakdown").textContent();
  await runToDone(page);
  expect(await page.getByTestId("people-breakdown").textContent()).not.toBe(
    canonPeople,
  );

  // back to canon clears the experiment
  await page.getByTestId("btn-canon").click();
  await expect(page.getByTestId("toggle-exp-fields")).not.toBeChecked();
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

  await page
    .getByTestId("stats-strip")
    .screenshot({ path: "e2e-artifacts/elevation-shares.png" });

  // the Experimental group, and the badge it puts on a dialed run
  await page.getByTestId("toggle-exp-fields").check();
  await runToDone(page);
  await page
    .getByTestId("experimental-panel")
    .screenshot({ path: "e2e-artifacts/experimental-group.png" });
  await page
    .getByTestId("stats-strip")
    .screenshot({ path: "e2e-artifacts/experimental-badge.png" });
  await page.getByTestId("btn-canon").click();
  await runToDone(page);
  await page.getByTestId("nav-prev-era").click();
  await expect(page.getByTestId("viewing-chip")).toBeVisible();
  await page
    .getByTestId("now-panel")
    .screenshot({ path: "e2e-artifacts/viewing-chip.png" });
  await page.getByTestId("nav-last").click();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e-artifacts/mobile.png", fullPage: false });
});
