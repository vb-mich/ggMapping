// Act 1.5's e2e law: a sideways photo becomes an upright scan; the note
// survives save, reload, and an edit; the timeline derives the past and
// bookmarks name it without ever touching a scan; the export is the map as
// it was at the selected moment, stitched at true coordinates with 1 px
// gaps, capped inside mobile canvas limits; and the archive round-trips
// byte-identical blobs into a NEW map.
import { readFileSync } from "node:fs";

import { expect, test, type Download, type Page } from "@playwright/test";

import { STRINGS } from "../src/strings";
import { feedFixture, makeFixture, saveScan, scanToFile, scrubTo } from "./mymap-helpers";

// decode a downloaded PNG in the page and sample pixels
async function probePng(
  page: Page,
  download: Download,
  points: [number, number][],
): Promise<{ width: number; height: number; pixels: number[][] }> {
  const buf = readFileSync((await download.path())!);
  return page.evaluate(
    async ({ dataUrl, points }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = dataUrl;
      });
      const cv = document.createElement("canvas");
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
      const g = cv.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return {
        width: cv.width,
        height: cv.height,
        pixels: points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]),
      };
    },
    { dataUrl: `data:image/png;base64,${buf.toString("base64")}`, points },
  );
}

const exportDownload = async (page: Page): Promise<Download> => {
  const dl = page.waitForEvent("download");
  await page.getByTestId("btn-export-png").click();
  return dl;
};

test("a sideways photo becomes an upright scan through the rotate button", async ({
  page,
}, info) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  // the panel photographed sideways: its long axis lies along the photo width
  const t = await makeFixture(page, { W: 600, H: 500 });
  await scanToFileWithRotate(page, t, info.project.name === "mobile");
  const facts = page.getByTestId("rect-facts");
  const w = Number(await facts.getAttribute("data-width"));
  const h = Number(await facts.getAttribute("data-height"));
  // upright again: the rectified scan is the 5:6 panel, not the 6:5 photo
  expect(Math.abs(w / h - 5 / 6)).toBeLessThan((5 / 6) * 0.05);
  await page.getByTestId("btn-to-file").click();
  await saveScan(page);
  await expect(page.getByTestId("atlas-cell-1,1")).toBeVisible();
});

async function scanToFileWithRotate(page: Page, t: Awaited<ReturnType<typeof makeFixture>>, shot: boolean) {
  await feedFixture(page, t);
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "crop");
  await page.getByTestId("btn-rotate").click();
  if (shot) await page.screenshot({ path: "e2e-artifacts/mymap-rotate.png" });
  await page.getByTestId("btn-straighten").click();
  await expect(page.getByTestId("scan-flow")).toHaveAttribute("data-stage", "adjust", {
    timeout: 20_000,
  });
}

test("the note survives save, reload, and an edit", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  const t = await makeFixture(page);
  await scanToFile(page, t);
  await page.getByTestId("input-scan-note").fill("before the rework");
  await saveScan(page);

  await page.getByTestId("atlas-cell-1,1").click();
  await expect(page.getByTestId("panel-meta")).toContainText("before the rework");

  // a reload keeps the panel route — the app reopens straight onto the panel
  await page.reload();
  await expect(page.getByTestId("panel-meta")).toContainText("before the rework");

  await page.getByTestId("btn-edit-note").click();
  await page.getByTestId("input-edit-note").fill("after the rework, day two");
  await page.getByTestId("btn-save-note").click();
  await expect(page.getByTestId("panel-meta")).toContainText("after the rework, day two");
  await expect(page.getByTestId("version-row-0")).toContainText("after the rework, day two");

  await page.reload();
  await expect(page.getByTestId("panel-meta")).toContainText("after the rework, day two");
});

test("the timeline derives the past, and bookmarks name it without touching scans", async ({
  page,
}, info) => {
  await page.goto("/#/map");
  // two faces of one panel
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  const cell = page.getByTestId("atlas-cell-1,1");
  const id1 = await cell.getAttribute("data-scan");

  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page, { paper: "#b8c8ee" }));
  await page.getByTestId("coord-e-down").click(); // back onto N1/E1
  await saveScan(page);
  const id2 = await cell.getAttribute("data-scan");
  expect(id2).not.toBe(id1);

  // now is now
  await expect(page.getByTestId("timeline-chip")).toHaveAttribute("data-past", "false");

  // scrub to the first moment: the older face returns
  await scrubTo(page, "min");
  await expect(page.getByTestId("timeline-chip")).toHaveAttribute("data-past", "true");
  await expect(cell).toHaveAttribute("data-scan", id1!);

  // name the moment; the tick and the chip appear
  await page.getByTestId("btn-mark-moment").click();
  await page.getByTestId("input-moment-name").fill("the early days");
  await page.getByTestId("btn-moment-save").click();
  await expect(page.getByTestId("tick-the early days")).toBeVisible();
  if (info.project.name === "mobile") {
    await page.getByTestId("timeline").screenshot({ path: "e2e-artifacts/mymap-timeline.png" });
  }

  // back to now, then seek the bookmark
  await scrubTo(page, "max");
  await expect(cell).toHaveAttribute("data-scan", id2!);
  await page.getByTestId("moment-0").click();
  await expect(page.getByTestId("timeline-chip")).toHaveAttribute("data-past", "true");
  await expect(cell).toHaveAttribute("data-scan", id1!);

  // deleting the bookmark deletes a name, never a scan
  await page.getByTestId("btn-moment-del-0").click();
  await expect(page.getByTestId("tick-the early days")).toHaveCount(0);
  await scrubTo(page, "max");
  await expect(page.getByTestId("mm-footer")).toContainText("2 scans");
  await expect(cell).toHaveAttribute("data-scan", id2!);

  // and the scan delete confirmation now warns about the timeline
  await cell.click();
  await page.getByTestId("btn-delete-0").click();
  await expect(page.getByTestId("delete-confirm")).toContainText(
    STRINGS.mmDeleteTimelineWarn,
  );
});

test("the export honors the timeline and the stitched geometry", async ({ page }, info) => {
  await page.goto("/#/map");
  // v1 of N1/E1, warm paper — then a bookmark on that moment
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await scrubTo(page, "min");
  await page.getByTestId("btn-mark-moment").click();
  await page.getByTestId("input-moment-name").fill("the early days");
  await page.getByTestId("btn-moment-save").click();
  await scrubTo(page, "max");

  // v2 of N1/E1 in blue, then two more panels: N1/E2 and S1/E2
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page, { paper: "#8ea6e8" }));
  await page.getByTestId("coord-e-down").click();
  await saveScan(page);
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page); // N1/E2, the default next-neighbor
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await page.getByTestId("coord-n-down").click(); // N1/E3 → S1/E3
  await page.getByTestId("coord-e-down").click(); // → S1/E2
  await saveScan(page);

  // export at NOW, low quality: 2×2 grid with one gap at S1/E1
  await page.getByTestId("export-quality").selectOption("low");
  const nowDl = await exportDownload(page);
  expect(nowDl.suggestedFilename()).toBe("My first map.png");
  // cell sizes derive from the scans; read them off the file (2 cols + 1 gap)
  const dims = await probePng(page, nowDl, [[0, 0]]);
  const cellW = (dims.width - 1) / 2;
  const cellH = (dims.height - 1) / 2;
  expect(Number.isInteger(cellW)).toBe(true); // 2 cells + exactly one 1 px gap
  expect(Number.isInteger(cellH)).toBe(true);
  expect(Math.abs(cellW - 213)).toBeLessThanOrEqual(3); // the thumbs' size
  expect(Math.abs(cellH - 256)).toBeLessThanOrEqual(3);
  const cx = Math.round(cellW / 2);
  const cy = Math.round(cellH / 2);
  const now = await probePng(page, nowDl, [
    [cx, cy], // N1/E1 center: the BLUE v2
    [cellW, cy], // the 1 px gap column: app background
    [cellW + 1 + cx, cy], // N1/E2 center: warm paper
    [cx, cellH + 1 + cy], // S1/E1: an empty cell — background
    [cellW + 1 + cx, cellH + 1 + cy], // S1/E2 center: warm paper
  ]);
  const [ne1, gap, ne2, s1e1, s1e2] = now.pixels;
  expect(ne1[2]).toBeGreaterThan(ne1[0] + 20); // blue face
  expect(gap.slice(0, 3)).toEqual([23, 21, 18]); // --bg of the dark theme
  expect(s1e1.slice(0, 3)).toEqual([23, 21, 18]); // the gap panel too
  expect(ne2[0]).toBeGreaterThanOrEqual(ne2[2]); // warm face
  expect(s1e2[0]).toBeGreaterThanOrEqual(s1e2[2]);
  expect(await page.getByTestId("export-note").count()).toBe(0); // no cap talk

  // transparent gaps: the gap pixel carries no paint at all
  await page.getByTestId("export-transparent").check();
  const clearDl = await exportDownload(page);
  const clear = await probePng(page, clearDl, [[cellW, cy]]);
  expect(clear.pixels[0][3]).toBe(0);
  await page.getByTestId("export-transparent").uncheck();

  // seek the bookmark and export THAT map: one panel, the warm v1, named file
  await page.getByTestId("moment-0").click();
  const pastDl = await exportDownload(page);
  expect(pastDl.suggestedFilename()).toBe("My first map - the early days.png");
  const past = await probePng(page, pastDl, [[cx, cy]]);
  expect(Math.abs(past.width - cellW)).toBeLessThanOrEqual(3); // one panel then
  expect(Math.abs(past.height - cellH)).toBeLessThanOrEqual(3);
  expect(past.pixels[0][0]).toBeGreaterThanOrEqual(past.pixels[0][2]); // warm v1
  if (info.project.name === "mobile") {
    const fs = await import("node:fs");
    fs.copyFileSync((await pastDl.path())!, "e2e-artifacts/mymap-export-past.png");
    fs.copyFileSync((await nowDl.path())!, "e2e-artifacts/mymap-export.png");
  }
});

test("the cap engages on an oversized map without crashing", async ({ page }) => {
  await page.goto("/#/map");
  // a map too wide for one canvas: four full-size panels in a row, injected
  // straight into the archive (drawing them through the flow would dominate
  // the suite's runtime without testing anything new)
  await page.evaluate(async () => {
    const open = indexedDB.open("jm-digitalizer");
    const db = await new Promise<IDBDatabase>((res, rej) => {
      open.onsuccess = () => res(open.result);
      open.onerror = () => rej(open.error);
    });
    const settings = db.transaction("settings", "readonly").objectStore("settings");
    const cur = await new Promise<{ value: string } | undefined>((res, rej) => {
      const r = settings.get("currentMapId");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const mapId = cur!.value;
    const makeBlob = (w: number, h: number, color: string) =>
      new Promise<Blob>((res) => {
        const cv = document.createElement("canvas");
        cv.width = w;
        cv.height = h;
        const g = cv.getContext("2d")!;
        g.fillStyle = color;
        g.fillRect(0, 0, w, h);
        cv.toBlob((b) => res(b!), "image/webp", 0.8);
      });
    for (let tx = 1; tx <= 4; tx++) {
      const image = await makeBlob(1333, 1600, ["#a33", "#3a3", "#33a", "#aa3"][tx - 1]);
      const thumb = await makeBlob(213, 256, "#888");
      await new Promise<void>((res, rej) => {
        const t = db.transaction("scans", "readwrite");
        t.objectStore("scans").add({
          id: `big-${tx}`,
          mapId,
          tx,
          ty: 1,
          created: 1000 + tx,
          note: "",
          sync: "local",
          mime: "image/webp",
          width: 1333,
          height: 1600,
          bytes: image.size,
          image,
          thumb,
        });
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
      });
    }
    db.close();
  });
  await page.reload();
  await expect(page.getByTestId("mm-footer")).toContainText("4 scans");

  const dl = page.waitForEvent("download");
  await page.getByTestId("btn-export-png").click(); // full quality
  const download = await dl;
  await expect(page.getByTestId("export-note")).toContainText(STRINGS.mmCapEngaged, {
    timeout: 30_000,
  });
  const probed = await probePng(page, download, [[10, 10]]);
  expect(Math.max(probed.width, probed.height)).toBeLessThanOrEqual(4096);
  expect(Math.max(probed.width, probed.height)).toBeGreaterThan(3800); // capped, not crushed
});

test("the archive round-trips byte-identical blobs into a new map", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await page.getByTestId("input-scan-note").fill("carry me across");
  await saveScan(page);
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page, { paper: "#b8c8ee" }));
  await saveScan(page);
  await page.getByTestId("btn-mark-moment").click();
  await page.getByTestId("input-moment-name").fill("shipped");
  await page.getByTestId("btn-moment-save").click();

  const hashesOf = () =>
    page.evaluate(async () => {
      const open = indexedDB.open("jm-digitalizer");
      const db = await new Promise<IDBDatabase>((res, rej) => {
        open.onsuccess = () => res(open.result);
        open.onerror = () => rej(open.error);
      });
      const cur = await new Promise<{ value: string }>((res, rej) => {
        const r = db.transaction("settings", "readonly").objectStore("settings").get("currentMapId");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const scans = await new Promise<{ mapId: string; image: Blob }[]>((res, rej) => {
        const r = db.transaction("scans", "readonly").objectStore("scans").getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();
      const mine = scans.filter((s) => s.mapId === cur.value);
      const out: string[] = [];
      for (const s of mine) {
        const digest = await crypto.subtle.digest("SHA-256", await s.image.arrayBuffer());
        out.push([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join(""));
      }
      return out.sort();
    });

  const original = await hashesOf();
  expect(original).toHaveLength(2);

  // backups live on the profile's maps page now
  await page.getByTestId("btn-profile").click();
  await page.getByTestId("btn-pf-maps").click();
  await expect(page.getByTestId("maps-page")).toBeVisible();

  const dl = page.waitForEvent("download");
  await page.getByTestId("btn-backup-current").click();
  const download = await dl;
  expect(download.suggestedFilename()).toContain("backup.zip");
  const zipPath = (await download.path())!;

  await page.setInputFiles('[data-testid="input-restore"]', zipPath);
  const notice = page.getByTestId("mm-notice");
  await expect(notice).toContainText("Restored 1 map", { timeout: 20_000 });
  // the restore landed in a NEW, now-current map — never a merge
  await expect(page.getByTestId("map-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("map-row-1")).toContainText("My first map (restored)");
  await expect(page.getByTestId("map-row-1")).toContainText("current");

  await page.goto("/#/map");
  const names = await page
    .getByTestId("map-select")
    .locator("option")
    .allTextContents();
  expect(names).toContain("My first map");
  expect(names).toContain("My first map (restored)");
  const restored = await hashesOf();
  expect(restored).toEqual(original); // byte-identical blobs
  // the bookmark and the note crossed too
  await expect(page.getByTestId("moment-0")).toContainText("shipped");
  await page.getByTestId("atlas-cell-1,1").click();
  await expect(page.getByTestId("panel-meta")).toContainText("carry me across");
  await page.getByTestId("btn-back-atlas").click();

  // corrupt input: a sentence, and nothing changes
  await page.goto("/#/profile/maps");
  await page.setInputFiles('[data-testid="input-restore"]', {
    name: "bad.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(new Uint8Array(500).map((_, i) => (i * 89) % 256)),
  });
  await expect(page.getByTestId("mm-notice")).toContainText("not a backup");
  await expect(page.getByTestId("map-list").locator("li")).toHaveCount(2);
});

test("playback walks the updates at the profile's speed", async ({ page }) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page, { paper: "#b8c8ee" }));
  await page.getByTestId("coord-e-down").click();
  await saveScan(page);

  // set a faster speed on the profile's playback page — and check the
  // back arrows walk out the way they came
  await page.getByTestId("btn-profile").click();
  await expect(page.getByTestId("profile-menu")).toBeVisible();
  // the gear is a toggle: tapping it again steps back out, and in again
  await page.getByTestId("btn-profile").click();
  await expect(page.getByTestId("timeline")).toBeVisible();
  await page.getByTestId("btn-profile").click();
  await expect(page.getByTestId("profile-menu")).toBeVisible();
  await page.getByTestId("btn-pf-playback").click();
  await expect(page.getByTestId("playback-page")).toBeVisible();
  await expect(page.getByTestId("speed-500")).toBeChecked(); // the default
  await page.getByTestId("speed-250").check();
  await page.getByTestId("btn-playback-back").click();
  await expect(page.getByTestId("profile-menu")).toBeVisible();
  await page.getByTestId("btn-profile-back").click();
  await expect(page.getByTestId("timeline")).toBeVisible();

  // the speed survives a reload (it is a stored setting)
  await page.reload();
  await page.goto("/#/profile/playback");
  await expect(page.getByTestId("speed-250")).toBeChecked();
  await page.goto("/#/map");
  const chip = page.getByTestId("timeline-chip");
  await expect(chip).toHaveAttribute("data-past", "false");

  // play: from now it replays from the first update and returns to now
  await page.getByTestId("btn-play").click();
  await expect(chip).toHaveAttribute("data-past", "true");
  await expect(chip).toHaveAttribute("data-past", "false", { timeout: 5_000 });
});

test("the maps page creates, renames, and deletes maps with everything they hold", async ({
  page,
}) => {
  await page.goto("/#/map");
  await page.getByTestId("btn-scan").click();
  await scanToFile(page, await makeFixture(page));
  await saveScan(page);
  await expect(page.getByTestId("mm-footer")).toContainText("1 scan ·");

  await page.getByTestId("btn-profile").click();
  await page.getByTestId("btn-pf-maps").click();
  const rows = page.getByTestId("map-list").locator("li");
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("map-row-0")).toContainText("My first map");
  await expect(page.getByTestId("map-row-0")).toContainText("1 scan");
  await expect(page.getByTestId("map-row-0")).toContainText("current");

  // create: the new map becomes current
  await page.getByTestId("btn-pf-new-map").click();
  await page.getByTestId("input-pf-map-name").fill("Second table");
  await page.getByTestId("btn-pf-map-create").click();
  await expect(rows).toHaveCount(2);
  await expect(page.getByTestId("map-row-1")).toContainText("Second table");
  await expect(page.getByTestId("map-row-1")).toContainText("current");

  // rename
  await page.getByTestId("btn-rename-map-1").click();
  await page.getByTestId("input-rename-1").fill("The second table");
  await page.getByTestId("btn-rename-save-1").click();
  await expect(page.getByTestId("map-row-1")).toContainText("The second table");

  // delete the first map: the confirmation names it and its scans, and the
  // deletion takes the scans with it
  await page.getByTestId("btn-delete-map-0").click();
  const confirm = page.getByTestId("map-delete-confirm");
  await expect(confirm).toContainText("My first map");
  await expect(confirm).toContainText("1 scan");
  await expect(confirm).toContainText("forever");
  await page.getByTestId("btn-delete-map-cancel-0").click();
  await expect(confirm).toHaveCount(0);
  await page.getByTestId("btn-delete-map-0").click();
  await page.getByTestId("btn-delete-map-forever-0").click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByTestId("map-row-0")).toContainText("The second table");

  // back on the atlas: only the survivor, and the device holds no scans
  await page.getByTestId("btn-maps-back").click();
  await page.getByTestId("btn-profile-back").click();
  await expect(page.getByTestId("mm-footer")).toContainText("0 scans");
  await expect(page.getByTestId("atlas-empty")).toBeVisible();
  const names = await page.getByTestId("map-select").locator("option").allTextContents();
  expect(names).toEqual(["The second table"]);
});
