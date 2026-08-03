// The Rulebook reader: the handbook rendered from its single source (book.ts),
// an outline built from the file's own headings, and deep links per heading.
// Desktop shows the outline as a sidebar; a phone folds it into a drawer.
import { effect, signal, useComputed, useSignal } from "@preact/signals";
import { useEffect, useMemo, useRef } from "preact/hooks";

import { applyTheme, engineLineage, theme } from "../state";
import { go, rulesHash, type Route } from "../router";
import { STRINGS } from "../strings";
import { chapterByNumber, findHeading, outline, renderBook, type Section } from "./book";

// --- reading comfort ---------------------------------------------------------
// Three classic sizes, persisted; the class scales the whole page (em-based).
type BookSize = 1 | 2 | 3;
const SIZE_KEY = "jm-book-size";
const stored = Number(localStorage.getItem(SIZE_KEY));
export const bookSize = signal<BookSize>(
  stored === 1 || stored === 3 ? (stored as BookSize) : 2,
);
effect(() => localStorage.setItem(SIZE_KEY, String(bookSize.value)));

// One rendering per viewport class (no duplicate controls in the DOM): the
// phone gets a sticky bar, the desk gets the controls in the book's own head.
const narrowQuery = window.matchMedia("(max-width: 899px)");
const narrow = signal(narrowQuery.matches);
narrowQuery.addEventListener("change", (e) => (narrow.value = e.matches));

function SizeSwitch() {
  return (
    <span class="book-size-switch" role="group" aria-label={STRINGS.rbTextSize}>
      {([1, 2, 3] as const).map((n) => (
        <button
          key={n}
          class={bookSize.value === n ? `ghost size-${n} active` : `ghost size-${n}`}
          data-testid={`book-size-${n}`}
          title={STRINGS.rbTextSize}
          aria-pressed={bookSize.value === n}
          onClick={() => (bookSize.value = n)}
        >
          A
        </button>
      ))}
    </span>
  );
}

interface Hit {
  slug: string;
  where: string; // "chapter" or "chapter › section"
  count: number;
}

function searchBook(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  const count = (hay: string) => {
    let n = 0;
    const h = hay.toLowerCase();
    for (let i = h.indexOf(q); i !== -1; i = h.indexOf(q, i + q.length)) n++;
    return n;
  };
  for (const c of outline.chapters) {
    const own = count(c.body) + count(c.text);
    if (own) hits.push({ slug: c.slug, where: c.text, count: own });
    for (const s of c.sections) {
      const n = count(s.body) + count(s.text);
      if (n) hits.push({ slug: s.slug, where: `${c.text} › ${s.text}`, count: n });
    }
  }
  return hits;
}

/** The anchor a route names: a heading slug, or ch/<n> by book numbering. */
function resolveAnchor(anchor: string | null): Section | null {
  if (!anchor) return null;
  const byNumber = /^ch\/(\d+)$/.exec(anchor);
  if (byNumber) return chapterByNumber(Number(byNumber[1])) ?? null;
  return findHeading(anchor) ?? null;
}

export function Rulebook({ route }: { route: Route }) {
  const html = useMemo(renderBook, []);
  const article = useRef<HTMLElement>(null);
  const active = useSignal<string>("");
  const drawerOpen = useSignal(false);
  const query = useSignal("");
  const hits = useComputed(() => searchBook(query.value));

  const anchor = route.screen === "rules" ? route.anchor : null;

  // ESC closes the drawer wherever focus sits
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") drawerOpen.value = false;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // land on the routed heading — desktop and mobile alike
  useEffect(() => {
    const target = resolveAnchor(anchor);
    drawerOpen.value = false;
    if (!target) {
      article.current?.closest(".rulebook")?.scrollTo?.(0, 0);
      window.scrollTo(0, 0);
      return;
    }
    active.value = target.slug;
    document.getElementById(target.slug)?.scrollIntoView({ block: "start" });
  }, [anchor]);

  // the outline highlights where the reader actually is
  useEffect(() => {
    const onScroll = () => {
      const headings = article.current?.querySelectorAll<HTMLElement>("h1[id], h2[id]");
      if (!headings?.length) return;
      let current = headings[0].id;
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= 120) current = h.id;
        else break;
      }
      active.value = current;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const activeChapter = useComputed(() => {
    for (const c of outline.chapters)
      if (c.slug === active.value || c.sections.some((s) => s.slug === active.value))
        return c.slug;
    return outline.chapters[0]?.slug ?? "";
  });

  const outlineList = (
    <nav class="book-outline" data-testid="book-outline" aria-label={STRINGS.rbOutlineLabel}>
      <div class="book-search">
        <input
          type="search"
          data-testid="book-search"
          placeholder={STRINGS.rbSearchPlaceholder}
          value={query.value}
          onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
        />
        {query.value.trim().length >= 2 && (
          <ul class="book-hits" data-testid="book-hits">
            {hits.value.length === 0 && <li class="muted">{STRINGS.rbNoHits}</li>}
            {hits.value.map((h) => (
              <li key={h.slug}>
                <a href={rulesHash(h.slug)} onClick={() => (query.value = "")}>
                  {h.where} <small>({h.count})</small>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ul>
        {outline.chapters.map((c) => (
          <li key={c.slug}>
            <a
              href={rulesHash(c.slug)}
              class={active.value === c.slug ? "active" : ""}
              aria-current={active.value === c.slug ? "location" : undefined}
            >
              {c.text}
            </a>
            {activeChapter.value === c.slug && c.sections.length > 0 && (
              <ul>
                {c.sections.map((s) => (
                  <li key={s.slug}>
                    <a
                      href={rulesHash(s.slug)}
                      class={active.value === s.slug ? "active" : ""}
                      aria-current={active.value === s.slug ? "location" : undefined}
                    >
                      {s.text}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <main class="rulebook" data-testid="rulebook">
      {narrow.value && (
        <div class="book-bar" data-testid="book-bar">
          <button
            class="ghost book-drawer-toggle"
            data-testid="book-drawer-toggle"
            aria-expanded={drawerOpen.value}
            onClick={() => (drawerOpen.value = !drawerOpen.value)}
          >
            {STRINGS.rbOutlineLabel}
          </button>
          <SizeSwitch />
          <button
            class="ghost"
            data-testid="book-theme"
            onClick={() => applyTheme(theme.value === "dark" ? "light" : "dark")}
          >
            {theme.value === "dark" ? STRINGS.themeLight : STRINGS.themeDark}
          </button>
          <button
            class="ghost"
            data-testid="book-profile"
            aria-label={STRINGS.pfTitle}
            title={STRINGS.pfTitle}
            onClick={() => go("#/profile")}
          >
            ⚙
          </button>
          {/* the drawer hangs off the bar itself, so it always opens right
              under the controls that summoned it, scrolled or not */}
          {drawerOpen.value && (
            <aside class="book-side open" data-testid="book-side">
              {outlineList}
            </aside>
          )}
        </div>
      )}
      <div class="book-head">
        <h2 data-testid="book-title">{outline.title}</h2>
        {engineLineage.value && (
          <span class="chip lineage-chip" data-testid="book-lineage">
            {STRINGS.lineageLabel} {engineLineage.value}
          </span>
        )}
        {!narrow.value && <SizeSwitch />}
      </div>
      <div class="book-body">
        {drawerOpen.value && narrow.value && (
          <div
            class="book-backdrop"
            data-testid="book-backdrop"
            onClick={() => (drawerOpen.value = false)}
          />
        )}
        {!narrow.value && (
          <aside class="book-side" data-testid="book-side">
            {outlineList}
          </aside>
        )}
        <article
          ref={article}
          class={`book-page book-size-${bookSize.value}`}
          data-testid="book-page"
          // the book is the repo's own file, parsed at build time from the
          // single source the engine obeys — not user input
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </main>
  );
}

export default Rulebook;
