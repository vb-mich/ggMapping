# sandy-r3: the tester's donated maps

## Provenance

Tester Sandy, third field report, round 3, 2026-08. This is the tool's own
**exported backup archive**, unpacked here with its internal shape intact:
`manifest.json`, `scans/`, `thumbs/`. Exported 2026-08-07 21:33 UTC.

License: **donated for project testing**.

## These are not ground truth

Every image here is output the digitalizer already stored once. They record
what the tool produced, blur and all. They are evidence and regression
references. They are not the physical map, and they are not the tester's
pre-upload files, so no absolute source-against-stored comparison can be made
from this folder alone.

The acceptance built on them is a **round trip**: feed an image back through
the upload path and compare what comes out with what went in, using the input
as its own reference. That works without ground truth.

If pre-upload originals arrive later, they belong in the sibling folder
`../sandy-r3-originals/`, and the pairing key is the scan **`id`** in
`manifest.json` (the same UUID that names each file in `scans/`). Pair one
original to one stored scan by that id, and the paired source-against-stored
mode becomes possible.

## Inventory

`manifest.json` is a full archive manifest, archive version 1:

* `maps`: 3 records, each `{id, name, created}`.
* `scans`: 40 records, each `{id, mapId, tx, ty, created, note, sync, mime,
  width, height, bytes, imageEntry, thumbEntry}`. This is what makes the
  UUID-named images navigable: it says which map each image belongs to and
  which panel coordinate it sits at.
* `bookmarks`: 0 records.
* No world documents are present. There is no engine state, no config, and no
  saved world in this archive. If a future donation carries one, treat it as
  data to inventory first; loading a real world into the engine is a separate
  round with its own acceptance.

All 40 scans are `image/jpeg`. All 40 carry the authoring metadata of the
tool that made them (Exif, and either a Photoshop block or an ICC profile
with XMP), which a canvas re-encode would have stripped. Read on its own
terms, that says these were stored **verbatim** by the import-as-is path,
not re-encoded by the pipeline.

## The three maps, on inspection

The brief expected "a whiteboard-cards map, a paper-texture map, and a
third". What is actually in the folder, looked at rather than assumed:

**`My first map`** (16 scans, 12 panels, 4 of them second versions).
A **digital painting**, not a photograph of paper. It has a digital
paper-texture fill, painted shapes in dark red and ochre with visible brush
strokes, a drawn grid, magenta guide lines along one edge, and a small
typeset "N1/E1" label. Fine grain over the whole surface. This is the
texture-heavy case, and it is the case the tester's blur complaint is about,
because these are digital files uploaded as files. About 366 KB per panel,
around 888 x 1065.

**`Second map - whiteboard`** (12 scans, 4 panels, 3 versions each).
The only **photographed** map here: green and black marker line art of
mountains on a yellow card with rounded corners, a hand-drawn grid, "N1E1"
and a red blob in one corner. Photograph evidence is plain: a specular
highlight across the top, a lighting gradient, slight perspective, the
card's physical edge against a pale surface. Sizes vary from 439 x 744 up to
1130 x 1600, which is the pipeline's own cap. This is the line-art case.
About 183 KB per panel.

**`Player handbook map`** (12 scans, 12 panels, one note: "First turn!").
A second **digital painting**, same hand as the first: same grid, same label
style, same compass rose in the corner, same magenta edge lines, but on a
near-white ground with soft green and yellow shapes and large flat areas.
The light-texture digital case. About 165 KB per panel, around 888 x 1065.

So the set is two digital maps and one photographed map, not one digital and
two photographed. The "paper texture" in the first map is painted, not
photographed. That distinction matters: it puts the tester's blur report on
the digital-file path, where the fine grain has the most to lose.

## What they were used for

2026-08-08: the round-trip and sharpness tables, the auto-fix goldens in
`../../goldens/autofix-sandy-r3/`, and the before-and-after atlas zoom pair
in `../../reports/`. The harness is `../../tools/blur-lab.mjs`.
