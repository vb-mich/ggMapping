# sandy-r3-originals: the slot for pre-upload files

Empty on purpose, 2026-08-08.

`../sandy-r3/` holds stored output, which the tool already processed once. It
cannot answer "how faithful is the tool to what the tester actually had",
because the original files are not in it.

If the tester sends pre-upload originals, they go here. The pairing key is the
scan **`id`** in `../sandy-r3/manifest.json`, the same UUID that names each
file in `../sandy-r3/scans/`. Name each original for the stored scan it
matches, for example `0032eff7-4d00-4660-a173-e4ba442a3a95.png`, and the
paired source-against-stored mode can compare the two directly instead of
round-tripping.

The small ask that fills this folder: one fresh photo or file, plus its
stored twin from the app. One pair is enough to start.
