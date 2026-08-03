// The Rulebook's single source: docs/0-Jerrymapping-the-game.md, THE authority
// file, imported at build time. Never a copied second file, never a fetch —
// the deployed app ships the exact book its engine obeys, so badge, engine,
// and handbook are one sealed unit per lineage. When a package replaces the
// docs, the reader updates by rebuild with zero extra process. The
// source-identity test hashes this import against the file on disk.
import GithubSlugger from "github-slugger";
import { marked, type Token, type Tokens } from "marked";

import BOOK_SOURCE from "@book?raw";

export { BOOK_SOURCE };

export interface Section {
  slug: string;
  text: string;
  /** searchable plain text of everything under this heading */
  body: string;
}

export interface Chapter extends Section {
  /** the "N" of "# N. Title" headings, null when a chapter carries none */
  number: number | null;
  sections: Section[];
}

export interface Outline {
  /** the leading ## before any chapter — the handbook names itself there */
  title: string;
  chapters: Chapter[];
}

// One slugger pass for the outline, one for the renderer, reset in lockstep:
// the ids in the HTML and the hrefs in the outline must agree even if two
// headings ever share a text (github-slugger then suffixes -1, -2 in order).
function tokenText(t: Token): string {
  const withTokens = t as { tokens?: Token[]; text?: string };
  if (withTokens.tokens?.length)
    return withTokens.tokens.map(tokenText).join("");
  return withTokens.text ?? ("raw" in t ? (t.raw as string) : "");
}

function plainText(tokens: Token[]): string {
  return tokens
    .map((t) => (t.type === "heading" ? "" : tokenText(t)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOutline(src: string): Outline {
  const slugger = new GithubSlugger();
  const tokens = marked.lexer(src);
  const outline: Outline = { title: "", chapters: [] };
  let current: Chapter | null = null;
  let currentSection: Section | null = null;
  let bucket: Token[] = [];

  const flush = () => {
    const text = plainText(bucket);
    if (currentSection) currentSection.body += text;
    else if (current) current.body += text;
    bucket = [];
  };

  for (const t of tokens) {
    if (t.type === "heading" && (t.depth === 1 || t.depth === 2)) {
      flush();
      const heading = t as Tokens.Heading;
      const text = tokenText(heading).trim();
      const slug = slugger.slug(text);
      if (heading.depth === 1) {
        const m = /^(\d+)\./.exec(text);
        current = {
          slug,
          text,
          body: "",
          number: m ? Number(m[1]) : null,
          sections: [],
        };
        currentSection = null;
        outline.chapters.push(current);
      } else if (!current) {
        // a ## before any chapter: the book's own title line
        outline.title = text;
      } else {
        currentSection = { slug, text, body: "" };
        current.sections.push(currentSection);
      }
      continue;
    }
    bucket.push(t);
  }
  flush();
  return outline;
}

export const outline: Outline = buildOutline(BOOK_SOURCE);

/** Chapter lookup by the book's own numbering ("# 10. Adding new cards"),
 *  for links that must survive a retitle (the deck editor's ch. 10 rider). */
export function chapterByNumber(n: number): Chapter | undefined {
  return outline.chapters.find((c) => c.number === n);
}

export function findHeading(slug: string): Section | undefined {
  for (const c of outline.chapters) {
    if (c.slug === slug) return c;
    for (const s of c.sections) if (s.slug === slug) return s;
  }
  return undefined;
}

// The rendered book. Headings carry the same slugs as the outline; the
// handbook's Obsidian image embeds (![[name]]) reference vault files that do
// not ship with the repo, so they render as a labeled placeholder rather than
// literal brackets. The SOURCE stays byte-identical — this is rendering only.
export function renderBook(): string {
  const slugger = new GithubSlugger();
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }: Tokens.Heading): string => {
    const text = tokens.map(tokenText).join("").trim();
    const inner = marked.Parser.parseInline(tokens);
    if (depth > 2) return `<h${depth}>${inner}</h${depth}>\n`;
    const slug = slugger.slug(text);
    return `<h${depth} id="${slug}">${inner}</h${depth}>\n`;
  };
  const src = BOOK_SOURCE.replace(
    /!\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g,
    (_, name: string) =>
      `<em class="book-figure">[illustration in the handbook's vault: ${name.trim()}]</em>`,
  );
  return marked.parse(src, { renderer, async: false });
}
