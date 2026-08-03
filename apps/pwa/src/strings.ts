// Every user-facing string of the app lives here (English for now).
// The vocabulary law (CONTRACTS §1) binds each one: no banned words, tested.
//
// The display name is a placeholder pending approval (CONTRACTS §10): it exists
// in exactly ONE constant, below; the approved fallback is listed in CONTRACTS.
// Everything user-facing — header, document title, manifest — derives from it.
export const DISPLAY_NAME = "Jerrymapping";

export const STRINGS = {
  tagline: "simulator",

  // config panel
  configTitle: "Run setup",
  seed: "Seed",
  randomize: "Randomize",
  eras: "Eras",
  panelSize: "Panel size",
  panelSizeMini: "5×6 mini-map",
  panelSizeFull: "8×10 full-map",
  dialsTitle: "Dials",
  archiveChance: "Archive chance (%)",
  strokeDie: "Stroke die",
  strokeAdd: "Stroke add",
  greatridgeMode: "Great Ridge length",
  greatridgeChoice: "chosen (handbook)",
  greatridgeRolled: "rolled",
  greatridgeDie: "Great Ridge die",
  greatridgeAdd: "Great Ridge add",
  extendCap: "Extend cap",
  extendCapHint: "0 removes the cap",

  // deck editor
  deckTitle: "Deck",
  deckCards: "cards",
  deckAvgWork: "average work",
  deckCopies: "Copies",
  deckWork: "Work avg",
  deckMood: "Mood",
  deckWorkNumbers: "Printed work numbers",
  moodSettle: "settle",
  moodLevel: "level",
  moodRise: "rise",
  deckWarnAvgWork:
    "The handbook suggests keeping the average work number close to the starting deck's, about 6.5.",
  deckWarnAnomaly:
    "The handbook suggests keeping the instruction balance of the starting deck: about one Anomaly in twenty cards.",
  deckWarnMoodMix:
    "The handbook suggests a mood mix near the starting deck's: about 12× settle, 7× level, 3× rise in the 22 cards.",
  deckWarnAddpanelGrowth:
    "The handbook pairs extra Add Panel copies with heavy archiving; otherwise the map risks scattering into many half-empty panels.",
  deckWarnSeeChapter: "The guidance in full: handbook chapter 10",
  deckNoteAddpanel:
    "The Add Panel card sleeps outside the deck during era one, then joins the back of the deck; it is a base card and cannot be retired.",
  deckNoteRemoveCard:
    "The handbook cautions against Remove Card instructions: make them one-shot and threshold-gated, or they destroy the deck over time.",

  // run controls
  run: "Run",
  cancel: "Cancel",
  continueRun: "Continue",
  running: "Running era",
  runDone: "Run complete",
  runCanceled: "Paused at an era boundary",
  runFailed: "The engine rejected this setup",

  // map view
  mapTitle: "Map",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit",
  legendTitle: "Legend",

  // report
  reportTitle: "Final report",

  // files
  filesTitle: "Files",
  saveWorld: "Save world",
  loadWorld: "Load world",
  exportPng: "Export PNG",
  exportLog: "Export log",
  copyConfig: "Copy config JSON",
  copied: "Copied",
  loadFailed: "That file is not a world this app understands.",

  // map toolbar
  followPanel: "Follow current panel",
  panelNames: "Panel names",
  traceReworks: "Trace reworks",
  dimArchived: "Dim archived panels",
  workNumbers: "Work numbers",

  // now panel
  nowTitle: "Now",
  nowEra: "Era",
  nowAge: "Age",
  nowPanels: "panels",
  nowWork: "work",
  nowOn: "on",
  nowGenesis: "genesis: the blank world",

  // navigation
  navTitle: "Navigation",
  chipViewing: "viewing era",
  chipOf: "of",
  navFirst: "Start",
  navPrevEra: "Back one era",
  navPrevAge: "Back one age",
  navNextAge: "Forward one age",
  navNextEra: "Forward one era",
  navLast: "End",
  navGo: "Go",

  // run extras
  reroll: "Reroll",
  backToCanon: "Back to canon",

  // deck extras
  flatWork: "Flat work",
  deckInEraOne: "in era one",
  deckEraLength: "era length: 25 ages, fixed",
  deckOk: "Deck within the book's recommendations.",
  exportDeck: "Export deck",


  // stats
  statsHeading: "Elevation shares",
  peopleHeading: "People",
  peopleFieldsLow: "fields low",
  peopleFieldsHigh: "fields high",
  peopleRural: "rural",
  peopleUrbanLow: "urban low",
  peopleUrbanMedium: "urban medium",
  peopleUrbanHigh: "urban high",
  statWater: "water",
  statCoastal: "coastal",
  statPlain: "plain",
  statHills: "hills",
  statMountains: "mountains",
  statCliffs: "cliffs",
  statDicePerAge: "dice/age",
  statPeakDensity: "city: peak density",
  statPeople: "people",
  statReworks: "reworks",
  statCrumbles: "crumbles",
  statEmbellish: "embellish",
  statFirsts: "firsts",
  statNone: "none",

  // files extras
  saveConfig: "Save config",
  loadConfig: "Load config",
  configLoadFailed: "That file is not a config this app understands.",

  // theme
  themeLight: "Light",
  themeDark: "Dark",

  // tuning tooltips (shown after a two-second hover)
  tipSeed:
    "The world's number: the same seed with the same setup repaints the same map, unit for unit.",
  tipEras: "How many eras to run. An era is 25 ages.",
  tipPanelSize:
    "Panel geometry in units. 5×6 is the handbook's standard mini-map; 8×10 is the original full-map.",
  tipArchiveChance:
    "Percent chance (one decimal allowed) that a panel is archived when it first becomes complete. Archived panels leave the rotation but stay part of the world. 0 keeps every panel in play.",
  tipExtendCap:
    "Runs of this length or more count the same in Extend's border contest; 0 removes the cap and the true longest run wins.",
  tipStrokeDie:
    "The die rolled for stroke length wherever a length is rolled: basin strokes, free strokes, and Extend's inward carry.",
  tipStrokeAdd: "Added to every stroke-length roll.",
  tipGreatridgeMode:
    "The handbook chooses the Great Ridge length, 4 to 10, and that is the default. Rolled mode makes the engine roll a die instead.",
  tipGreatridgeDie: "The die rolled for the Great Ridge length.",
  tipGreatridgeAdd: "Added to the Great Ridge length roll.",
  tipFlatWork:
    "Every card of a kind prints the kind's work average instead of the handbook's spread around it.",
  tipDeckCopies: "How many cards of this kind the deck holds.",
  tipDeckWork:
    "The kind's work average. The printed numbers spread ±1 around it at the ends, keeping the mean exact.",
  tipDeckMood: "The mood this kind's cards apply, as the handbook's deck table prints it.",
  tipDeckPrinted:
    "The printed work numbers, derived by the engine from copies and average.",

  // the rules lineage
  lineageLabel: "rules",
  lineageTitle:
    "The rules lineage this engine speaks. A seed only means the same map within one lineage.",
  foreignLineageNotice:
    "That file was made under rules {theirs}; this engine speaks {ours}. It is loaded as it is — but the same seed paints a different map under different rules, so do not compare them.",
  retiredKeyNotice:
    "That file still carries the {key} switch. Those rules are canon now, so the switch selects nothing — the file is loaded without it.",
  dismiss: "Dismiss",

  // updates
  updateNow: "Update to newer version",

  // navigation between the app's screens
  navSimulator: "Simulator",
  navMyMap: "My map",
  navRulebook: "Rulebook",

  // the Rulebook reader (the book's own text is the law's source, not ours)
  rbOutlineLabel: "Contents",
  rbSearchPlaceholder: "Search the book",
  rbNoHits: "No matches",
  rbLoading: "Opening the book",
  rbTextSize: "Text size",

  // My map — the digitalizer screen (act one: local only)
  mmDefaultMapName: "My first map",
  mmMapLabel: "Map",
  mmNewMap: "New map",
  mmMapName: "Name",
  mmCreate: "Create",
  mmScanButton: "Scan a panel",
  mmEmptyState:
    "Your paper map, panel by panel: photograph each worked panel and it is filed here at its coordinate, with every earlier scan kept as history. Tap Scan a panel to begin.",
  mmPickHint: "Photograph the worked panel straight on, filling the frame.",
  mmCamera: "Take a photo",
  mmGallery: "From the gallery",
  mmCropTitle: "Corners",
  mmDetected: "Border found — adjust the corners if needed.",
  mmNotDetected: "No border found — set the corners by hand.",
  mmStraighten: "Straighten",
  mmAdjustTitle: "Light",
  mmExposure: "Exposure",
  mmContrast: "Contrast",
  mmContinue: "Continue",
  mmFileTitle: "File the scan",
  mmNote: "Note (optional)",
  mmSaveScan: "Save to the map",
  mmAlreadyScanned:
    "This panel already holds {n} scan(s); this one becomes the newest and the others stay as history.",
  mmBack: "Back",
  mmWorking: "Working…",
  mmHistoryTitle: "History",
  mmNewestFirst: "newest first",
  mmScanAgain: "Scan a new version",
  mmNoScansHere: "Nothing is filed at this coordinate yet.",
  mmDelete: "Delete",
  mmDeleteWarn: "This removes the scan from this device, forever. There is no copy anywhere else.",
  mmDeleteTimelineWarn: "Deleting it also changes what the timeline shows at that time.",
  mmReallyDelete: "Delete forever",
  mmRotate: "Rotate",
  mmEditNote: "Edit note",
  mmSaveNote: "Save note",

  // the timeline
  mmTimeline: "Timeline",
  mmNow: "now",
  mmViewing: "viewing",
  mmMarkMoment: "Name this moment",
  mmRemove: "Remove",
  mmPlay: "Play the timeline",
  mmPause: "Pause",

  // the profile
  pfTitle: "Profile settings",
  pfPlayback: "Playback",
  pfPlaybackHint: "How fast the timeline's play button walks the map's updates.",
  pfPerUpdate: "per update",
  pfMaps: "Maps",
  pfRename: "Rename",
  pfOpen: "Open",
  pfCurrent: "current",
  pfDeleteMapWarn:
    "This removes the map {name} with its {n} scan(s) from this device, forever. There is no copy anywhere else.",
  pfBackupTitle: "Backups",

  // map files: the whole-map PNG and the backup archive
  mmFilesTitle: "Map files",
  mmExportPng: "Export map PNG",
  mmQuality: "Quality",
  mmQualityHigh: "full",
  mmQualityLow: "quick (small)",
  mmTransparent: "Transparent gaps",
  mmCapEngaged: "The export was scaled down to fit this device's image limits.",
  mmNothingToExport: "There is nothing to export at this moment of the timeline.",
  mmBackupCurrent: "Back up this map",
  mmBackupAll: "Back up all maps",
  mmRestore: "Restore a backup",
  mmRestored: "Restored {maps} map(s) with {scans} scan(s), as a new map.",
  mmArchiveBad: "That file is not a backup this app can read. ({message})",
  mmDecodeFailed: "That photo could not be read. Try another one.",
  mmEncodeFailed: "The scan could not be encoded on this device.",
  mmNoStore:
    "This browser will not let the app keep files on the device (private mode can do this). Scanning works, saving does not.",
  mmQuotaFull: "There is no room left on this device for the scan. Free some space and try again.",
  mmStoreFailed: "Saving failed: {message}",
  mmScanWord: "scan",
  mmScansWord: "scans",
  mmPersistent: "persistent",
  mmBestEffort: "best effort",

  // misc
  offlineReady: "Ready to work offline.",
} as const;
