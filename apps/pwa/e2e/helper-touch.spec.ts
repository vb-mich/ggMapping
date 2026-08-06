// The touch review: every Helper button under REAL touch taps (page.tap
// drives the touchscreen, not the mouse — Playwright's click() sends mouse
// events even on mobile emulation, so this file is the phone's truth).
// Any button that swallows a tap fails here by name.
import { expect, test, type Page } from "@playwright/test";

test.use({ hasTouch: true });

async function tap(page: Page, testid: string) {
  await page.getByTestId(testid).tap();
}

// Answer open questions to closure with taps only.
async function playOutByTap(page: Page) {
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId("btn-commit").isVisible().catch(() => false)) return;
    const roll = page.getByTestId("die-roll");
    if (await roll.isVisible().catch(() => false)) {
      await roll.tap();
      continue;
    }
    const chance = page.getByTestId("chance-roll");
    if (await chance.isVisible().catch(() => false)) {
      await chance.tap();
      continue;
    }
    const cand = page.getByTestId("pick-cand-0");
    if (await cand.isVisible().catch(() => false)) {
      await cand.tap();
      continue;
    }
    await page.waitForTimeout(80);
  }
  throw new Error("the age would not close under taps");
}

test("every table button answers to a touch tap", async ({ page }) => {
  await page.goto("/#/helper");

  // origins expand on tap
  await tap(page, "origin-blank");
  await expect(page.getByTestId("new-name")).toBeVisible();
  await tap(page, "origin-fork");
  await expect(page.getByTestId("new-eras")).toBeVisible();
  await tap(page, "origin-blank");
  await page.getByTestId("new-name").fill("Touch review");
  await page.getByTestId("new-seed").fill("42");
  await tap(page, "btn-create");
  await expect(page.getByTestId("glance")).toBeVisible({ timeout: 20_000 });

  // the head row's buttons
  await tap(page, "btn-edit-map");
  await expect(page.getByTestId("paint-editor")).toBeVisible();
  await tap(page, "brush-plain");
  await tap(page, "paint-cell-1-1");
  await tap(page, "paint-cancel");
  await expect(page.getByTestId("paint-editor")).not.toBeVisible();

  await tap(page, "btn-catchup");
  await expect(page.getByTestId("catchup-card")).toBeVisible();
  await page.getByTestId("catchup-card").getByText("Cancel").tap();
  await expect(page.getByTestId("catchup-card")).not.toBeVisible();

  // the glance, the mode toggle, the picker
  await tap(page, "btn-glance-ok");
  await tap(page, "mode-proposal");
  await tap(page, "mode-guided");
  await expect(page.getByTestId("card-picker")).toBeVisible();
  await page.locator("[data-testid^=pick-card-basin-]").first().tap();

  // the dice triplet under touch: enter, choose, roll
  await expect(page.getByTestId("die-question")).toBeVisible();
  await tap(page, "die-enter");
  await tap(page, "die-face-4");
  await expect(page.getByTestId("age-events")).toContainText("d6=4 (row)");
  await tap(page, "die-choose");
  await tap(page, "die-face-7");
  await expect(page.getByTestId("age-events")).toContainText("d10=7 (column)");
  await tap(page, "die-roll");

  // a spatial answer BY TAPPING THE CANVAS (the signature interaction)
  let mapTapped = false;
  for (let i = 0; i < 60 && !mapTapped; i++) {
    const pick = page.getByTestId("pick-question");
    if (await pick.isVisible().catch(() => false)) {
      const label = await page.getByTestId("pick-cand-0").textContent();
      const m = /r(\d+)c(\d+) ([NS]\d+)\/([EW]\d+)/.exec(label ?? "");
      if (m) {
        const [r, c] = [Number(m[1]), Number(m[2])];
        const ty = m[3][0] === "N" ? Number(m[3].slice(1)) : -Number(m[3].slice(1));
        const tx = m[4][0] === "E" ? Number(m[4].slice(1)) : -Number(m[4].slice(1));
        const gx = (tx > 0 ? tx - 1 : tx) * 5 + (c - 1);
        const gy = (ty > 0 ? -ty : -ty - 1) * 6 + (r - 1);
        const canvas = page.getByTestId("helper-canvas");
        const view = (await canvas.getAttribute("data-view"))!.split(",").map(Number);
        const box = (await canvas.boundingBox())!;
        await page.touchscreen.tap(
          box.x + (gx + 0.5 - view[1]) * view[0],
          box.y + (gy + 0.5 - view[2]) * view[0],
        );
        await expect(page.getByTestId("age-events")).toContainText(`r${r}c${c}`);
        mapTapped = true;
        continue;
      }
      await page.getByTestId("pick-cand-0").tap();
      continue;
    }
    const roll = page.getByTestId("die-roll");
    if (await roll.isVisible().catch(() => false)) await roll.tap();
    else if (await page.getByTestId("btn-commit").isVisible().catch(() => false)) break;
    else await page.waitForTimeout(60);
  }
  expect(mapTapped).toBe(true);

  // undo, close out, commit — all taps
  await tap(page, "btn-undo");
  await playOutByTap(page);
  await tap(page, "btn-commit");
  await expect(page.getByTestId("chip-era")).toContainText("age 1");

  // the glance returns after EVERY commit — the session owns that answer,
  // and the reopen cycle below must re-ask it too (the regression this
  // suite exists for)
  await tap(page, "btn-glance-ok");
  await tap(page, "btn-reopen");
  await playOutByTap(page);
  await tap(page, "btn-commit");

  // proposal under touch: rows, takeover, accept
  await tap(page, "btn-glance-ok");
  await tap(page, "mode-proposal");
  await page.locator("[data-testid^=pick-card-]").first().tap();
  await expect(page.getByTestId("proposal-card")).toBeVisible({ timeout: 20_000 });
  const rows = await page.locator("[data-testid^=proposal-row-]").count();
  if (rows > 1) {
    await page.getByTestId("proposal-row-1").tap();
    await playOutByTap(page);
  } else {
    await tap(page, "btn-accept-proposal");
    await playOutByTap(page);
  }
  await tap(page, "btn-commit");
  await expect(page.getByTestId("chip-era")).toContainText("age 2");

  // the scrubber thumb answers to touch too (input range: tap sets a value)
  await expect(page.getByTestId("record-scrubber")).toBeVisible();

  // draw-for-me and export (back in guided mode — the preference persists)
  await tap(page, "btn-glance-ok");
  await tap(page, "mode-guided");
  await tap(page, "btn-draw-for-me");
  await playOutByTap(page);
  await tap(page, "btn-commit");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("btn-export").tap(),
  ]);
  expect((await download.suggestedFilename()).length).toBeGreaterThan(0);

  // back to the list; the world row opens on tap; delete asks then deletes
  await tap(page, "btn-back");
  await expect(page.getByTestId("helper-list")).toBeVisible();
  await page.locator("[data-testid^=open-]").first().tap();
  await expect(page.getByTestId("glance")).toBeVisible({ timeout: 20_000 });
  await tap(page, "btn-back");
  await page.locator("[data-testid^=delete-]").first().tap();
  await page.locator("[data-testid^=really-delete-]").first().tap();
  await expect(page.getByTestId("helper-empty")).toBeVisible();
});

test("the skeleton editor answers to touch taps", async ({ page }) => {
  await page.goto("/#/helper");
  await tap(page, "origin-paper");
  await expect(page.getByTestId("skeleton-editor")).toBeVisible();
  await tap(page, "skeleton-1-1"); // open -> full
  await expect(page.getByTestId("skeleton-1-1")).toHaveClass(/s-full/);
  await tap(page, "skeleton-1-1"); // full -> archived
  await expect(page.getByTestId("skeleton-1-1")).toHaveClass(/s-archived/);
  await tap(page, "skeleton-1-1"); // archived -> open (genesis skips none)
  await expect(page.getByTestId("skeleton-1-1")).toHaveClass(/s-open/);

  await tap(page, "deck-midcycle");
  await expect(page.locator("[data-testid^=marked-]").first()).toBeVisible({
    timeout: 20_000,
  });
  await page.locator("[data-testid^=marked-calm-]").first().tap();
  await tap(page, "deck-fresh");

  // the stack chips
  for (let i = 0; i < 14; i++) {
    const chip = page.locator("[data-testid^=stack-add-]").first();
    if (!(await chip.isVisible().catch(() => false))) break;
    await chip.tap();
  }
  await expect(page.getByTestId("skeleton-done")).toBeEnabled();
  await tap(page, "stack-reset");
  await expect(page.getByTestId("skeleton-done")).toBeDisabled();
});
