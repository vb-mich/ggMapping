# ggMapping card masters

Eighteen SVG files: the 17 unique faces of the 22-card starting deck, plus
the roll-tables reference card. All poker size, 63mm x 88mm, viewBox 252 x 352
(one unit is a quarter millimeter). This is the Magic: The Gathering spec
exactly and within a millimeter of Bicycle size; one file serves both.

## The deck table

| Copies | Kind | Work numbers printed | Files |
|---|---|---|---|
| 7 | Calm | 5, 6 x5, 7 | card-calm-5/6/7 |
| 4 | Settlement | 6, 7 x2, 8 | card-settlement-6/7/8 |
| 3 | Basin | 6, 7, 8 | card-basin-6/7/8 |
| 2 | Free Stroke | 6, 8 | card-freestroke-6/8 |
| 1 | Extend | 7 | card-extend-7 |
| 1 | Ridge | 7 | card-ridge-7 |
| 1 | Great Ridge | 7 | card-greatridge-7 |
| 1 | Anomaly | 7 | card-anomaly-7 |
| 2 | Add Panel | 3, 5 | card-addpanel-3/5 |

card-rolltables.svg is the table reference card (Blank Panel, Settlement,
Stroke sections); it is never drawn, it lives beside the deck.

## Printing

print/ggmapping-cards-print-A4.pdf carries all 22 cards on three true-A4
sheets, vector, exact size, with corner cut marks. Print at 100 percent
scale, never fit-to-page. Rasterize any SVG at 744px wide for 300dpi.

## Editing notes, hard-won

* Figma imports these SVGs as editable vector trees. Canva flattens every
  SVG by design; Canva's editable door is PDF import.
* Figma ignores dominant-baseline; the work number is positioned by plain
  baseline (y=59) for that reason. Do not "fix" it to dominant-baseline.
* Figma renders the mm sizing at 96px/inch against the viewBox: scale
  0.9449. A source font-size of 21.17 reads as 20 in Figma's inspector.
  To hit a round Figma number: source = figma_target / 0.9449.
* Titles auto-fit: FREE STROKE is 20.4 and GREAT RIDGE 20.9 (measured to
  clear the work badge); all other titles are 21.17.
* Design language: paper #F3EFE7, ink #2B2620, muted #7A7168, amber #D19A2E
  marks the subject. Terrain and people colors are the canonical palette
  (CONTRACTS 2.4). Two tiles drawn touching claim to be map neighbors, so
  every adjacency obeys the Step Rule; the Anomaly card's illegality is
  deliberate and is the card's subject.
