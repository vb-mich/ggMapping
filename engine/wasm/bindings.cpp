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
    geti("max_panels", cfg.max_panels);
    // "exp_fields" from the dial era is ignored: those rules are canon now.
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

// The structured event stream with rendered text (CONTRACTS §5): each event's
// §5 document plus "text", the log lines it rendered — shared by jm_events
// and the helper responses, so the familiar log is engine-rendered end to end.
Json events_with_text(const Sim& sim) {
    Json arr = Json::array();
    for (const StoredEvent& se : sim.events()) {
        Json j = event_json(se.e);
        Json text = Json::array();
        for (std::size_t i = se.line_lo; i < se.line_hi; ++i)
            text.push(Json::of(sim.loglines()[i]));
        j.set("text", std::move(text));
        arr.push(std::move(j));
    }
    return arr;
}

// One decision record as a response row (kind/purpose/domain/result, §4).
Json record_json(const DecisionRecord& r) {
    Json j = Json::object();
    const char* kind =
        r.kind == DecisionRecord::Kind::Die ? "die"
        : r.kind == DecisionRecord::Kind::Pick ? "pick"
        : r.kind == DecisionRecord::Kind::Chance ? "chance" : "shuffle";
    j.set("kind", Json::of(kind));
    j.set("purpose", Json::of(r.purpose));
    j.set("domain", Json::of(r.domain));
    if (r.kind == DecisionRecord::Kind::Shuffle) {
        Json p = Json::array();
        for (std::uint32_t v : r.perm) p.push(Json::of(static_cast<std::int64_t>(v)));
        j.set("result", std::move(p));
    } else if (r.kind == DecisionRecord::Kind::Chance) {
        j.set("result", Json::of(r.result != 0));
    } else {
        j.set("result", Json::of(r.result));
    }
    return j;
}

// The witnessed candidates ride the offer as {"cands":[...], "ctx"?}; spread
// them into a response object (null cands when nothing was witnessed).
void set_cands(Json& into, const std::string& witnessed) {
    if (witnessed.empty()) {
        into.set("cands", Json::null());
        into.set("ctx", Json::null());
        return;
    }
    Json w = json_parse(witnessed);
    into.set("cands", w.at("cands"));
    into.set("ctx", w.has("ctx") ? w.at("ctx") : Json::null());
}

Json question_json(const PendingDecision& p) {
    Json q = Json::object();
    const char* kind =
        p.kind == DecisionRecord::Kind::Die ? "die"
        : p.kind == DecisionRecord::Kind::Pick ? "pick"
        : p.kind == DecisionRecord::Kind::Chance ? "chance" : "shuffle";
    q.set("kind", Json::of(kind));
    q.set("purpose", Json::of(p.purpose));
    q.set("domain", Json::of(p.domain));
    set_cands(q, p.candidates_json);
    return q;
}

Json error_json(const std::string& message) {
    Json j = Json::object();
    j.set("status", Json::of("error"));
    j.set("message", Json::of(message));
    return j;
}

std::uint64_t parse_state(const char* s) {
    return std::strtoull(s && *s ? s : "0", nullptr, 10);
}

} // namespace

extern "C" {

const char* jm_version() { return "jerrymap-engine 6.0.0"; }

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
    return stash(*it->second, json_emit(events_with_text(*it->second->sim)));
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

// ---------------------------------------------------------------- the Helper
// The play-with-paper seam (HELPER_DESIGN, CONTRACTS §4): stateless calls —
// a state document in, a script in, one age out. Responses are one JSON
// document: {"status":"question"|"closed"|"error", ...}. No handles: the
// Helper's replay-to-frontier restores and reruns, so nothing may rest here.

static std::string helper_out;

static const char* helper_respond(Json j) {
    helper_out = json_emit(j);
    return helper_out.c_str();
}

static Json closed_json(Sim& sim, std::size_t consumed) {
    Json j = Json::object();
    j.set("status", Json::of("closed"));
    j.set("consumed", Json::of(static_cast<std::int64_t>(consumed)));
    j.set("finished", Json::of(sim.finished()));
    j.set("state", sim.save_state());
    j.set("events", events_with_text(sim));
    return j;
}

// Create a fresh scripted world (the Helper's blank origin). The only decision
// construction consults is the deck shuffle; an empty script surfaces it as
// the first question, the Helper answers it with jm_perm, and the closed
// response carries the age-zero state with the run and era headers.
const char* jm_helper_create(const char* config_json, std::int64_t seed,
                             int eras, const char* script) {
    try {
        FrontierDecider dec(decisions_parse(script ? script : ""));
        try {
            Sim sim(config_from_json(config_json ? config_json : ""), seed, eras, dec);
            return helper_respond(closed_json(sim, dec.consumed()));
        } catch (const FrontierReached& f) {
            Json j = Json::object();
            j.set("status", Json::of("question"));
            j.set("consumed", Json::of(static_cast<std::int64_t>(dec.consumed())));
            j.set("question", question_json(f.pending));
            j.set("events", Json::array());
            return helper_respond(std::move(j));
        }
    } catch (const std::exception& e) {
        return helper_respond(error_json(e.what()));
    } catch (...) {
        return helper_respond(error_json("helper create failed"));
    }
}

// Run ONE age of a saved world under a decision script.
//   mode 0, guided:  replay-to-frontier — the script answers until it runs
//                    out; the next open decision returns as a question with
//                    its witnessed candidates, and the partial age's events
//                    ride along for the preview.
//   mode 1, propose: past the script the simulator's own policy answers; the
//                    closed response carries the fresh records, each with the
//                    candidates it chose from, and the advanced policy state.
//   mode 2, replay:  the plain ScriptedDecider, for the identity test — the
//                    script must close the age exactly.
// policy_state: decimal PCG32 state (mode 1 only; "" elsewhere).
const char* jm_helper_age(const char* state_json, const char* script,
                          int mode, const char* policy_state) {
    try {
        Json st = json_parse(state_json ? state_json : "");
        std::vector<DecisionRecord> tape = decisions_parse(script ? script : "");
        if (mode == 1) {
            PolicyFallbackDecider dec(std::move(tape), parse_state(policy_state));
            Sim sim(st, dec);
            sim.step();
            Json j = closed_json(sim, dec.consumed());
            Json fresh = Json::array();
            for (std::size_t i = 0; i < dec.fresh().size(); ++i) {
                Json row = record_json(dec.fresh()[i]);
                set_cands(row, dec.fresh_cands()[i]);
                fresh.push(std::move(row));
            }
            j.set("fresh", std::move(fresh));
            j.set("policy_state", Json::of(std::to_string(dec.policy_state())));
            return helper_respond(std::move(j));
        }
        if (mode == 2) {
            ScriptedDecider dec(std::move(tape));
            Sim sim(st, dec);
            sim.step();
            return helper_respond(closed_json(sim, dec.consumed()));
        }
        FrontierDecider dec(std::move(tape));
        Sim sim(st, dec);
        try {
            sim.step();
            return helper_respond(closed_json(sim, dec.consumed()));
        } catch (const FrontierReached& f) {
            Json j = Json::object();
            j.set("status", Json::of("question"));
            j.set("consumed", Json::of(static_cast<std::int64_t>(dec.consumed())));
            j.set("question", question_json(f.pending));
            j.set("events", events_with_text(sim)); // the partial age so far
            return helper_respond(std::move(j));
        }
    } catch (const std::exception& e) {
        return helper_respond(error_json(e.what()));
    } catch (...) {
        return helper_respond(error_json("helper age failed"));
    }
}

// The portable RNG (CONTRACTS §3) for the Helper's own dice: roll-for-me,
// provisional deck orders, the proposal's policy. ONE implementation — the
// engine's — so no port of PCG32 grows in the app.
const char* jm_rng_seed(std::int64_t seed) {
    static std::string out;
    out = std::to_string(Pcg32(static_cast<std::uint64_t>(seed)).state());
    return out.c_str();
}

const char* jm_roll(int n, const char* rng_state) {
    static std::string out;
    try {
        Pcg32 rng = Pcg32::from_state(parse_state(rng_state));
        int v = rng.die(n);
        Json j = Json::object();
        j.set("value", Json::of(v));
        j.set("state", Json::of(std::to_string(rng.state())));
        out = json_emit(j);
    } catch (...) {
        out = "{}";
    }
    return out.c_str();
}

const char* jm_perm(int len, const char* rng_state) {
    static std::string out;
    try {
        Pcg32 rng = Pcg32::from_state(parse_state(rng_state));
        std::vector<std::uint32_t> p(static_cast<std::size_t>(len));
        rng.shuffle_perm(p.size(), p.data());
        Json j = Json::object();
        Json perm = Json::array();
        for (std::uint32_t v : p) perm.push(Json::of(static_cast<std::int64_t>(v)));
        j.set("perm", std::move(perm));
        j.set("state", Json::of(std::to_string(rng.state())));
        out = json_emit(j);
    } catch (...) {
        out = "{}";
    }
    return out.c_str();
}

} // extern "C"
