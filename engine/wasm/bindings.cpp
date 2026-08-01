// Emscripten bindings: a C ABI over the engine for the PWA and tools.
// The engine core stays global-free; this FFI boundary owns a handle registry
// (the one place state may rest between calls from JS).
//
// The same module also links the reference-compatible CLI main(), so under
// Node (NODERAWFS) it doubles as the identity-gate runner:
//   node dist/jerrymap.js --seed 42 --eras 20 --out DIR
#include <cstdint>
#include <cstdlib>
#include <map>
#include <memory>
#include <string>

#include "jerrymap/sim.hpp"

using namespace jerrymap;

namespace {

struct Bundle {
    std::unique_ptr<AutoDecider> dec;
    std::unique_ptr<Sim> sim;
    std::string out; // return-string storage, valid until the next call
};

std::map<int, std::unique_ptr<Bundle>>& registry() {
    static std::map<int, std::unique_ptr<Bundle>> r;
    return r;
}

int next_handle() {
    static int h = 0;
    return ++h;
}

Config config_from_json(const std::string& text) {
    Config cfg;
    Json j = json_parse(text.empty() ? "{}" : text);
    auto geti = [&](const char* k, int& into) {
        if (j.has(k)) into = static_cast<int>(j.at(k).as_int());
    };
    geti("panel_w", cfg.panel_w);
    geti("panel_h", cfg.panel_h);
    if (j.has("deck")) { // CONTRACTS §6: [[kind, copies], ...] in fixed kind order
        cfg.deck.clear();
        for (auto& row : j.at("deck").as_arr())
            cfg.deck.emplace_back(row.as_arr().at(0).as_str(),
                                  static_cast<int>(row.as_arr().at(1).as_int()));
    }
    geti("addpanel_copies", cfg.addpanel_copies);
    geti("archive_permille", cfg.archive_permille);
    geti("stroke_die", cfg.stroke_die);
    geti("stroke_add", cfg.stroke_add);
    geti("greatridge_die", cfg.greatridge_die);
    geti("greatridge_add", cfg.greatridge_add);
    geti("extend_cap", cfg.extend_cap);
    if (j.has("exp_fields")) cfg.exp_fields = j.at("exp_fields").as_bool();
    if (j.has("work_spread")) cfg.work_spread = j.at("work_spread").as_bool();
    if (j.has("work_overrides"))
        for (auto& kv : j.at("work_overrides").as_obj())
            cfg.work_overrides[kv.first] = static_cast<int>(kv.second.as_int());
    if (j.has("mood_overrides"))
        for (auto& kv : j.at("mood_overrides").as_obj())
            cfg.mood_overrides[kv.first] = kv.second.as_str();
    return cfg;
}

const char* stash(Bundle& b, std::string s) {
    b.out = std::move(s);
    return b.out.c_str();
}

} // namespace

extern "C" {

const char* jm_version() { return "jerrymap-engine 3.1.0"; }

// The rules lineage this engine speaks (CONTRACTS §9). Seeds do not survive a
// lineage break, so anything that shares or compares maps must report it — and
// must read it from here rather than keep its own copy.
const char* jm_lineage() { return LINEAGE; }

// The patina map for a state document (CONTRACTS §2.4): [[gx, gy, marks], …].
// Stateless on purpose — a renderer holds a world document, not always a
// handle, and a world from another lineage is still viewable.
const char* jm_patina(const char* state_json) {
    static std::string out;
    try {
        out = json_emit(patina_json(json_parse(state_json)));
    } catch (...) {
        out = "[]";
    }
    return out.c_str();
}

// Fresh world from a config JSON (CONTRACTS §6 "config" keys, all optional).
int jm_create(const char* config_json, std::int64_t seed, int eras) {
    try {
        auto b = std::make_unique<Bundle>();
        b->dec = std::make_unique<AutoDecider>(static_cast<std::uint64_t>(seed));
        b->sim = std::make_unique<Sim>(config_from_json(config_json ? config_json : ""),
                                       seed, eras, *b->dec);
        int h = next_handle();
        registry()[h] = std::move(b);
        return h;
    } catch (...) {
        return 0;
    }
}

// Rebuild a world from a saved state document (CONTRACTS §6).
int jm_load(const char* state_json) {
    try {
        Json st = json_parse(state_json);
        std::uint64_t rs = std::strtoull(
            st.at("rng").at("state").as_str().c_str(), nullptr, 10);
        auto b = std::make_unique<Bundle>();
        b->dec = std::make_unique<AutoDecider>(AutoDecider::from_state(rs));
        b->sim = std::make_unique<Sim>(st, *b->dec);
        int h = next_handle();
        registry()[h] = std::move(b);
        return h;
    } catch (...) {
        return 0;
    }
}

int jm_step(int h) { // 1 = one age executed, 0 = run finished
    auto it = registry().find(h);
    if (it == registry().end()) return 0;
    return it->second->sim->step() ? 1 : 0;
}

void jm_run(int h) {
    auto it = registry().find(h);
    if (it != registry().end()) it->second->sim->run();
}

const char* jm_log(int h) { // rendered event lines so far, LF-joined
    auto it = registry().find(h);
    if (it == registry().end()) return "";
    std::string s;
    for (auto& l : it->second->sim->loglines()) { s += l; s += "\n"; }
    return stash(*it->second, std::move(s));
}

const char* jm_report(int h) {
    auto it = registry().find(h);
    if (it == registry().end()) return "";
    return stash(*it->second, it->second->sim->final_report());
}

const char* jm_state(int h) { // CONTRACTS §6 save document
    auto it = registry().find(h);
    if (it == registry().end()) return "";
    return stash(*it->second, json_emit(it->second->sim->save_state(), 2));
}

// The structured event stream so far (CONTRACTS §5), a JSON array. Each element
// is the §5 document plus "text": the log lines this event rendered — so the
// familiar log is engine-rendered end to end and the app never renders rules text.
const char* jm_events(int h) {
    auto it = registry().find(h);
    if (it == registry().end()) return "";
    Sim& sim = *it->second->sim;
    Json arr = Json::array();
    for (const StoredEvent& se : sim.events()) {
        Json j = event_json(se.e);
        Json text = Json::array();
        for (std::size_t i = se.line_lo; i < se.line_hi; ++i)
            text.push(Json::of(sim.loglines()[i]));
        j.set("text", std::move(text));
        arr.push(std::move(j));
    }
    return stash(*it->second, json_emit(arr));
}

// Cheap progress probe: where the run stands, without serializing the world.
const char* jm_time(int h) {
    auto it = registry().find(h);
    if (it == registry().end()) return "";
    Sim& sim = *it->second->sim;
    Json j = Json::object();
    j.set("era", Json::of(sim.era));
    j.set("age_in_era", Json::of(sim.age_in_era));
    j.set("ages_total", Json::of(sim.ages_total));
    j.set("eras_wanted", Json::of(sim.eras_wanted));
    j.set("finished", Json::of(sim.finished()));
    return stash(*it->second, json_emit(j));
}

void jm_free(int h) { registry().erase(h); }

} // extern "C"
