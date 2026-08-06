// The Rulebook reader's law: it renders THE authority file, not a copy.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOOKS,
  BOOK_SOURCE,
  bookById,
  chapterByNumber,
  findHeading,
  outline,
  renderBook,
} from "../src/rulebook/book";

// each book's authority file on disk, by its library id (docs/books is the
// books' own shelf — the rest of docs/ is the repo's internal law)
const BOOK_FILES: Record<string, string> = {
  handbook: "0-ggMapping-Players-Handbook.md",
  master: "0-Jerrymapping-the-game.md",
};

const DOCS_DIR = join(__dirname, "..", "..", "..", "docs", "books");
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

describe("the rulebook's single source", () => {
  it("renders every book byte-derived from its authority file in docs/", () => {
    // A copied or stale book fails here: each build-time import must hash
    // identically to its file. (Both sides are LF by .gitattributes;
    // normalize anyway so a Windows checkout quirk cannot masquerade as a
    // content difference.)
    expect(Object.keys(BOOK_FILES).sort()).toEqual(
      BOOKS.map((b) => b.id).sort(), // a new book must register here too
    );
    for (const b of BOOKS) {
      const disk = readFileSync(join(DOCS_DIR, BOOK_FILES[b.id]), "utf8")
        .replace(/\r\n/g, "\n");
      expect(sha(b.source.replace(/\r\n/g, "\n")), b.id).toBe(sha(disk));
    }
    // the exported master source is the master book's, verbatim
    expect(BOOK_SOURCE).toBe(bookById("master")!.source);
    // and the default the tab opens is the player's book
    expect(BOOKS[0].id).toBe("handbook");
  });

  it("builds each outline from its file's actual headings, count and text", () => {
    // Independent census: the raw files, not the module's parser. The books
    // have no code fences (asserted), so line-anchored regexes are exact.
    for (const b of BOOKS) {
      const disk = readFileSync(join(DOCS_DIR, BOOK_FILES[b.id]), "utf8")
        .replace(/\r\n/g, "\n");
      expect(disk, b.id).not.toMatch(/^```/m);
      const lines = disk.split("\n");
      const h1 = lines.filter((l) => /^# /.test(l)).map((l) => l.slice(2).trim());
      const h2 = lines.filter((l) => /^## /.test(l)).map((l) => l.slice(3).trim());

      expect(b.outline.chapters.map((c) => c.text), b.id).toEqual(h1);
      // the first ## precedes every chapter: it is the book naming itself
      expect(b.outline.title, b.id).toBe(h2[0]);
      expect(b.outline.title.length, b.id).toBeGreaterThan(0);
      const sections = b.outline.chapters.flatMap((c) => c.sections.map((s) => s.text));
      expect(sections, b.id).toEqual(h2.slice(1));
    }
    // the outline export still names the master's chapters (tooling contract)
    expect(outline.title).toContain("Master");
    // the two books introduce themselves apart: a selector needs real names
    expect(bookById("handbook")!.outline.title).not.toBe(
      bookById("master")!.outline.title,
    );
  });

  it("gives every heading a unique slug the rendered HTML carries", () => {
    for (const b of BOOKS) {
      const slugs = [
        ...b.outline.chapters.map((c) => c.slug),
        ...b.outline.chapters.flatMap((c) => c.sections.map((s) => s.slug)),
      ];
      expect(new Set(slugs).size, b.id).toBe(slugs.length);
      const html = renderBook(b);
      for (const slug of slugs) expect(html, b.id).toContain(`id="${slug}"`);
    }
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

  it("resolves every Obsidian embed to a real image, none missing", () => {
    expect(BOOK_SOURCE).toContain("![["); // the source keeps them (identity)
    const html = renderBook();
    expect(html).not.toContain("![[");
    expect(html).not.toContain("missing figure");
    const embeds = BOOK_SOURCE.match(/!\[\[/g)?.length ?? 0;
    expect((html.match(/<img /g) ?? []).length).toBeGreaterThanOrEqual(embeds);
    // the width pipe becomes a display width on its figure
    expect(html).toMatch(/<img [^>]*width="697"/);
  });
});
