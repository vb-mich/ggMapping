// The Rulebook reader's law: it renders THE authority file, not a copy.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOOK_SOURCE,
  chapterByNumber,
  findHeading,
  outline,
  renderBook,
} from "../src/rulebook/book";

const DOCS = join(__dirname, "..", "..", "..", "docs", "0-Jerrymapping-the-game.md");
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

describe("the rulebook's single source", () => {
  it("renders content byte-derived from docs/0-Jerrymapping-the-game.md", () => {
    // A copied or stale book fails here: the reader's build-time import must
    // hash identically to the authority file in docs/. (Both sides are LF by
    // .gitattributes; normalize anyway so a Windows checkout quirk cannot
    // masquerade as a content difference.)
    const disk = readFileSync(DOCS, "utf8").replace(/\r\n/g, "\n");
    const imported = BOOK_SOURCE.replace(/\r\n/g, "\n");
    expect(sha(imported)).toBe(sha(disk));
  });

  it("builds the outline from the file's actual headings, count and text", () => {
    // Independent census: the raw file, not the module's parser. The book has
    // no code fences (asserted), so line-anchored heading regexes are exact.
    const disk = readFileSync(DOCS, "utf8").replace(/\r\n/g, "\n");
    expect(disk).not.toMatch(/^```/m); // fences would break the census below
    const lines = disk.split("\n");
    const h1 = lines.filter((l) => /^# /.test(l)).map((l) => l.slice(2).trim());
    const h2 = lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());

    expect(outline.chapters.map((c) => c.text)).toEqual(h1);
    // the first ## precedes every chapter: it is the book naming itself
    expect(outline.title).toBe(h2[0]);
    expect(outline.title.length).toBeGreaterThan(0);
    const sections = outline.chapters.flatMap((c) => c.sections.map((s) => s.text));
    expect(sections).toEqual(h2.slice(1));
    expect(outline.chapters.length + sections.length + 1).toBe(h1.length + h2.length);
  });

  it("gives every heading a unique slug the rendered HTML carries", () => {
    const slugs = [
      ...outline.chapters.map((c) => c.slug),
      ...outline.chapters.flatMap((c) => c.sections.map((s) => s.slug)),
    ];
    expect(new Set(slugs).size).toBe(slugs.length);
    const html = renderBook();
    for (const slug of slugs) expect(html).toContain(`id="${slug}"`);
  });

  it("renders chapter 5's deck table as a real table with its 9 card rows", () => {
    const html = renderBook();
    const five = chapterByNumber(5);
    expect(five).toBeTruthy();
    const after = html.slice(html.indexOf(`id="${five!.slug}"`));
    const table = /<table>[\s\S]*?<\/table>/.exec(after)?.[0] ?? "";
    const rows = table.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
    expect(table.match(/<th>/g)?.length).toBe(4); // Copies|Work|Mood|Instruction
    // The 9 card rows open with a copies count. (GFM absorbs the book's
    // \*-footnote line as a tenth, single-value row — GitHub renders the
    // authored table exactly the same way, and the file is the authority.)
    const cardRows = rows.filter((r) => /^<tr>\s*<td>\d+\*?<\/td>/.test(r));
    expect(cardRows.length).toBe(9);
    for (const name of ["Extend", "Basin", "Ridge", "Great Ridge", "Free Stroke",
                        "Settlement", "Anomaly", "Add Panel"])
      expect(table).toContain(name);
  });

  it("resolves chapters by their book number, for retitle-proof links", () => {
    const ten = chapterByNumber(10);
    expect(ten?.text).toMatch(/^10\./);
    expect(findHeading(ten!.slug)).toBe(ten);
  });

  it("does not leak Obsidian embed brackets into the rendering", () => {
    expect(BOOK_SOURCE).toContain("![["); // the source keeps them (identity)
    expect(renderBook()).not.toContain("![[");
  });
});
