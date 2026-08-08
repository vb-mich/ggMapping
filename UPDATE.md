# Update package: the books-and-cards session, 2026-08-08

Repo-shaped, no collisions with frozen files, no engine or twin changes
(the reference stays v0.10; this package is docs and physical-layer assets).

## Contents and placement

* docs/books/0-ggMapping-Players-Handbook.md
  The Player's Handbook with the third field report's nine-edit batch,
  final wording by the author. If you already committed this exact file,
  the copy here is byte-identical and placing it changes nothing.
* docs/cards/
  The 17 unique card faces of the 22-card starting deck, the roll-tables
  reference card, a README with the deck table and the editing notes, and
  print/ggmapping-cards-print-A4.pdf (all 22 cards, three true-A4 sheets,
  cut marks, print at 100 percent).
* tools/apply_fork_notes_append.py and tools/fork_notes_append.md
  The FORK_NOTES session section. From the repo root:
      python tools/apply_fork_notes_append.py
  Idempotent: safe to run twice.

## Checklist, in order

1. Unpack this package onto the repo root.
2. Run the FORK_NOTES appender and check the tail of docs/FORK_NOTES.md.
3. Commit everything.
4. Refresh the Obsidian vault FROM the repo (the vault copy is not the
   repo file).
5. Only then paste PROMPT-digitalizer.md to Code, attaching the
   Sandy-scans folder. The prompt sends Code to read FORK_NOTES, and the
   fixtures-are-not-ground-truth note must be in it before Code reads it.

## Not in this package

The reference twin (unchanged, v0.10). The Helper (its own prompt, already
issued, execution unconfirmed). The Figma card upload (blocked on network
settings: mcp.figma.com must join the egress allowlist, then ask for fresh
upload URLs, the old ones expire). The Anomaly card wording vs the Master
Manual: flagged in FORK_NOTES, awaiting a ruling.
