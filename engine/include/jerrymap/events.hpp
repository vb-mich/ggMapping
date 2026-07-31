// The structured event stream, CONTRACTS.md §5. The engine emits events; the
// text log is ONE renderer of the stream and is byte-compatible with the oracle.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

#include "geometry.hpp"
#include "json.hpp"

namespace jerrymap {

enum class Ev {
    // framing
    RunStart, EraStart, AgeStart, FreePanel, AddpanelWake, EraSummary,
    // decision echoes
    Die, Choice, Chance,
    // age notes
    Calm, Work, CardSkip, StrokeNote, ExtendRun, WorkFollows, Foundation,
    Upgrade, Sprawl, CityLives, Cliff, CycleComplete, AnomalyResult,
    PanelArchived, PanelStays, PanelReturns, FieldDeepens,
    // numbered actions (carry step)
    Paint, Trace, ShoreHeal, Hold, ReworkChange, HomesLost, FullEmbellish,
    Crumble, Mark, People, AnomalyStrike, VolcanoRing, NewPanel, DeckShuffled,
    SkipEmbellish,
};

// One event. Generic payload slots; the renderer knows each kind's field map,
// documented in CONTRACTS.md §5.1.
struct Event {
    std::int64_t seq = 0;
    Ev kind;
    int step = 0;                    // 1-based for numbered actions, else 0
    bool has_panel = false; Panel panel{};
    bool has_unit = false;  GPos unit{};
    std::int64_t a = 0, b = 0, c = 0;
    bool flag = false;
    std::string s1, s2, s3;
    std::vector<std::int64_t> counts; // era summary: cnt[0..7], done, panels, archived, cliffs, merges
};

// The era row exactly as the oracle builds it (floats emulated, CONTRACTS §5.2).
std::string format_era_row(int era, int ages, std::int64_t painted,
                           const std::int64_t cnt[8], std::int64_t done,
                           std::int64_t panels, std::int64_t archived,
                           std::int64_t cliffs, std::int64_t merges,
                           bool archive_on);

// Render one event into log lines (RunStart renders two). Geometry is needed
// for r/c and panel names.
void render_event(const Event& e, const Geo& geo, std::vector<std::string>& out);

// The CONTRACTS §5 document for one event: { seq, kind, panel, unit, payload },
// payload fields named per the §5.1 catalog (payload.step on numbered actions).
Json event_json(const Event& e);

} // namespace jerrymap
