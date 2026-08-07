// Screenshots for the round-two report. Deliberately written against the
// surfaces BOTH the old and the new build share, so it can run twice — once
// with the changes stashed — and produce a true before/after pair.
// Prefix comes from JM_SHOT (before|after). Mobile viewport, the tester's.
import { expect, test, type Page } from "@playwright/test";

import { makeFixture, saveScan, scanToFile } from "./mymap-helpers";

const PREFIX = process.env.JM_SHOT ?? "after";
const shot = (name: string) => `e2e-artifacts/${PREFIX}-${name}.png`;

// the tester's viewport is the one worth picturing
const mobileOnly = () =>
  test.skip(test.info().project.name !== "mobile", "phone viewport only");

async function digitalPanel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = 900;
    cv.height = 1100;
    const g = cv.getContext("2d")!;
    g.fillStyle = "#101014";
    g.fillRect(0, 0, 900, 1100);
    g.fillStyle = "#f2efe6";
    g.fillRect(100, 120, 700, 860);
    g.fillStyle = "#96a582";
    g.fillRect(140, 560, 620, 300);
    g.fillStyle = "#20469b";
    for (let k = 0; k < 4; k++) g.fillRect(140, 200 + k * 70, 620, 8);
    return cv.toDataURL("image/png");
  });
}

test("shot: click-to-add around a lone panel", async ({ page }) => {
  mobileOnly();
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
  await page.getByTestId("atlas").screenshot({ path: shot("clicktoadd") });
});

test("shot: a digital panel through crop-and-straighten", async ({ page }) => {
  mobileOnly();
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const png = await digitalPanel(page);
  await page.setInputFiles('[data-testid="input-scan-gallery"]', {
    name: "panel.png",
    mimeType: "image/png",
    buffer: Buffer.from(png.split(",")[1], "base64"),
  });
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
  await page.getByTestId("adjust-canvas").screenshot({ path: shot("levels") });
  // the numbers behind the picture, for the report
  const patch = await page.getByTestId("adjust-canvas").evaluate((c) => {
    const cv = c as HTMLCanvasElement;
    const g = cv.getContext("2d")!;
    const grab = (fy: number) => {
      const d = g.getImageData(Math.round(cv.width * 0.5), Math.round(cv.height * fy), 8, 8).data;
      const m = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2];
      }
      return m.map((v) => Math.round(v / 64));
    };
    return { paper: grab(0.15), field: grab(0.75) };
  });
  // eslint-disable-next-line no-console
  console.log(`${PREFIX} preview — paper ${patch.paper} field ${patch.field}`);
});

test("shot: the merge question", async ({ page }) => {
  mobileOnly();
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await saveScan(page);

  await page.getByTestId("atlas-cell-1,1").click();
  await page.getByTestId("btn-move-panel").click();
  await page.getByTestId("coord-e-up").click();
  await expect(page.getByTestId("coord-name")).toHaveText("N1/E2");
  await page.getByTestId("btn-move-go").click(); // raises the question in both builds
  await expect(page.getByTestId("merge-note")).toBeVisible();
  await page.getByTestId("move-panel").screenshot({ path: shot("merge") });
});
