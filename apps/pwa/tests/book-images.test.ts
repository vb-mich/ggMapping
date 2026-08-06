// The handbook's figures: the Obsidian dialect resolves to bundled images,
// and reference and file can never drift apart (the integrity test).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveWikiEmbeds, WIKI_EMBED } from "../src/rulebook/book";

const DOCS = join(__dirname, "..", "..", "..", "docs", "books");
const URLS = { "map-dial.png": "/a/map-dial.hash.png",
               "with space.png": "/a/with-space.hash.png" };

describe("the Obsidian embed transform (pure)", () => {
  it("resolves a plain wiki embed to a standard image", () => {
    expect(resolveWikiEmbeds("see ![[map-dial.png]] here", URLS)).toBe(
      'see <img src="/a/map-dial.hash.png" alt="map-dial.png" loading="lazy"> here',
    );
  });
  it("carries the width pipe as a display width", () => {
    // a standalone embed line also gains the block-closing newline
    expect(resolveWikiEmbeds("![[map-dial.png|262]]", URLS)).toBe(
      '<img src="/a/map-dial.hash.png" alt="map-dial.png" loading="lazy" width="262">\n',
    );
  });
  it("handles names containing spaces", () => {
    expect(resolveWikiEmbeds("![[with space.png|40]]", URLS)).toContain(
      'src="/a/with-space.hash.png" alt="with space.png" loading="lazy" width="40"',
    );
  });
  it("leaves standard markdown images untouched", () => {
    const std = "before ![alt text](img/map-dial.png) after";
    expect(resolveWikiEmbeds(std, URLS)).toBe(std);
  });
  it("keeps a heading below a standalone figure out of the HTML block", () => {
    // a raw-HTML block runs to the next blank line; without the transform's
    // re-established boundary, "# H" would be swallowed into the figure
    const out = resolveWikiEmbeds("![[map-dial.png]]\n# H", URLS);
    expect(out).toMatch(/>\n\n# H$/);
  });
  it("marks an unknown name as a visible missing figure", () => {
    expect(resolveWikiEmbeds("![[nowhere.png]]", URLS)).toBe(
      '<em class="book-figure">[missing figure: nowhere.png]</em>\n',
    );
  });
});

describe("the figure integrity test (permanent)", () => {
  const book = readFileSync(join(DOCS, "0-Jerrymapping-the-game.md"), "utf8")
    .replace(/\r\n/g, "\n");
  const bundled = readdirSync(join(DOCS, "img"));

  it("every figure the book references is a bundled file", () => {
    // both syntaxes, with the line number for the report when one is missing
    const missing: string[] = [];
    const referenced = new Set<string>();
    book.split("\n").forEach((line, i) => {
      for (const m of line.matchAll(new RegExp(WIKI_EMBED.source, "g"))) {
        const name = m[1].trim();
        referenced.add(name);
        if (!bundled.includes(name)) missing.push(`line ${i + 1}: ![[${name}]]`);
      }
      for (const m of line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        const name = decodeURIComponent(m[1].split("/").pop() ?? "");
        referenced.add(name);
        if (!bundled.includes(name))
          missing.push(`line ${i + 1}: ![](${m[1]})`);
      }
    });
    expect(missing, missing.join("; ")).toEqual([]);

    // the other direction is a warning, not a failure: a spare file breaks
    // nothing, but it usually means a reference was meant to point at it
    const unreferenced = bundled.filter((f) => !referenced.has(f));
    if (unreferenced.length)
      console.warn(
        `[book-images] bundled but unreferenced: ${unreferenced.join(", ")}`,
      );
  });
});
