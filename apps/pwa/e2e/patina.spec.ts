// The patina picture (CONTRACTS §2.5). Seed 42 at 5 eras ends on panel N1/W3,
// a PARTIAL panel (12 of 30 painted) whose single flourish is recorded against
// the panel with no unit. Before v0.7.1 the renderer put that mark on the
// panel's top-left unit, which here is blank ground — so the mark was drawn
// over nothing and lost. The capture is the visual record of the fix.
import { expect, test } from "@playwright/test";

const OUT = process.env.JM_PATINA_SHOT ?? "e2e-artifacts/patina-after.png";

test("a partial panel's flourish lands on painted ground", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("input-seed").fill("42");
  await page.getByTestId("input-eras").fill("5");
  await page.getByTestId("btn-run").click();
  await expect(page.getByTestId("run-status")).toHaveAttribute(
    "data-status",
    "done",
    { timeout: 90_000 },
  );
  await expect(page.getByTestId("now-line")).toContainText("Era 5 · Age 25/25");

  // patina on, the age's step numbers off so only the marks show
  await page.getByTestId("toggle-patina").check();
  const numbers = page.getByTestId("toggle-work-numbers");
  if (await numbers.isChecked()) await numbers.uncheck();
  await page.getByTestId("toggle-names").check();
  // centre on the age's panel, which is the partial one
  await page.getByTestId("toggle-follow").check();
  for (let i = 0; i < 8; i++) await page.locator(".map-buttons button").nth(1).click();
  await page.waitForTimeout(600);

  await page.getByTestId("map-canvas").screenshot({ path: OUT });
});
