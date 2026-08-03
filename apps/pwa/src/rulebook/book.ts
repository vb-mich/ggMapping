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

// --- the handbook's figures --------------------------------------------------
// The book is authored in Obsidian, whose image embeds are wiki-style:
// ![[file.png]] and ![[file.png|width]]. Every figure ships from docs/img
// (bundled below, so the deployed app carries the book's own pictures); the
// integrity test keeps reference and file in lockstep.
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

// The rendered book. Headings carry the same slugs as the outline; wiki
// embeds resolve to the bundled figures. The SOURCE stays byte-identical —
// this is rendering only.
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
  // standard markdown images keep working: an img/ path resolves to the
  // same bundled files the wiki embeds use
  renderer.image = ({ href, text }: Tokens.Image): string => {
    const name = decodeURIComponent(href.split("/").pop() ?? "");
    const url = BOOK_IMAGES[name] ?? href;
    return `<img src="${url}" alt="${text}" loading="lazy">`;
  };
  return marked.parse(resolveWikiEmbeds(BOOK_SOURCE, BOOK_IMAGES), {
    renderer,
    async: false,
  });
}
