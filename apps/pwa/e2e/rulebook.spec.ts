// The Rulebook reader: the handbook's single source, rendered with an outline
// from its own headings and deep links per heading. Runs in both playwright
// projects — the desktop viewport shows the sidebar, the phone the drawer.
import { expect, test, type Page } from "@playwright/test";

// "scrolled correctly": the heading sits in the upper region — or the page
// hit its own end, which is as far as a bottom chapter can ever land
async function landedAt(page: Page, y: number): Promise<boolean> {
  if (y >= -2 && y < 200) return true;
  return page.evaluate(
    () =>
      Math.ceil(window.scrollY + window.innerHeight) >=
      document.documentElement.scrollHeight - 2,
  );
}

const isNarrow = (page: { viewportSize(): { width: number } | null }) =>
  (page.viewportSize()?.width ?? 1280) < 900;

test("the Rulebook tab opens the reader: title, badge, and a real outline", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("tab-rulebook").click();
  await expect(page).toHaveURL(/#\/rules$/);

  // the handbook names itself; nothing here is an app-side constant
  await expect(page.getByTestId("book-title")).toContainText("Handbook");
  // the lineage chip reads the engine's value, same source as the header's
  const headerBadge = (await page.getByTestId("lineage-badge").textContent()) ?? "";
  await expect(page.getByTestId("book-lineage")).toHaveText(headerBadge.trim());

  if (isNarrow(page)) {
    // phone: a sticky bar keeps the reading controls in reach; the outline
    // folds into a drawer that closes three ways
    const bar = page.getByTestId("book-bar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("book-side")).toBeHidden();
    const toggle = page.getByTestId("book-drawer-toggle");
    await toggle.click();
    await expect(page.getByTestId("book-side")).toBeVisible();
    await page.screenshot({ path: "e2e-artifacts/rulebook-drawer-mobile.png" });
    await toggle.click(); // 1: the always-reachable toggle closes it
    await expect(page.getByTestId("book-side")).toBeHidden();
    await toggle.click();
    await page.getByTestId("book-backdrop").click({ position: { x: 5, y: 400 } });
    await expect(page.getByTestId("book-side")).toBeHidden(); // 2: the backdrop
    await toggle.click();
    await page.getByTestId("book-side").getByRole("link", { name: /^5\./ }).click();
    await expect(page).toHaveURL(/#\/rules\/5-/);
    await expect(page.getByTestId("book-side")).toBeHidden(); // 3: navigating
    // the bar carries the reading controls: theme and profile stay reachable
    await expect(bar.getByTestId("book-theme")).toBeVisible();
    await expect(bar.getByTestId("book-profile")).toBeVisible();
  } else {
    // desktop: a sidebar, one link per chapter of the book
    await expect(page.getByTestId("book-side")).toBeVisible();
    const chapters = page.locator(
      "[data-testid='book-outline'] > ul > li > a",
    );
    expect(await chapters.count()).toBeGreaterThanOrEqual(10);
    await page.screenshot({ path: "e2e-artifacts/rulebook-desktop.png" });
  }
});

test("a deep link lands on its section, scrolled correctly", async ({ page }) => {
  await page.goto("/#/rules/your-first-deck");
  const heading = page.locator("#your-first-deck");
  await expect(heading).toBeVisible();
  // scrolled to the heading: it sits in the viewport's upper region.
  // Polled: the scroll runs in an effect after the route lands, and a slow
  // runner can read the box first (CI caught this; fast machines hide it).
  await expect
    .poll(async () => landedAt(page, (await heading.boundingBox())!.y))
    .toBe(true);

  // chapter 5's deck table is a real table carrying the 9 card rows
  const table = page.locator("#your-first-deck ~ table").first();
  await expect(table).toBeVisible();
  const cardRows = table.locator("tr", {
    has: page.locator("td:first-child"),
  });
  const rows = await table.locator("tr").allInnerTexts();
  const withCounts = rows.filter((r) => /^\d+\*?\t/.test(r));
  expect(withCounts).toHaveLength(9);
  await table.screenshot({ path: "e2e-artifacts/rulebook-deck-table.png" });
  void cardRows;

  // and a chapter-level link works too
  await page.goto("/#/rules/8-strokes-instructions");
  const ch8 = page.locator('[id="8-strokes-instructions"]');
  await expect(ch8).toBeVisible();
  await expect
    .poll(async () => landedAt(page, (await ch8.boundingBox())!.y))
    .toBe(true);
});

test("the deck editor's warnings link into the book at chapter 10", async ({
  page,
}) => {
  await page.goto("/");
  // three Add Panel copies exceed the starting deck's two: the growth caveat
  await page.getByTestId("deck-inc-addpanel").click();
  await expect(page.getByTestId("deck-warnings")).toBeVisible();
  await page.getByTestId("link-ch10").click();
  await expect(page).toHaveURL(/#\/rules\/ch\/10$/);
  const ch10 = page.locator("[data-testid='book-page'] h1", { hasText: /^10\./ });
  await expect(ch10).toBeVisible();
  await expect
    .poll(async () => landedAt(page, (await ch10.boundingBox())!.y))
    .toBe(true);
});

test("three text sizes, applied to the page and remembered", async ({ page }) => {
  await page.goto("/#/rules");
  const pageSize = () =>
    page
      .getByTestId("book-page")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const mid = await pageSize();
  await page.getByTestId("book-size-3").click();
  const big = await pageSize();
  expect(big).toBeGreaterThan(mid);
  await page.getByTestId("book-size-1").click();
  expect(await pageSize()).toBeLessThan(mid);
  await page.reload(); // the choice survives a visit
  await expect(page.getByTestId("book-size-1")).toHaveAttribute("aria-pressed", "true");
  expect(await pageSize()).toBeLessThan(mid);
  await page.getByTestId("book-size-2").click(); // leave the default behind
});

test("search finds a rule and navigates to its section", async ({ page }) => {
  await page.goto("/#/rules");
  if (isNarrow(page)) await page.getByTestId("book-drawer-toggle").click();
  await page.getByTestId("book-search").fill("farmland");
  const hits = page.getByTestId("book-hits").getByRole("link");
  expect(await hits.count()).toBeGreaterThan(0);
  await hits.first().click();
  await expect(page).toHaveURL(/#\/rules\/.+/);
});
