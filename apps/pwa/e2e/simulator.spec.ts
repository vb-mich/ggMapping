// The minimal e2e law of the simulator: a run completes and paints, a deck
// edit changes the run, save-load roundtrips a world byte-identically, and
// the PNG export produces a nonempty image.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

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

test("time travel to an Add Panel age shows the new panel's fills", async ({
  page,
}) => {
  // Find the first Add Panel age from the committed golden, so the target is
  // the lineage's own truth rather than something the test invents.
  const golden = readFileSync(
    join(HERE, "..", "..", "..", "reference", "sample_log_seed42_v07.txt"),
    "utf8",
  ).split("\n");
  let era = 0,
    age = 0;
  for (const line of golden) {
    const m = /^\[e(\d+) a(\d+)\] the new panel \| ADDPANEL$/.exec(line);
    if (m && Number(m[1]) <= 5) {
      era = Number(m[1]);
      age = Number(m[2]);
      break;
    }
  }
  expect(era).toBeGreaterThan(0);

  await page.goto("/");
  await setRun(page, 42, 5);
  await runToDone(page);

  await page.getByTestId("nav-era").fill(String(era));
  await page.getByTestId("nav-age").fill(String(age));
  await page.getByTestId("nav-go").click();

  await expect(page.getByTestId("now-line")).toContainText(
    `Era ${era} · Age ${age}/25`,
  );
  const excerpt = page.getByTestId("now-excerpt");
  // the age names the new panel, claims it as the working panel, and fills it
  await expect(excerpt).toContainText(`[e${era} a${String(age).padStart(2, "0")}] the new panel | ADDPANEL`);
  await expect(excerpt).toContainText("new panel");
  await expect(excerpt).toContainText("the current working panel is the new panel");
  await expect(excerpt).toContainText("paint r");
  // and none of the Stack bookkeeping a normal age would carry
  await expect(excerpt).not.toContainText("the city lives");
  await expect(excerpt).not.toContainText("back of stack");
  await expect(excerpt).not.toContainText("stays in play");
});

test("the lineage badge comes from the engine and rides exported configs", async ({
  page,
}) => {
  await page.goto("/");
  const badge = page.getByTestId("lineage-badge");
  await expect(badge).toBeVisible();
  const shown = ((await badge.textContent()) ?? "").replace("rules", "").trim();
  expect(shown).toMatch(/^v\d+\.\d+$/);

  // it is the ENGINE's lineage, not a string the app keeps: a world the
  // engine saves must name the same one
  await setRun(page, 42, 3);
  await runToDone(page);
  const world = JSON.parse(await downloadText(page, "btn-save"));
  expect(world.lineage).toBe(shown);

  // and the exported config carries it, distinct from the package version
  const cfg = JSON.parse(await downloadText(page, "btn-save-config"));
  expect(cfg.lineage).toBe(shown);
  // the package version is a separate fact in a separate place: same shape
  // family, different value, and neither is derived from the other
  const version = (await page.getByTestId("app-version").textContent())?.trim();
  expect(version).toMatch(/^v\d+\.\d+\.\d+\+/); // package version + build sha
  expect(version).not.toBe(shown);
});

test("a foreign-lineage file loads, with a notice, and is not migrated", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("lineage-badge")).toBeVisible();
  await expect(page.getByTestId("foreign-lineage-notice")).toHaveCount(0);

  const foreign = JSON.stringify({
    seed: 4242,
    eras: 9,
    lineage: "v0.4",
    config: { panel_w: 5, panel_h: 6, stroke_die: 4, extend_cap: 4 },
  });
  await page.setInputFiles("[data-testid='input-load-config']", {
    name: "old-lineage.json",
    mimeType: "application/json",
    buffer: Buffer.from(foreign),
  });

  // the notice appears and names both lineages...
  const notice = page.getByTestId("foreign-lineage-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("v0.4");
  // ...and the load went through untouched: no block, no migration
  await expect(page.getByTestId("input-seed")).toHaveValue("4242");
  await expect(page.getByTestId("input-eras")).toHaveValue("9");

  await page.locator("header").screenshot({ path: "e2e-artifacts/lineage-badge.png" });
  await notice.screenshot({ path: "e2e-artifacts/foreign-lineage-notice.png" });

  await page.getByTestId("btn-dismiss-notice").click();
  await expect(notice).toHaveCount(0);
});

test("work numbers mark the age's worked units on the map", async ({ page }) => {
  await page.goto("/");
  await setRun(page, 42, 4);
  await runToDone(page);

  // Navigation and Now sit together above the map
  const pair = page.locator(".now-nav");
  await expect(pair.getByTestId("nav-panel")).toBeVisible();
  await expect(pair.getByTestId("now-panel")).toBeVisible();
  const mapTop = (await page.getByTestId("map-canvas").boundingBox())!.y;
  const nowTop = (await page.getByTestId("now-panel").boundingBox())!.y;
  expect(nowTop).toBeLessThan(mapTop); // above the map, not below it

  const toggle = page.getByTestId("toggle-work-numbers");
  await expect(toggle).toBeChecked(); // on by default

  // zoom in on the worked panel so the badges are legible
  await page.getByTestId("toggle-follow").check();
  for (let i = 0; i < 10; i++) await page.locator(".map-buttons button").nth(1).click();
  await page.waitForTimeout(400);

  const shot = () =>
    page.getByTestId("map-canvas").evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const withNumbers = await shot();
  await page.getByTestId("map-canvas").screenshot({
    path: "e2e-artifacts/work-numbers.png",
  });

  await toggle.uncheck();
  await page.waitForTimeout(400);
  expect(await shot()).not.toBe(withNumbers); // the marks really are drawn

  await toggle.check();
  await page.waitForTimeout(400);
  expect(await shot()).toBe(withNumbers); // and restored exactly

  // an age whose steps include ones that name no unit — a deck shuffle — is
  // still complete: those badge the panel instead (era 1 age 20 of this seed)
  await page.getByTestId("nav-era").fill("1");
  await page.getByTestId("nav-age").fill("20");
  await page.getByTestId("nav-go").click();
  await expect(page.getByTestId("now-excerpt")).toContainText("the deck is shuffled");
  await page.locator(".map-buttons button").nth(0).click();
  await page.waitForTimeout(500);
  await page.getByTestId("map-canvas").screenshot({
    path: "e2e-artifacts/work-numbers-panel.png",
  });
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
