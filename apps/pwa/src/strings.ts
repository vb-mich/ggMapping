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
  moodDefault: "default",
  moodSettle: "settle",
  moodLevel: "level",
  moodRise: "rise",
  deckWarnAvgWork: "The handbook suggests keeping the average work number near 7.",
  deckWarnAnomaly:
    "The handbook suggests keeping the instruction balance of the starting deck: about one Anomaly in twenty cards.",
  deckWarnMoodMix:
    "The handbook suggests a mood mix near the starting deck's: about 13× settle, 4× level, 3× rise in twenty cards.",
  deckWarnAddpanelGrowth:
    "The handbook pairs extra Add Panel copies with heavy archiving; otherwise the map risks scattering into many half-empty panels.",
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
  eraRowsTitle: "Era rows",
  legendTitle: "Legend",

  // record view
  recordTitle: "Record",
  filterEra: "Era",
  filterAge: "Age",
  filterPanel: "Panel",
  filterAll: "all",
  recordEmpty: "No record yet: run the simulator.",
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

  // record extras
  ageDetails: "Age details",

  // files extras
  saveConfig: "Save config",
  loadConfig: "Load config",
  configLoadFailed: "That file is not a config this app understands.",

  // theme
  themeLight: "Light",
  themeDark: "Dark",

  // misc
  offlineReady: "Ready to work offline.",
} as const;
