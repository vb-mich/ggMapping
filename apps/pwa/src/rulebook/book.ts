// The Rulebook's library: every book the reader offers, each rendered from
// its single source in /docs, imported at build time. Never a copied second
// file, never a fetch — the deployed app ships the exact books this repo
// carries, and the source-identity tests hash each import against its file.
//
// The books are LISTED, not globbed, on purpose: /docs also holds the repo's
// internal law (CONTRACTS, FORK_NOTES), and a glob would ship a new internal
// document to players by accident. Adding a book is one import and one entry;
// everything else — title, outline, anchors, search — derives from its text.
import GithubSlugger from "github-slugger";
import { marked, type Token, type Tokens } from "marked";

import MASTER_SOURCE from "@book?raw";
import HANDBOOK_SOURCE from "../../../../docs/ggMapping-Players-Handbook.md?raw";

/** The Master Manual's source — kept under its historic name for the
 *  source-identity test and the figure tooling. */
export { MASTER_SOURCE as BOOK_SOURCE };

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
  /** the leading ## before any chapter — a book names itself there */
  title: string;
  chapters: Chapter[];
}

export interface Book {
  id: string;
  source: string;
  outline: Outline;
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

export function buildOutline(src: string): Outline {
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

// --- the library -------------------------------------------------------------
// First entry is the reader's default: the distilled Player's Handbook. The
// Master Manual is the law the simulator is built from; links minted before
// the library existed (bare #/rules/<anchor>) resolve there, because it was
// the only book when they were written.
export const BOOKS: Book[] = [
  { id: "handbook", source: HANDBOOK_SOURCE, outline: buildOutline(HANDBOOK_SOURCE) },
  { id: "master", source: MASTER_SOURCE, outline: buildOutline(MASTER_SOURCE) },
];
export const DEFAULT_BOOK = BOOKS[0];
export const LEGACY_BOOK_ID = "master";

export function bookById(id: string | null | undefined): Book | undefined {
  return BOOKS.find((b) => b.id === id);
}

/** Back-compat for the Master Manual's outline (tests, tools). */
export const outline: Outline = bookById("master")!.outline;

/** Chapter lookup by a book's own numbering ("# 10. Adding new cards"),
 *  for links that must survive a retitle (the deck editor's ch. 10 rider). */
export function chapterByNumber(n: number, book: Book = bookById("master")!): Chapter | undefined {
  return book.outline.chapters.find((c) => c.number === n);
}

export function findHeading(slug: string, book: Book = bookById("master")!): Section | undefined {
  for (const c of book.outline.chapters) {
    if (c.slug === slug) return c;
    for (const s of c.sections) if (s.slug === slug) return s;
  }
  return undefined;
}

// --- the books' figures ------------------------------------------------------
// Authored in Obsidian, whose image embeds are wiki-style: ![[file.png]] and
// ![[file.png|width]]. Every figure ships from docs/img (bundled below, one
// pool for all books); the integrity test keeps reference and file in
// lockstep across the whole library.
const BOOK_IMAGES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob("../../../../docs/img/*", {
      eager: true,
      query: "?url",
      import: "default",
    }) as Record<string, string>,
  ).map(([path, url]) => [path.split("/").pop()!, url]),
);

export const WIKI_EMBED = /!\[\[([^\]|]+?)(?:\|(\d+))?\]\]/g;

/** The Obsidian dialect, resolved: wiki embeds become standard <img> tags
 *  with the bundled URL and the pipe value as display width (a cap — CSS
 *  keeps every figure inside the reading column). Pure: src and the
 *  name→url table in, markdown out; unknown names keep a visible
 *  placeholder for the reader while the integrity test fails the build. */
export function resolveWikiEmbeds(
  src: string,
  images: Record<string, string>,
): string {
  const tag = (rawName: string, width?: string): string => {
    const name = rawName.trim();
    const url = images[name];
    if (!url)
      return `<em class="book-figure">[missing figure: ${name}]</em>`;
    const w = width ? ` width="${width}"` : "";
    return `<img src="${url}" alt="${name}" loading="lazy"${w}>`;
  };
  // A standalone embed line becomes an HTML block — and a raw-HTML block
  // swallows every line until a BLANK one (CommonMark type 6), which would
  // eat a heading sitting right under a figure. The extra newline closes the
  // block; inline embeds stay inline.
  const STANDALONE = new RegExp(
    `^[ \\t]*${WIKI_EMBED.source}[ \\t]*$`,
    "gm",
  );
  return src
    .replace(STANDALONE, (_, name: string, width?: string) => `${tag(name, width)}\n`)
    .replace(WIKI_EMBED, (_, name: string, width?: string) => tag(name, width));
}

// A rendered book. Headings carry the same slugs as its outline; wiki embeds
// resolve to the bundled figures. The SOURCES stay byte-identical — this is
// rendering only.
export function renderBook(book: Book = bookById("master")!): string {
  const slugger = new GithubSlugger();
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }: Tokens.Heading): string => {
    const text = tokens.map(tokenText).join("").trim();
    const inner = marked.Parser.parseInline(tokens);
    if (depth > 2) return `<h${depth}>${inner}</h${depth}>\n`;
    const slug = slugger.slug(text);
    return `<h${depth} id="${slug}">${inner}</h${depth}>\n`;
  };
  // standard markdown images keep working: an img/ path resolves to the
  // same bundled files the wiki embeds use
  renderer.image = ({ href, text }: Tokens.Image): string => {
    const name = decodeURIComponent(href.split("/").pop() ?? "");
    const url = BOOK_IMAGES[name] ?? href;
    return `<img src="${url}" alt="${text}" loading="lazy">`;
  };
  return marked.parse(resolveWikiEmbeds(book.source, BOOK_IMAGES), {
    renderer,
    async: false,
  });
}
