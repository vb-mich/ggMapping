// The atlas shows thumbnails at rest and the stored scan once zoomed. The
// third field report called the old behaviour "a little blurry": a 256 px
// thumbnail stretched past its own size, while the sharp scan sat unused in
// the database.
import { expect, test, type Page } from "@playwright/test";

import { makeFixture, saveScan, scanToFile } from "./mymap-helpers";

const cellImage = (page: Page) => page.locator(".atlas-cell img").first();

const sourceWidth = (page: Page) =>
  cellImage(page).evaluate((im) => (im as HTMLImageElement).naturalWidth);

async function zoomBy(page: Page, ticks: number) {
  const box = (await page.getByTestId("atlas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < Math.abs(ticks); i++) {
    await page.mouse.wheel(0, ticks > 0 ? -120 : 120);
  }
  await page.waitForTimeout(150);
}

test("the atlas swaps a thumbnail for the stored scan once zoomed", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  const cell = page.getByTestId("atlas-cell-1,1");
  await expect(cell).toBeVisible();

  // at rest the thumbnail is right: it covers the cell without stretching
  await expect(cell).toHaveAttribute("data-full", "no");
  const thumbWidth = await sourceWidth(page);
  expect(thumbWidth).toBeLessThanOrEqual(256);

  // zoomed in, the cell asks for what was actually stored
  await zoomBy(page, 5); // 1.15^5, about 2x
  await expect(cell).toHaveAttribute("data-full", "yes", { timeout: 10_000 });
  const fullWidth = await sourceWidth(page);
  expect(fullWidth).toBeGreaterThan(thumbWidth * 2);

  // and back out, the thumbnail is enough again
  await zoomBy(page, -6);
  await expect(cell).toHaveAttribute("data-full", "no", { timeout: 10_000 });
  expect(await sourceWidth(page)).toBe(thumbWidth);
});

test("a panel opens from the atlas while zoomed, and the tap is not a drag", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();

  await zoomBy(page, 5);
  await expect(page.getByTestId("atlas-cell-1,1")).toHaveAttribute("data-full", "yes", {
    timeout: 10_000,
  });
  // the swap must not cost the cell its click
  await page.getByTestId("atlas-cell-1,1").click();
  await expect(page.getByTestId("panel-detail")).toBeVisible();
  await expect(page.getByTestId("panel-image")).toBeVisible();
});
