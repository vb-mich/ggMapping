## ggMapping - Player's Handbook
Version: closed beta 1

Welcome to the fantastic world of Jerrymapping! An artistic mapmaking experience inspired by the original work of Jerry Gretzinger, the creator of "Jerry's map". 
You will paint a world one small square at a time, and the world will surprise you.

![[Map-gen-example.png]]
*An example of map you can create following ggMapping system*

ggMapping is a pre-set system to jerrymapping for those who want to start right away without having to come up with a whole new system on their own. This system has to be intended as a starting point, an initial guide to jerrymapping. Every rule and sub-system can be interpreted and edited without fear, you're encouraged to make changes and make the system your own system!

---

# 1. Introduction

This book keeps the rules light on purpose. If you're curious about how this manual came to be, or if you have any doubt about a specific rule, you can always refer to the full Master Manual.
What you need from this system is small: one law that keeps the geography honest, a deck that paces the work, and a little randomness in the right places so the map stays wilder than your habits.

One more thing for your first afternoons: early maps look like loose blocks and the cards instructions are less effective. Be patient. The chain of filling knits them into a flowing landscape, one visit at a time. Trust in the cards and your map will turn into something amazing.

What you need:
* Paper panels and something to paint with.
* The deck of 22 cards (chapter 6).
* A d6 and a d4, or any randomizer you like: a coin, a phone, honest eyes.

## The panels
The standard panel size in this manual is small, a pocket size, something you can bring with you in a coffee shop to work and assemble in a kitchen table. But the system work well with any panel size with just a few intuitive adjustment

**Pocket size** (standard)
- Grid units: 5x6 units
- Unit Size: 1.5cm square (5/8″)
- Panel Size: 7,5 x 9cm (3 1/8″ x 3 3/4″)
**Full size** (Jerry's size)
- Grid units: 8x10 units
- Unit Size: 2.5cm square (1″)
- Panel Size: 20 x 25cm (8″x10″)

![[panel-img.png|262]]

*The exact rules: Master Manual, chapters 1 to 3.*

## Words of the game

| Word                    | Meaning                                                  |
| ----------------------- | -------------------------------------------------------- |
| Unit                    | One small square of a panel                              |
| Panel                   | One sheet of the map, a matrix of units                  |
| Full Panel              | A panel where all units have been painted                |
| Base                    | A unit's ground: its elevation                           |
| Overlay                 | Anything drawn on top of the base                        |
| Stack                   | The pile of panels waiting for work                      |
| Spread                  | The current panel with its map neighbors laid around it  |
| Work number             | How many units a card fills                              |
| Rework or Embellishment | Decorating filled units without changing their elevation |
| Age, Era                | One card is one age; 25 ages are one era                 |
# 2. The turn

Your map is a growing grid of paper panels, each a small matrix of units. Mark each panel's coordinates on the back, bottom right relative to north. Unworked order lives in a stack of panels.

Each turn:

1. **Draw a card** from the deck.
2. **Take the front panel** of the Stack and lay its map neighbors around it, up to four: the Spread. If the card is Add Panel, skip this step: the new panel you place is your working panel.
3. **Do the card's instruction**, if it has one (chapter 6).
4. **Fill units** up to the card's work number (chapter 4). 
   Is the panel already completely filled? Then:
   - Do reworks up to the card's work number. (chapter 7)
   - The panel's tallest settlement gets one growth step. (see Settlement card)
5. **Put everything back.** The played card to the front of the deck, the Spread to its places, the panel to the back of the Stack. A full panel may retire to an archive instead (see notes).
6. **Advance the calendar** one age. Every 25 ages, a new era starts. Mark age and real date on the worked panel's back.

NOTES:
- Shuffle the deck once at the start and mark the bottom card. Each time the marked card comes round, shuffle again and mark anew.
- When a panel is full (completely painted), you can decide to put it in an "archive" instead of the working stack. Panels archiving helps to paint new maps faster and it keeps bigger maps manageable.

Have a look at this time dial that you can print and assemble by yourself.
Decorated version -> https://drive.google.com/file/d/1n1EbJtwI5MI_7IphLmpX9bVZUhJIzxFq
Plain version for you to decorate -> https://drive.google.com/file/d/14Y3d_Emow5Kj42nTOfvZ2p4-UC-NnY6y/

![[map-dial.png]]

*The exact rules: Master Manual, chapters 2, 5 and 6.*

# 3. One law: The Step Rule

**A unit and its side neighbor may differ by at most one elevation step.**

That is the **Step Rule**, and it is nearly the whole game!
Hold to it and geography draws itself: shores grow shallow rims, seas darken step by step, peaks never stand in meadows.

## The elevation ladder

| Elevation | Side  | Step |
| --------- | ----- | ---- |
| Mountains | land  | 4    |
| Hills     | land  | 3    |
| Plain     | land  | 2    |
| Coastal   | land  | 1    |
| Shallow   | water | 0    |
| Medium    | water | -1   |
| Deep      | water | -2   |
| Very deep | water | -3   |

* Coastal is the only door between land and water: coastal 1 touches shallow 0.
* Side neighbors share a full side. **<u>Diagonals never count</u>**, here or anywhere.
* The law works across panel borders.
* Anomaly units (chapter 6) are the one exception: they restrict nothing.

![[step-rule-example.png]]

*The exact rules: Master Manual, chapter 4.*

# 4. Filling rules

First of all, there are no standard colors the various elevations and features, you are free to chose your own palette or even your own system for picking colors. Just make sure elevations are recognizable to you. 

Here are few simple filling rules:
1. **Fill the pockets first.** Paint the empty unit touching the most painted units, across borders too. Ties: you choose, pick the pocket that pulls the map toward something you love.
   ![[fill-pockets-example.png]]

2. **Copy the dominant elevation.** Take the most common elevation among painted side neighbors (up-down-left-right). Anomaly units never count here: they have no elevation voice.
   ![[dominant-example.png]]

3. **Apply the card's mood:** 
	- **Settle** keeps the same elevation. 
	- **Level** moves one step toward plain. 
	- **Rise** moves one step away; Rise on plain is your choice of coastal or hills.
	  
	NOTE: **Level** keep Plains unchanged and **Rise** doesn't change mountains nor deep water. Carry on the same elevation when it cannot change.
	![[moods-example.png]]

4. **First paint on empty ground?** (a new map, a fresh panel): roll a d6.

| d6 | First elevation |
|---|---|
| 1 | Shallow |
| 2 | Coastal |
| 3-4 | Plain |
| 5 | Hills |
| 6 | Mountains |

5. **Chain.** Units painted earlier in the visit count for everything after: one visit grows a connected patch, not scattered dots.
6. **The law decides.** If the wanted elevation breaks the Step Rule, take the nearest step that does not. If no step works, satisfy the lowest neighbor and paint one step above it: that jump is a cliff, and cliffs are not mistakes.

<u>If all the units in a panel are already painted, the rest of the work becomes rework (chapter 7).</u>

*The exact rules: Master Manual, chapter 7.*
# 5. A stroke, step by step

The stroke is the shared mechanic behind Basin, Ridge, Great Ridge, Free Stroke and Extend instructions.

1. **Pick a start unit and a direction.** Diagonals are allowed. Each card's entry says where its stroke may start. Where it says you choose, choose freely, randomly, or roll dice for a starting unit.
2. **Pick a length**: 2 to 5 units (roll 1d4+1, or choose). Great Ridge: 5 to 10 units.
3. **Lay units one at a time** along the direction. Borders do not stop a stroke: it walks across panels. The map's edge ends the walk for good, and no stroke ever creates a new panel.
4. **Wobble.** Before each unit after the first, turn 45 degrees about one time in three, evenly left or right (d6: 1-4 keep the heading, 5 turn left, 6 turn right).
5. **Move the elevation by 1 after each step** as the card commands: basins dig one step deeper, ridges climb one step higher, but Extend carries the same elevation.
6. **Merging is good news.** A stroke that meets its own kind joins it: two seas become one sea, two ridges one range, and the stroke ends there.
7. **Everything else ends it**: a foreign feature ahead, the Step Rule, or the length running out. Features are allowed to end.
8. **But the walk goes on.** A stroke always walks its whole length. When it ends early, keep walking the steps but instead of filling, you do decorations/reworks on filled units along the way. A stroke's energy is never lost: what it cannot carve, it decorates.

![[stroke-example 1.png]]

*The exact rules: Master Manual, chapter 8.*

# 6. The cards

The deck, 22 cards:

| Copies | Instruction | Filling Work | Mood   |
| ------ | ----------- | ------------ | ------ |
| 7      | Calm        | 5 to 7       | Level  |
| 4      | Settlement  | 6 to 8       | Settle |
| 3      | Basin       | 6 to 8       | Settle |
| 2      | Free Stroke | 6, 8         | Settle |
| 1      | Extend      | 7            | Settle |
| 1      | Ridge       | 7            | Rise   |
| 1      | Great Ridge | 7            | Rise   |
| 1      | Anomaly     | 7            | Rise   |
| 2      | *Add Panel  | 3, 5         | Settle |
\*The two Add Panel cards sleep out of the deck for the first era and join at the back when era two begins.

![[card-example.png|289]]
An example of Free Stroke card

HERE is a link of a printable document with all the cards:
https://drive.google.com/file/d/1CVBCDG6nfsf6vPZVkXyCsEq-WNDPUqYm/view?usp=sharing
## Cards instructions

### Calm
No instruction, just do the filling work.
### Extend
(Stroke paint) Look at the bordering panels and walk along the shared border unit by unit. Where a run of water or heights on the other side touches your border, that run can be continued. Take the longest run, counting it only up to four units so the biggest sea does not win every time, and continue it into your panel as a stroke, carrying its elevation. Nothing to extend: rework instead (chapter 7).
![[extend-example 1.png]]
### Basin
(Stroke paint) If water already touches the panel or its borders, grow that water as a stroke: start from it and dig one step deeper as you go. Otherwise seed a new lake anywhere sensible, starting shallow, digging as it wanders. A deep heart in a small lake is fine: the law rings it with graded shores.
![[basin-example.png]]
### Ridge and Great Ridge 
(Stroke paint) Choose any empty unit where hills are legal and start a climbing stroke: first unit hills, then one step higher as you go, so mountains from the second unit on. Ridge runs 2 to 5 units, Great Ridge 5 to 10, both your choice, no dice. Mountain chains are the most stunning feature of your map.
![[ridge-example.png]]
### Free Stroke
(Stroke paint) Everything is your choice: start, heading, elevations, turns, length up to 5 units. Make your map coherent and beautiful.
### Settlement
Does anyone live on this panel or its Spread?

**No one?** Then roll a d6:

| d6  | Founding                                                                             |
| --- | ------------------------------------------------------------------------------------ |
| 1-3 | A farmstead: 1 rural home and 1 farmland                                             |
| 4-5 | A village: 2 rural homes and 1 farmland                                              |
| 6   | A small town: a low urban core with homes on every side (ring first), and 1 farmland |
![[Settlement-founding-example.png]]

**NOTE:** Founding needs painted ground: homes stand on plain or coastal units already on the map, and the word "empty" in the people rules means no people on it, not unpainted. On a mostly blank panel there may be no legal home.

**Someone already there?** Then grow. 
The tallest settlement takes two growth steps. 
Each step, roll a d6:

| d6  | Growth step                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------- |
| 1-2 | A field. Deepen a low intensity farmland to high intensity first; otherwise plant a new farmland, always low intensity |
| 3-4 | A rural home beside the busiest part of town                                                              |
| 5-6 | A rise in density: rural to urban low, low to medium, medium to high. If nothing can rise, a home instead |
Note: If growth cannot happen (e.g. no legal space for farmland), then do a rework instead.

Urban density ladder

| City Density |
| ------------ |
| Urban High   |
| Urban Medium |
| Urban Low    |
| Rural        |
Farmland can be **Low intensity** or **High intensity**

![[settlement-growth-example.png]]

People rules, in brief:

* Settlements stand only on plain or coastal. Farmland stand only on plain: roll 1d4 for the intensity of a new farmland, 1-2 low, 3-4 high.
* <u>People keep their own step rule</u>: among plain and coastal neighbors, density differs by one step at most. Cities grow out before up!
* Company: urban medium wants 2 touching people units, urban high wants 3.
* **Farmlands are not cities.** They never block a step, never count as company, are never blocked. No home on a field, no field on a home. Fields feed the town, they do not crowd it.
* Ties for tallest: grow the larger; still tied, the one with the better story.

### Anomaly
Want your "other dimensions" feature? This is the card made for it! The one license to break the rules, once, at placement. It may repaint anything and ignore the law as it lands. Afterward it restricts nothing, and your anomalies follow nothing but your rules. Make your own anomaly table; the Master Manual carries a good one to start from. 

### Add Panel
Put the new panel at the open position closest to the middle of the map; ties prefer a loose end, where water or heights meet the void. It is your working panel this turn, and its first units grow inward from the border it shares with the map. No panel is born blank.
Tip: Use the online map digitalizer to easily spot the best place for a new panel.

<u>If an instruction cannot result in paint, then it becomes rework (chapter 7).</u>

*The exact rules: Master Manual, chapter 9.*

# 7. When something cannot happen

Cards are ALWAYS effective, but sometimes the instruction cannot be executed, either because of rules restriction or because the panel is already completely painted. 
In that case apply the nudge or the instruction become a rework task.

* **The Nudge.** If a unit cannot take what you must place, slide to the nearest unit on the working panel that can. The Nudge never leaves the working panel. Ties: your choice.
* **The Rework.** If the instruction cannot happen at all, or the panel is full, decorate instead: work the same units the instruction would have touched, without changing elevation. Waves on the deep sea, roads, collages, a festival in the city, etc... Reworks are what makes an old panel look loved! Blank units are never reworked. (The simulator's records say embellish for a rework, and waymark for a settlement that found no home: a small sign of the visit, placed where you like.)
* **The pass.** Blank units are never reworked, so on a panel with no painted units at all, a failed instruction simply passes: note it and paint on, the card's fill still happens. On a young map instructions fail often for the first few ages. That is normal, and every card is still a full card of painting.
* **The healing.** While reworking, a coastal unit with no water on any side may become plain: the shore forgets its sea. Beyond that, artistic freedom over reworked ground. Use it like salt.

*The exact rules: Master Manual, chapter 4.*

# 8. Adding new cards

**You're free to add cards and instructions as you wish!**
But be mindful, adding a new card is an action that can have profound effects on your map. 

Here below some suggestions:
- Keep the average work number of your cards close to the starting deck's, about 6.5
- Keep the number of **instructions** balanced as the initial deck (e.g. 1 every 20 is an Anomaly)
- Use the same **mood** for all the instructions as the initial deck (e.g. Great Ridge is always Rise). Or keep the mood mix near the starting deck's: about 12x Settle, 7x Level, 3x Rise in the 22 cards.
- If you implement a "Remove Card" instruction, make it a one-shot instruction that applies only when the deck size reaches a threshold. A "Remove card" instruction tends to destroy your deck over time.
- Add a "Shuffle Deck" instruction only when the deck size is considerable. Frequent re-shuffling can negatively affect cards exit balance, thus the map balance. Shuffling when all cards have been drawn ensure that all cards are executed at least once.

NOTE: **If you decide to keep your map at a fixed size.** Some players choose a final size in advance, for a frame or a wall. A map that has stopped growing still draws the same cards, so anything that scars the land (like the Void on Jerry's map) keeps arriving at the same rate on a world that can no longer spread it out. The Anomaly is the one to watch: design it gently for a bounded map, with fewer copies or kinder outcomes.

# 9. On randomness

Here is the honest truth this book is built on: people are poor randomizers. We streak, we favor, we repeat. Left to instinct alone, every ridge bends the way your wrist bends, every sea grows toward the same corner, and the map fills with your habits instead of a generated world. As Jerry once said "I try to think as little as possible".

So the rules ask for randomness in a few small places, and only there:

| Where                       | Chance                            | Easy roll                                   |
| --------------------------- | --------------------------------- | ------------------------------------------- |
| Stroke length               | 2 to 5, evenly                    | 1d4+1                                       |
| Stroke wobble               | turn 1 in 3, evenly left or right | d6: 1-4 straight, 5 left, 6 right           |
| First paint on empty ground | see the table in chapter 4        | d6                                          |
| Founding a settlement       | half, a third, a sixth            | d6: 1-3, 4-5, 6                             |
| A growth step               | equal thirds                      | d6: 1-2, 3-4, 5-6                           |
| A farmland's intensity      | half and half                     | 1d4: 1-2 low, 3-4 high                      |

How you randomize is your taste, and all ways are equal: dice, percentages on a phone, a coin, a spun pencil. And the deck itself is your biggest randomizer: it decides what kind of day the map is having, seven quiet days in twenty-two, four of people, three of water. Trust the deck. It is the calibration, tuned by many hands before yours.

Where the rules say *your choice*, they mean it. Choose with taste: vary your headings, break your own streaks, and once in a while do the thing you were avoiding. The best maps are half law, half weather, and the weather is you.

*The exact rules: Master Manual, chapter 10, and everywhere the dice are printed.*
