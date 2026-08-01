// The patina map (CONTRACTS §2.4): where a world's rework marks are drawn.
//
// A rework recorded against a UNIT is drawn on that unit. A flourish from an
// instruction that could not execute is recorded against the PANEL with no
// unit — on a real map the player chooses where it goes — so a renderer must
// choose for them. The rule is law, not renderer taste, and it lives here so
// that every renderer (the app canvas, a PNG export, any future one) draws the
// same picture from the same state. The Python twin implements it
// independently; scripts/run_render_checks.py proves the two agree.
//
// This is a pure derivation over a §6 state document: no handle, no lineage
// check, so a world merely being VIEWED (including one from another lineage)
// still draws its patina.
#include <algorithm>
#include <map>
#include <set>
#include <vector>

#include "jerrymap/sim.hpp"

namespace jerrymap {

std::map<GPos, int> patina_map(const Json& state) {
    const Json& cfg = state.at("config");
    const Json& world = state.at("world");
    Geo geo;
    geo.W = static_cast<int>(cfg.at("panel_w").as_int());
    geo.H = static_cast<int>(cfg.at("panel_h").as_int());

    std::set<GPos> painted;
    for (const Json& e : world.at("base").as_arr()) {
        painted.insert({static_cast<int>(e.as_arr()[0].as_int()),
                        static_cast<int>(e.as_arr()[1].as_int())});
    }

    // unit-level reworks: drawn where they happened
    std::map<GPos, int> marks;
    for (const Json& e : world.at("embellish").as_arr()) {
        marks[{static_cast<int>(e.as_arr()[0].as_int()),
               static_cast<int>(e.as_arr()[1].as_int())}] =
            static_cast<int>(e.as_arr()[2].as_int());
    }

    // panel-level flourishes: painted ground only, richest first, then (gx,gy),
    // handed out round-robin. Panels are disjoint, so the order in which panels
    // are processed cannot change the result.
    for (const Json& e : world.at("embellish_panel").as_arr()) {
        Panel t{static_cast<int>(e.as_arr()[0].as_int()),
                static_cast<int>(e.as_arr()[1].as_int())};
        int n = static_cast<int>(e.as_arr()[2].as_int());
        if (n <= 0) continue;

        std::vector<GPos> cand;
        for (GPos u : geo.units(t))
            if (painted.count(u)) cand.push_back(u);
        // A panel only ever receives a flourish while it has painted ground
        // (the engine records none on an empty panel), so this cannot drop
        // marks; the guard is here so a hand-made document cannot crash us.
        if (cand.empty()) continue;

        std::sort(cand.begin(), cand.end(), [&](GPos a, GPos b) {
            int ca = 0, cb = 0;
            auto ia = marks.find(a);
            if (ia != marks.end()) ca = ia->second;
            auto ib = marks.find(b);
            if (ib != marks.end()) cb = ib->second;
            if (ca != cb) return ca > cb;   // richest first
            return a < b;                   // then (gx, gy)
        });
        for (int i = 0; i < n; ++i) marks[cand[static_cast<std::size_t>(i) % cand.size()]] += 1;
    }
    return marks;
}

Json patina_json(const Json& state) {
    Json arr = Json::array();
    for (const auto& kv : patina_map(state)) {
        Json e = Json::array();
        e.push(Json::of(kv.first.x));
        e.push(Json::of(kv.first.y));
        e.push(Json::of(kv.second));
        arr.push(std::move(e));
    }
    return arr;
}

} // namespace jerrymap
