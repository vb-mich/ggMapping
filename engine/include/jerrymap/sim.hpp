// The headless engine: a byte-exact port of reference/sim.py (the v0.4 oracle),
// subsystem by subsystem, under the CONTRACTS.md law. No floats, no globals;
// all randomness through the Decider; all output through the event stream.
#pragma once
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include "decider.hpp"
#include "events.hpp"
#include "geometry.hpp"
#include "json.hpp"

namespace jerrymap {

struct Config {
    int panel_w = 5, panel_h = 6;
    std::vector<std::pair<std::string, int>> deck = {
        {"extend", 4}, {"basin", 3}, {"ridge", 1}, {"greatridge", 1},
        {"settlement", 3}, {"calm", 4}, {"anomaly", 1}, {"freestroke", 2}};
    int wake_era = 2;
    bool alive = true, semi = true, fragile = true;
    int addpanel_copies = -1;        // -1: resolve to 1 (alive) / 4
    bool work_spread = true;
    std::map<std::string, int> work_overrides;
    std::map<std::string, std::string> mood_overrides;
    int archive_permille = 0;        // percent x 10, computed once at config time
    int stroke_die = 4, stroke_add = 1;
    int greatridge_die = 0;          // 0 = unset (the length stays chosen)
    int greatridge_add = 0;
    int extend_cap = 4;              // 0 = uncapped
};

struct Card {
    std::string kind;
    int work = 0;
    std::int64_t uid = 0;
};

struct Metrics {
    std::int64_t cliffs = 0, nudges = 0, merges = 0, free_panels = 0,
                 fills = 0, stroke_units = 0, reworks = 0, crumbles = 0,
                 embellish = 0;
};

// Python-dict-faithful insertion-ordered map (CONTRACTS §6.1): deletion keeps
// the rest in order, re-insertion appends at the end. The order is semantic.
class OrderedPeople {
public:
    bool contains(GPos u) const { return index_.count(u) != 0; }
    const std::string* get(GPos u) const {
        auto it = index_.find(u);
        return it == index_.end() ? nullptr : &entries_[it->second].kind;
    }
    void set(GPos u, const std::string& kind) {
        auto it = index_.find(u);
        if (it != index_.end()) { entries_[it->second].kind = kind; return; }
        index_[u] = entries_.size();
        entries_.push_back({u, kind, false});
    }
    void erase(GPos u) {
        auto it = index_.find(u);
        if (it == index_.end()) return;
        entries_[it->second].dead = true;
        index_.erase(it);
    }
    template <class F> void for_each(F f) const {   // insertion order
        for (const auto& e : entries_) if (!e.dead) f(e.u, e.kind);
    }
    std::size_t size() const { return index_.size(); }

private:
    struct Entry { GPos u; std::string kind; bool dead; };
    std::vector<Entry> entries_;
    std::map<GPos, std::size_t> index_;
};

class Sim {
public:
    // Fresh world: emits the run header, seeds genesis, builds and shuffles the
    // deck, emits the era-1 header.
    Sim(const Config& cfg, std::int64_t seed, int eras, Decider& dec);
    // Rebuild from a saved state (CONTRACTS §6); no headers are re-emitted.
    Sim(const Json& state, Decider& dec);

    bool step();                 // one age (CONTRACTS §6.5); false when done
    void run() { while (step()) {} }
    bool finished() const { return finished_; }

    const std::vector<std::string>& loglines() const { return log_; }
    std::string final_report() const;
    Json save_state() const;     // legal at age boundaries only

    // --- configuration / identity -------------------------------------------
    Geo geo;
    Config cfg;
    std::int64_t seed = 0;
    int eras_wanted = 0;

    // --- the world (CONTRACTS §6) -------------------------------------------
    std::map<GPos, int> base;
    std::set<GPos> wild;
    OrderedPeople people;
    std::map<GPos, std::string> marks;
    std::map<Panel, int> panels;             // filled counts; keys = existence
    std::deque<Panel> stack;
    std::set<Panel> atlas, binder;
    std::deque<Card> deck;
    std::int64_t marker_uid = -1;            // -1 = none
    bool woken = false;
    std::int64_t next_uid = 0;

    // --- time ----------------------------------------------------------------
    int era = 1, age_in_era = 0;
    std::int64_t ages_total = 0;

    // --- chronicle -----------------------------------------------------------
    Metrics M;
    std::map<std::string, int> skips, firsts;
    std::map<GPos, int> embellish;
    std::map<Panel, int> embellish_panel;
    std::vector<std::string> era_rows;
    std::vector<Panel> genesis;
    bool cov_set = false;
    std::int64_t cov_num = 0, cov_den = 0;
    std::map<int, int> completed_per_era, added_per_era;

private:
    // decision + event plumbing
    int roll_die(int n, const std::string& purpose);
    template <class T>
    T pick(std::vector<T> cands, const std::string& purpose);
    bool roll_chance(int permille, const std::string& purpose);
    void shuffle_deck_now();
    void emit(Event e);
    void note(Ev kind, const std::string& s1 = "", const std::string& s2 = "",
              const std::string& s3 = "", std::int64_t a = 0, std::int64_t b = 0);
    void ev_action(Event e);     // stamps the step number

    // board helpers
    bool exists(GPos g) const { return panels.count(geo.panel_of(g)) != 0; }
    std::vector<GPos> side_nb(GPos g) const;
    void legal_interval(GPos g, int& lo, int& hi) const;
    // -1 = no legal rung of the class
    int cap_class(GPos g, int wanted, bool water_cls) const;
    void trace_unit(GPos g, const std::string& label);
    void set_mark(GPos g, const std::string& name);
    void paint(GPos g, int rung, const std::string& why);
    void skip_card(const std::string& card, const std::string& why,
                   const std::string& spirit = "");

    struct BorderSide { int d; std::vector<std::pair<GPos, GPos>> pairs; }; // (inside, outside)
    std::vector<BorderSide> border_pairs(Panel t) const;

    // strokes / fill / people / cards — mirrors of the oracle
    int stroke(GPos first, int first_wanted, int heading, int total,
               bool water_cls, int mode /*0 carry, 1 dig, 2 climb*/,
               const std::string& label);
    std::optional<GPos> nudge_unit(Panel t, GPos g0,
                                   const std::function<bool(GPos)>& pred,
                                   const std::string& what);
    GPos roll_unit(Panel t);
    void fill_quota(Panel t, int quota);
    void rework_walk(Panel t, int steps);
    void rework_body(GPos g);
    void fill_one(Panel t);
    int dens(GPos u) const;
    bool constrains(GPos u) const;
    bool dens_legal(GPos u, int d) const;
    bool neighbors_of_height(GPos u, int need) const;
    void note_first(const std::string& kind);
    void cascade();
    std::vector<std::vector<GPos>> settlement_components(Panel t);
    bool place_people(const std::vector<GPos>& cand_units, const std::string& kind,
                      const std::vector<int>& bases);
    std::vector<GPos> touching(const std::vector<GPos>& comp) const;
    bool rural_spot(const std::vector<GPos>& comp);
    bool try_upgrade(const std::vector<GPos>& comp);
    void grow_once(const std::vector<GPos>& comp);
    void city_lives(Panel t);
    void card_calm(Panel t);
    void card_ridge(Panel t, bool great);
    void card_basin(Panel t);
    void card_extend(Panel t);
    void card_free(Panel t);
    void card_settlement(Panel t);
    void card_anomaly(Panel t);
    void card_addpanel();
    bool panel_touches(Panel tk) const;
    bool loose_end(Panel tk) const;

    std::map<std::string, int> work_table() const;
    void build_deck();
    void finish_run();

    Decider* dec_ = nullptr;
    std::vector<std::string> log_;
    std::int64_t ev_seq_ = 0;

    // per-age transients (always quiescent at age boundaries)
    int step_no_ = 0;
    bool have_cur_ = false; Panel cur_panel_{};
    std::string mood_;
    bool stroke_choice_ = false;
    bool hit_ = false;
    bool has_work_panel_ = false; Panel work_panel_{};

    bool finished_ = false;
    int deck_size_end_ = 0, composed_end_ = 0;
};

// CLI-level helpers shared by native main and the WASM harness.
struct CliOptions {
    std::int64_t seed = -1;      // -1: random 1..10^7
    int eras = 8;
    std::string out = "runs";
    std::string tile = "5x6";
    int addpanel = -1;
    std::string archive_chance = "0";  // percent, one decimal allowed
    int stroke_die = 4, stroke_add = 1;
    int greatridge_die = 0, greatridge_add = 0;
    int extend_cap = 4;
    bool flat_work = false;
    std::string work, mood;      // k=v,... overrides
    std::string save_path, load_path, record_path, replay_path;
    std::int64_t save_at = -1;   // ages before saving (with --save)
};

int run_cli(int argc, char** argv);   // the reference-compatible CLI

} // namespace jerrymap
