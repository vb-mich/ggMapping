#include "jerrymap/events.hpp"

#include <cstdio>

#include "jerrymap/softfloat.hpp"

namespace jerrymap {

namespace {

std::string rc_panel(const Geo& geo, GPos u) {
    int r, c;
    geo.rc_of(u, r, c);
    return "r" + std::to_string(r) + "c" + std::to_string(c) + " " +
           Geo::name(geo.panel_of(u));
}

std::string rc_only(const Geo& geo, GPos u) {
    int r, c;
    geo.rc_of(u, r, c);
    return "r" + std::to_string(r) + "c" + std::to_string(c);
}

std::string upper(std::string s) {
    for (char& c : s) if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
    return s;
}

std::string two_digits(std::int64_t v) {
    std::string s = std::to_string(v);
    return s.size() < 2 ? "0" + s : s;
}

} // namespace

std::string format_era_row(int era, int ages, std::int64_t painted,
                           const std::int64_t cnt[8], std::int64_t done,
                           std::int64_t panels, std::int64_t archived,
                           std::int64_t cliffs, std::int64_t merges,
                           bool archive_on) {
    // Oracle: sh[i] = cnt[i]/n*100 as doubles (or integer zeros when n == 0);
    // w = sh[0]+sh[1]+sh[2]+sh[3]; every field formatted :.0f.
    F64 sh[8], hundred = sf_from_int(100), n = sf_from_int(painted);
    for (int i = 0; i < 8; ++i)
        sh[i] = painted ? sf_mul(sf_div(sf_from_int(cnt[i]), n), hundred) : F64{};
    F64 w = sf_add(sf_add(sf_add(sh[0], sh[1]), sh[2]), sh[3]);
    std::string row = "era " + std::to_string(era) + ": ages " + std::to_string(ages) +
        " | painted " + std::to_string(painted) +
        " | water " + sf_fmt(w, 0) + "% coastal " + sf_fmt(sh[4], 0) +
        "% plain " + sf_fmt(sh[5], 0) + "% hills " + sf_fmt(sh[6], 0) +
        "% mtn " + sf_fmt(sh[7], 0) + "% | done " + std::to_string(done) + "/" +
        std::to_string(panels) + " panels | ";
    if (archive_on) row += "archived " + std::to_string(archived) + " | ";
    row += "cliffs " + std::to_string(cliffs) + " merges " + std::to_string(merges);
    return row;
}

void render_event(const Event& e, const Geo& geo, std::vector<std::string>& out) {
    auto num = [&](const std::string& body) {
        out.push_back("    " + std::to_string(e.step) + ". " + body);
    };
    switch (e.kind) {
        case Ev::RunStart:
            out.push_back("=== JERRYMAPPING, simulator run ===");
            out.push_back("seed: " + std::to_string(e.a) + "  eras: " + std::to_string(e.b));
            break;
        case Ev::EraStart:
            out.push_back("--- era " + std::to_string(e.a) + " ---");
            break;
        case Ev::AgeStart:
            // v0.7 (handbook ch. 6 note 3): an Add Panel age has no panel from
            // the Stack — the panel it places is the working panel.
            out.push_back("[e" + std::to_string(e.a) + " a" + two_digits(e.b) + "] " +
                          (e.has_panel ? "panel " + Geo::name(e.panel)
                                       : std::string("the new panel")) +
                          " | " + upper(e.s1));
            break;
        case Ev::FreePanel:
            out.push_back("[e" + std::to_string(e.a) +
                          "] stack empty: a panel is added for free");
            break;
        case Ev::AddpanelWake:
            out.push_back("    the Add Panel card joins the back of the deck");
            break;
        case Ev::EraSummary:
            out.push_back("=== " + format_era_row(
                static_cast<int>(e.a), static_cast<int>(e.b), e.c, e.counts.data(),
                e.counts[8], e.counts[9], e.counts[10], e.counts[11], e.counts[12],
                e.flag));
            break;
        case Ev::Die:
            out.push_back("    d" + std::to_string(e.a) + "=" + std::to_string(e.b) +
                          " (" + e.s1 + ")");
            break;
        case Ev::Choice:
            out.push_back("    choice among " + std::to_string(e.a) + " (" + e.s1 + ")");
            break;
        case Ev::Chance:
            out.push_back("    chance " + e.s1 + ": " + (e.flag ? "yes" : "no"));
            break;
        case Ev::Calm:
            out.push_back("    calm: nothing");
            break;
        case Ev::Work:
            out.push_back("    work " + std::to_string(e.a) + ", mood " + e.s1);
            break;
        case Ev::CardSkip:
            out.push_back("    " + e.s1 + ": " + e.s2);
            break;
        case Ev::StrokeNote:
            if (e.s2 == "first_illegal")
                out.push_back("    " + e.s1 + ": first unit not legal, ends");
            else if (e.s2 == "edge")
                out.push_back("    " + e.s1 + ": ends at map edge, heading " + e.s3);
            else if (e.s2 == "merge")
                out.push_back("    " + e.s1 + ": merges into " + e.s3 + ", ends");
            else if (e.s2 == "blocked")
                out.push_back("    " + e.s1 + ": blocked by " + e.s3 + ", ends");
            else
                out.push_back("    " + e.s1 + ": no legal step ahead, ends");
            break;
        case Ev::ExtendRun:
            out.push_back("    extend: run len " + std::to_string(e.a) + " (" + e.s1 +
                          ") on " + e.s2 + " border");
            break;
        case Ev::WorkFollows:
            out.push_back("    the current working panel is the new panel " +
                          Geo::name(e.panel));
            break;
        case Ev::Foundation:
            out.push_back("    found " + e.s1);
            break;
        case Ev::Upgrade:
            out.push_back("    upgrade to " + e.s1);
            break;
        case Ev::Sprawl:
            out.push_back("    cannot climb, sprawls");
            break;
        case Ev::CityLives:
            out.push_back("    the city lives: climb or sprawl");
            break;
        case Ev::Cliff:
            out.push_back("    CLIFF");
            break;
        case Ev::CycleComplete:
            out.push_back("    the deck completed its cycle");
            break;
        case Ev::AnomalyResult:
            out.push_back("    anomaly: " + e.s1);
            break;
        case Ev::PanelArchived:
            out.push_back("    panel " + Geo::name(e.panel) + " COMPLETE, to the Atlas");
            break;
        case Ev::PanelStays:
            out.push_back("    panel " + Geo::name(e.panel) + " full, stays in play");
            break;
        case Ev::PanelReturns:
            out.push_back("    panel to back of stack (" + std::to_string(e.a) + "/" +
                          std::to_string(e.b) + ")");
            break;

        case Ev::Paint:
            num("paint " + rc_panel(geo, e.unit) + " " + RUNG_NAME[e.a] + " (" + e.s1 + ")");
            break;
        case Ev::Trace:
            num("rework " + rc_panel(geo, e.unit) + " (" + e.s1 + ")");
            break;
        case Ev::ShoreHeal:
            num("the shore forgets its sea at " + rc_panel(geo, e.unit) +
                ": coastal -> plain");
            break;
        case Ev::Hold:
            if (e.s1 == "land") num("the land holds: embellish");
            else if (e.s1 == "town") num("the town holds: embellish");
            else if (e.s1 == "city_shore") num("the city holds the shore: embellish");
            else num("settled: embellish");
            break;
        case Ev::ReworkChange:
            num("rework " + rc_only(geo, e.unit) + ": " + std::string(RUNG_NAME[e.a]) +
                " -> " + RUNG_NAME[e.b]);
            break;
        case Ev::HomesLost:
            num("the ground gives way, the homes are lost at " + rc_panel(geo, e.unit));
            break;
        case Ev::FullEmbellish:
            num("the panel is full: embellish " + std::to_string(e.a) + " units");
            break;
        case Ev::Crumble:
            num("the city crumbles at " + rc_panel(geo, e.unit));
            break;
        case Ev::Mark:
            num("mark " + e.s1 + " at " + rc_panel(geo, e.unit));
            break;
        case Ev::People:
            num("people " + e.s1 + " at " + rc_panel(geo, e.unit) +
                (e.s2.empty() ? "" : " (" + e.s2 + ")"));
            break;
        case Ev::AnomalyStrike:
            num("the anomaly strikes the homes");
            break;
        case Ev::VolcanoRing:
            num("the volcano raises its ring: the land around becomes hills");
            break;
        case Ev::FieldDeepens:
            num("the field deepens at " + rc_panel(geo, e.unit));
            break;
        case Ev::NewPanel:
            // v0.6.1: the printed number is the squared distance score the
            // placement actually uses (book ch. 9), not a Manhattan sum.
            num("new panel " + Geo::name(e.panel) + " (score " + std::to_string(e.a) + ")");
            break;
        case Ev::DeckShuffled:
            num("the deck is shuffled");
            break;
        case Ev::SkipEmbellish:
            num(e.s1 + ": " + e.s2 + ": embellish, " + e.s3);
            break;
    }
}

namespace {

const char* kind_name(Ev k) {
    switch (k) {
        case Ev::RunStart: return "run_start";
        case Ev::EraStart: return "era_start";
        case Ev::AgeStart: return "age_start";
        case Ev::FreePanel: return "free_panel";
        case Ev::AddpanelWake: return "addpanel_wake";
        case Ev::EraSummary: return "era_summary";
        case Ev::Die: return "die";
        case Ev::Choice: return "choice";
        case Ev::Chance: return "chance";
        case Ev::Calm: return "calm";
        case Ev::Work: return "work";
        case Ev::CardSkip: return "card_skip";
        case Ev::StrokeNote: return "stroke_note";
        case Ev::ExtendRun: return "extend_run";
        case Ev::WorkFollows: return "work_follows";
        case Ev::Foundation: return "foundation";
        case Ev::Upgrade: return "upgrade";
        case Ev::Sprawl: return "sprawl";
        case Ev::CityLives: return "city_lives";
        case Ev::Cliff: return "cliff";
        case Ev::CycleComplete: return "cycle_complete";
        case Ev::AnomalyResult: return "anomaly_result";
        case Ev::PanelArchived: return "panel_archived";
        case Ev::PanelStays: return "panel_stays";
        case Ev::PanelReturns: return "panel_returns";
        case Ev::FieldDeepens: return "field_deepens";
        case Ev::Paint: return "paint";
        case Ev::Trace: return "trace";
        case Ev::ShoreHeal: return "shore_heal";
        case Ev::Hold: return "hold";
        case Ev::ReworkChange: return "rework_change";
        case Ev::HomesLost: return "homes_lost";
        case Ev::FullEmbellish: return "full_embellish";
        case Ev::Crumble: return "crumble";
        case Ev::Mark: return "mark";
        case Ev::People: return "people";
        case Ev::AnomalyStrike: return "anomaly_strike";
        case Ev::VolcanoRing: return "volcano_ring";
        case Ev::NewPanel: return "new_panel";
        case Ev::DeckShuffled: return "deck_shuffled";
        case Ev::SkipEmbellish: return "skip_embellish";
    }
    return "?";
}

} // namespace

Json event_json(const Event& e) {
    Json p = Json::object();
    auto S = [&](const char* k, const std::string& v) { p.set(k, Json::of(v)); };
    auto I = [&](const char* k, std::int64_t v) { p.set(k, Json::of(v)); };
    switch (e.kind) {
        case Ev::RunStart: I("seed", e.a); I("eras", e.b); break;
        case Ev::EraStart: case Ev::FreePanel: I("era", e.a); break;
        case Ev::AgeStart: I("era", e.a); I("age", e.b); S("card", e.s1); break;
        case Ev::EraSummary: {
            I("era", e.a); I("ages", e.b); I("painted", e.c);
            Json rc = Json::array();
            for (int i = 0; i < 8; ++i) rc.push(Json::of(e.counts[i]));
            p.set("elevation_counts", std::move(rc)); // schema 3: was rung_counts
            I("done", e.counts[8]); I("panels", e.counts[9]);
            I("archived", e.counts[10]); I("cliffs", e.counts[11]);
            I("merges", e.counts[12]); p.set("archive_on", Json::of(e.flag));
            break;
        }
        case Ev::Die: I("n", e.a); I("value", e.b); S("purpose", e.s1); break;
        case Ev::Choice: I("count", e.a); S("purpose", e.s1); break;
        case Ev::Chance:
            I("permille", e.a); p.set("hit", Json::of(e.flag)); S("purpose", e.s1);
            break;
        case Ev::Work: I("quota", e.a); S("mood", e.s1); break;
        case Ev::CardSkip: S("card", e.s1); S("reason", e.s2); break;
        case Ev::StrokeNote: S("label", e.s1); S("cause", e.s2); S("detail", e.s3); break;
        case Ev::ExtendRun: I("length", e.a); S("cls", e.s1); S("side", e.s2); break;
        case Ev::Foundation: S("which", e.s1); break;
        case Ev::Upgrade: S("kind", e.s1); break;
        case Ev::AnomalyResult: S("name", e.s1); break;
        case Ev::PanelReturns: I("filled", e.a); I("area", e.b); break;
        case Ev::Paint: I("elevation", e.a); S("why", e.s1); break; // schema 3: was rung
        case Ev::Trace: S("label", e.s1); break;
        case Ev::Hold: S("what", e.s1); break;
        case Ev::ReworkChange: I("from", e.a); I("to", e.b); break;
        case Ev::FullEmbellish: I("n", e.a); break;
        case Ev::Mark: S("name", e.s1); break;
        case Ev::People:
            S("kind", e.s1);
            if (!e.s2.empty()) S("why", e.s2);
            break;
        case Ev::NewPanel: I("score", e.a); break; // event schema 2 (was "sum")
        case Ev::SkipEmbellish:
            S("card", e.s1); S("reason", e.s2); S("spirit", e.s3);
            break;
        default: break; // addpanel_wake, calm, work_follows, sprawl, city_lives,
                        // cliff, cycle_complete, panel_archived, panel_stays,
                        // shore_heal, homes_lost, crumble, anomaly_strike,
                        // volcano_ring, deck_shuffled: empty payload
    }
    if (e.step > 0) p.set("step", Json::of(e.step));

    Json j = Json::object();
    j.set("seq", Json::of(e.seq));
    j.set("kind", Json::of(kind_name(e.kind)));
    if (e.has_panel) {
        Json pn = Json::array();
        pn.push(Json::of(e.panel.tx)); pn.push(Json::of(e.panel.ty));
        j.set("panel", std::move(pn));
    } else {
        j.set("panel", Json::null());
    }
    if (e.has_unit) {
        Json un = Json::array();
        un.push(Json::of(e.unit.x)); un.push(Json::of(e.unit.y));
        j.set("unit", std::move(un));
    } else {
        j.set("unit", Json::null());
    }
    j.set("payload", std::move(p));
    return j;
}

} // namespace jerrymap
