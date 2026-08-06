// The Helper's e2e law: the guided age loop at the table (glance, picker,
// dice triplet, spatial tap on the MAP, preview, undo, commit), proposal
// mode with its honesty marks and takeover, the adopter's skeleton path with
// a catch-up, records surviving reload, and the export file. Runs at the
// phone viewport too — this tool lives at a table next to paper.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, "..", "e2e-artifacts", "helper");
mkdirSync(SHOTS, { recursive: true });

const shot = (page: Page, name: string, project: string) =>
  page.screenshot({ path: join(SHOTS, `${project}-${name}.png`), fullPage: false });

// Create a blank world through the UI and land on the glance.
async function createBlank(page: Page, name: string, seed: number) {
  await page.goto("/#/helper");
  await page.getByTestId("origin-blank").click();
  await page.getByTestId("new-name").fill(name);
  await page.getByTestId("new-seed").fill(String(seed));
  await page.getByTestId("btn-create").click();
  await expect(page.getByTestId("glance")).toBeVisible({ timeout: 20_000 });
}

// Answer open questions until the age closes: dice/chances roll, picks take
// the first candidate — except when the caller wants specific behavior.
async function playOut(page: Page) {
  for (let i = 0; i < 80; i++) {
    if (await page.getByTestId("btn-commit").isVisible().catch(() => false)) return;
    const roll = page.getByTestId("die-roll");
    if (await roll.isVisible().catch(() => false)) {
      await roll.click();
      continue;
    }
    const chance = page.getByTestId("chance-roll");
    if (await chance.isVisible().catch(() => false)) {
      await chance.click();
      continue;
    }
    const cand = page.getByTestId("pick-cand-0");
    if (await cand.isVisible().catch(() => false)) {
      await cand.click();
      continue;
    }
    await page.waitForTimeout(80);
  }
  throw new Error("the age would not close");
}

test("a guided age at the table: dice triplet, map tap, preview, undo, commit", async ({ page }, testInfo) => {
  await createBlank(page, "Guided e2e", 42);
  await shot(page, "glance", testInfo.project.name);
  await page.getByTestId("btn-glance-ok").click();

  // the picker mirrors the deck: 20 cards before the wake
  await expect(page.getByTestId("card-picker")).toBeVisible();
  const total = await page.$$eval("[data-testid^=pick-card-]", (els) =>
    els.reduce((n, el) => {
      const c = el.querySelector(".count")?.textContent ?? "";
      return n + (c ? Number(c.replace("×", "")) : 1);
    }, 0),
  );
  expect(total).toBe(20);
  await shot(page, "card-picker", testInfo.project.name);

  // a Basin age: dice first — the triplet offers the book's three options
  await page.locator("[data-testid^=pick-card-basin-]").first().click();
  await expect(page.getByTestId("die-question")).toBeVisible();
  await expect(page.getByTestId("die-enter")).toBeVisible();
  await expect(page.getByTestId("die-roll")).toBeVisible();
  await expect(page.getByTestId("die-choose")).toBeVisible();
  await shot(page, "dice-triplet", testInfo.project.name);

  // enter my roll: the age header and the echo line preview in book words
  await page.getByTestId("die-enter").click();
  await page.getByTestId("die-face-4").click();
  await expect(page.getByTestId("age-events")).toContainText("| BASIN");
  await expect(page.getByTestId("age-events")).toContainText("d6=4 (row)");

  // choose the outcome (the book's free choice) for the column
  await page.getByTestId("die-choose").click();
  await page.getByTestId("die-face-7").click();
  await expect(page.getByTestId("age-events")).toContainText("d10=7 (column)");

  // roll on until a spatial choice opens, then answer it BY TAPPING THE MAP
  let sawSpatial = false;
  for (let i = 0; i < 60 && !sawSpatial; i++) {
    const pick = page.getByTestId("pick-question");
    if (await pick.isVisible().catch(() => false)) {
      const label = await page.getByTestId("pick-cand-0").textContent();
      const m = /r(\d+)c(\d+) ([NS]\d+\/[EW]\d+)/.exec(label ?? "");
      if (m) {
        sawSpatial = true;
        await shot(page, "candidates-highlighted", testInfo.project.name);
        // unit -> pixel via the canvas's exposed view transform
        const [r, c] = [Number(m[1]), Number(m[2])];
        const [ns, ew] = m[3].split("/");
        const ty = ns[0] === "N" ? Number(ns.slice(1)) : -Number(ns.slice(1));
        const tx = ew[0] === "E" ? Number(ew.slice(1)) : -Number(ew.slice(1));
        const gx = (tx > 0 ? tx - 1 : tx) * 5 + (c - 1);
        const gy = (ty > 0 ? -ty : -ty - 1) * 6 + (r - 1);
        const canvas = page.getByTestId("helper-canvas");
        const view = (await canvas.getAttribute("data-view"))!.split(",").map(Number);
        const [scale, vx, vy] = view;
        const box = (await canvas.boundingBox())!;
        await page.mouse.click(
          box.x + (gx + 0.5 - vx) * scale,
          box.y + (gy + 0.5 - vy) * scale,
        );
        // the tapped unit is the one the record paints or reworks next
        await expect(page.getByTestId("age-events")).toContainText(`r${r}c${c}`);
      } else {
        await page.getByTestId("pick-cand-0").click();
      }
      continue;
    }
    if (await page.getByTestId("btn-commit").isVisible().catch(() => false)) break;
    const roll = page.getByTestId("die-roll");
    if (await roll.isVisible().catch(() => false)) await roll.click();
    else await page.waitForTimeout(60);
  }
  expect(sawSpatial).toBe(true);

  // undo pops the whole decision
  const before = (await page.getByTestId("age-events").textContent()) ?? "";
  await page.getByTestId("btn-undo").click();
  await expect
    .poll(async () => ((await page.getByTestId("age-events").textContent()) ?? "").length)
    .toBeLessThan(before.length);

  await playOut(page);
  await shot(page, "age-closed", testInfo.project.name);
  await page.getByTestId("btn-commit").click();
  await expect(page.getByTestId("chip-era")).toContainText("age 1");
  await expect(page.getByTestId("glance")).toBeVisible();
});

test("proposal mode: suggestion marks, takeover drops to guided, accept commits", async ({ page }, testInfo) => {
  await createBlank(page, "Proposal e2e", 21);
  await page.getByTestId("btn-glance-ok").click();
  await page.getByTestId("mode-proposal").click();
  await page.locator("[data-testid^=pick-card-]").first().click();

  // the whole age resolved, sequence numbers on the map, marks on the rows
  await expect(page.getByTestId("proposal-card")).toBeVisible({ timeout: 20_000 });
  const rows = page.locator("[data-testid^=proposal-row-]");
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  expect(await page.locator("[data-testid^=suggestion-]").count()).toBeGreaterThan(0);
  await shot(page, "proposal", testInfo.project.name);

  if (n > 1) {
    // take one step over: guided from that point forward
    await page.getByTestId("proposal-row-1").click();
    await expect(page.getByTestId("age-flow-question")).toBeVisible();
    await playOut(page);
  } else {
    await page.getByTestId("btn-accept-proposal").click();
    await playOut(page);
  }
  await page.getByTestId("btn-commit").click();
  await expect(page.getByTestId("chip-era")).toContainText("age 1");
});

test("the adopter's path: skeleton, spread detail on demand, an age, a 3-age catch-up", async ({ page }, testInfo) => {
  await page.goto("/#/helper");
  await page.getByTestId("origin-paper").click();
  await page.getByTestId("new-name").fill("Adopter e2e");
  await expect(page.getByTestId("skeleton-editor")).toBeVisible();

  // the calendar: era 3, age 4 — a game well under way
  await page.getByTestId("paper-era").fill("3");
  await page.getByTestId("paper-age").fill("4");

  // one genesis panel is already full on paper
  await page.getByTestId("skeleton-1-1").click(); // open -> full
  await shot(page, "skeleton", testInfo.project.name);

  // the paper Stack, front first: tap every pool chip in offered order
  for (let i = 0; i < 14; i++) {
    const chip = page.locator("[data-testid^=stack-add-]").first();
    if (!(await chip.isVisible().catch(() => false))) break;
    await chip.click();
  }
  // mid-cycle deck answers: the marked card and one played
  await page.getByTestId("deck-midcycle").click();
  await page.locator("[data-testid^=marked-calm-]").first().click({ timeout: 20_000 });
  await page.locator("[data-testid^=played-basin-]").first().click();

  await page.getByTestId("skeleton-done").click();
  await expect(page.getByTestId("glance")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("chip-era")).toContainText("era 3 · age 4");

  // the Spread wants detail before the age: enter each missing panel
  for (let i = 0; i < 6; i++) {
    const enter = page.locator("[data-testid^=enter-panel-]").first();
    if (!(await enter.isVisible().catch(() => false))) break;
    await enter.click();
    await expect(page.getByTestId("paint-editor")).toBeVisible();
    if (i === 0) {
      // paint a believed corner and watch the Step Rule speak kindly
      await page.getByTestId("brush-plain").click();
      await page.getByTestId("paint-cell-1-1").click();
      await page.getByTestId("brush-mountains").click();
      await page.getByTestId("paint-cell-1-2").click();
      await expect(page.getByTestId("step-rule-note")).toBeVisible();
      await shot(page, "paint-editor-step-rule", testInfo.project.name);
      // the paper wins: put the neighbor back within a step
      await page.getByTestId("brush-hills").click();
      await page.getByTestId("paint-cell-1-2").click();
    }
    await page.getByTestId("paint-save").click();
    await expect(page.getByTestId("paint-editor")).not.toBeVisible();
  }
  await expect(page.getByTestId("btn-glance-ok")).toBeEnabled();
  await shot(page, "adopter-glance", testInfo.project.name);

  // play one guided age
  await page.getByTestId("btn-glance-ok").click();
  await page.locator("[data-testid^=pick-card-]").first().click();
  await playOut(page);
  await page.getByTestId("btn-commit").click();
  await expect(page.getByTestId("chip-era")).toContainText("age 5");

  // three ages painted away from the tool: the catch-up checkpoint
  await page.getByTestId("btn-catchup").click();
  await page.getByTestId("catchup-ages").fill("3");
  await page.getByTestId("deck-fresh").click();
  await page.getByTestId("catchup-go").click();
  await expect(page.getByTestId("chip-era")).toContainText("era 3 · age 8");

  // the Stack rotated meanwhile: the NEW working panel's Spread may want
  // detail before the next age — enter it, as at any age start
  for (let i = 0; i < 6; i++) {
    const enter = page.locator("[data-testid^=enter-panel-]").first();
    if (!(await enter.isVisible().catch(() => false))) break;
    await enter.click();
    await expect(page.getByTestId("paint-editor")).toBeVisible();
    await page.getByTestId("paint-save").click();
    await expect(page.getByTestId("paint-editor")).not.toBeVisible();
  }

  // and play continues on the caught-up world
  await page.getByTestId("btn-glance-ok").click();
  await expect(page.getByTestId("card-picker")).toBeVisible();
});

test("the record survives reload, mid-age included, and exports as one file", async ({ page }) => {
  await createBlank(page, "Persistence e2e", 11);
  await page.getByTestId("btn-glance-ok").click();
  await page.locator("[data-testid^=pick-card-]").first().click();

  // answer one decision, then reload mid-age
  for (let i = 0; i < 40; i++) {
    const roll = page.getByTestId("die-roll");
    if (await roll.isVisible().catch(() => false)) {
      await roll.click();
      break;
    }
    const cand = page.getByTestId("pick-cand-0");
    if (await cand.isVisible().catch(() => false)) {
      await cand.click();
      break;
    }
    await page.waitForTimeout(60);
  }
  await expect(page.getByTestId("age-events")).toContainText("[e1 a01]");
  await page.reload();
  // the open age resumed exactly where it stood
  await expect(page.getByTestId("age-events")).toContainText("[e1 a01]", {
    timeout: 20_000,
  });

  await playOut(page);
  await page.getByTestId("btn-commit").click();
  await expect(page.getByTestId("chip-era")).toContainText("age 1");

  // the record IS a timeline: scrub back to the age-zero world, then to now
  await expect(page.getByTestId("record-scrubber")).toBeVisible();
  await page.getByTestId("scrub-range").fill("0");
  await expect(page.getByTestId("scrub-chip")).toContainText("era 1 · age 0");
  await page.getByTestId("scrub-range").fill("1");
  await expect(page.getByTestId("scrub-chip")).not.toBeVisible();
  await expect(page.getByTestId("card-picker").or(page.getByTestId("glance"))).toBeVisible();

  // the export: one file holding the whole record
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("btn-export").click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const file = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(file.file).toBe("jm-helper-world");
  expect(file.lineage).toMatch(/^v\d/);
  expect(file.origin.type).toBe("blank");
  expect(file.entries.filter((e: { type: string }) => e.type === "age")).toHaveLength(1);
  expect(file.entries[0].type).toBe("genesis");
});
