// The Rulebook is the route's own chunk, never the shell's: the book and its
// parser load only when the reader opens. Asserted over the real build.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const APP = join(__dirname, "..");
const DIST = join(APP, "dist");

// a phrase only the handbook contains, and a signature only marked contains
const BOOK_PHRASE = "Player's Handbook";
const PARSER_SIGNATURE = "inlineTokens";

describe("the reader chunk is lazy", () => {
  it("keeps the book and its parser out of the shell bundle", () => {
    if (!existsSync(DIST)) return; // unit runs may precede a build
    const entry = /src="[^"]*\/(index-[^"]+\.js)"/.exec(
      readFileSync(join(DIST, "index.html"), "utf8"),
    )?.[1];
    expect(entry).toBeTruthy();
    const shell = readFileSync(join(DIST, "assets", entry!), "utf8");
    expect(shell).not.toContain(BOOK_PHRASE);
    expect(shell).not.toContain(PARSER_SIGNATURE);

    // and they live together in exactly one other chunk — the reader's
    const chunks = readdirSync(join(DIST, "assets")).filter(
      (f) => f.endsWith(".js") && f !== entry,
    );
    const carriers = chunks.filter((f) =>
      readFileSync(join(DIST, "assets", f), "utf8").includes(BOOK_PHRASE),
    );
    expect(carriers).toHaveLength(1);
    expect(carriers[0]).toMatch(/^Rulebook-/);
  });
});
