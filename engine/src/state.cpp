// State serialization, CONTRACTS.md §6: one JSON document holds the complete
// world; load + step is byte-identical to never having stopped.
#include <cstdlib>
#include <stdexcept>

#include "jerrymap/sim.hpp"

namespace jerrymap {

namespace {

Json unit_json(GPos u) {
    Json a = Json::array();
    a.push(Json::of(u.x));
    a.push(Json::of(u.y));
    return a;
}

Json panel_json(Panel t) {
    Json a = Json::array();
    a.push(Json::of(t.tx));
    a.push(Json::of(t.ty));
    return a;
}

GPos unit_from(const Json& j) {
    return {static_cast<int>(j.as_arr()[0].as_int()),
            static_cast<int>(j.as_arr()[1].as_int())};
}

Panel panel_from(const Json& j) {
    return {static_cast<int>(j.as_arr()[0].as_int()),
            static_cast<int>(j.as_arr()[1].as_int())};
}

} // namespace

Json Sim::save_state() const {
    Json root = Json::object();
    root.set("schema", Json::of("jerrymap-state"));
    root.set("version", Json::of(1));
    root.set("lineage", Json::of(LINEAGE));

    Json jc = Json::object();
    jc.set("panel_w", Json::of(cfg.panel_w));
    jc.set("panel_h", Json::of(cfg.panel_h));
    {
        Json d = Json::array();
        for (auto& kn : cfg.deck) {
            Json e = Json::array();
            e.push(Json::of(kn.first));
            e.push(Json::of(kn.second));
            d.push(std::move(e));
        }
        jc.set("deck", std::move(d));
    }
    jc.set("wake_era", Json::of(cfg.wake_era));
    jc.set("alive", Json::of(cfg.alive));
    jc.set("semi", Json::of(cfg.semi));
    jc.set("fragile", Json::of(cfg.fragile));
    jc.set("addpanel_copies", Json::of(cfg.addpanel_copies));
    jc.set("work_spread", Json::of(cfg.work_spread));
    {
        Json w = Json::object();
        for (auto& kv : cfg.work_overrides) w.set(kv.first, Json::of(kv.second));
        jc.set("work_overrides", std::move(w));
        Json m = Json::object();
        for (auto& kv : cfg.mood_overrides) m.set(kv.first, Json::of(kv.second));
        jc.set("mood_overrides", std::move(m));
    }
    jc.set("archive_permille", Json::of(cfg.archive_permille));
    jc.set("stroke_die", Json::of(cfg.stroke_die));
    jc.set("stroke_add", Json::of(cfg.stroke_add));
    jc.set("greatridge_die", Json::of(cfg.greatridge_die));
    jc.set("greatridge_add", Json::of(cfg.greatridge_add));
    jc.set("extend_cap", Json::of(cfg.extend_cap));
    root.set("config", std::move(jc));

    {
        Json r = Json::object();
        r.set("algo", Json::of("pcg32/stream54"));
        std::uint64_t s = 0;
        dec_->rng_state(s);
        r.set("state", Json::of(std::to_string(s)));
        root.set("rng", std::move(r));
    }
    {
        Json tm = Json::object();
        tm.set("seed", Json::of(seed));
        tm.set("eras_wanted", Json::of(eras_wanted));
        tm.set("era", Json::of(era));
        tm.set("age_in_era", Json::of(age_in_era));
        tm.set("ages_total", Json::of(ages_total));
        root.set("time", std::move(tm));
    }
    {
        Json w = Json::object();
        Json jp = Json::array();
        for (auto& kv : panels) {
            Json e = Json::array();
            e.push(Json::of(kv.first.tx));
            e.push(Json::of(kv.first.ty));
            e.push(Json::of(kv.second));
            jp.push(std::move(e));
        }
        w.set("panels", std::move(jp));
        Json jb = Json::array();
        for (auto& kv : base) {
            Json e = Json::array();
            e.push(Json::of(kv.first.x));
            e.push(Json::of(kv.first.y));
            e.push(Json::of(kv.second));
            jb.push(std::move(e));
        }
        w.set("base", std::move(jb));
        Json jw = Json::array();
        for (GPos u : wild) jw.push(unit_json(u));
        w.set("wild", std::move(jw));
        Json jm = Json::array();
        for (auto& kv : marks) {
            Json e = Json::array();
            e.push(Json::of(kv.first.x));
            e.push(Json::of(kv.first.y));
            e.push(Json::of(kv.second));
            jm.push(std::move(e));
        }
        w.set("marks", std::move(jm));
        Json jpe = Json::array(); // insertion order — semantic (CONTRACTS §6.1)
        people.for_each([&](GPos u, const std::string& kind) {
            Json e = Json::array();
            e.push(Json::of(u.x));
            e.push(Json::of(u.y));
            e.push(Json::of(kind));
            jpe.push(std::move(e));
        });
        w.set("people", std::move(jpe));
        Json je = Json::array();
        for (auto& kv : embellish) {
            Json e = Json::array();
            e.push(Json::of(kv.first.x));
            e.push(Json::of(kv.first.y));
            e.push(Json::of(kv.second));
            je.push(std::move(e));
        }
        w.set("embellish", std::move(je));
        Json jep = Json::array();
        for (auto& kv : embellish_panel) {
            Json e = Json::array();
            e.push(Json::of(kv.first.tx));
            e.push(Json::of(kv.first.ty));
            e.push(Json::of(kv.second));
            jep.push(std::move(e));
        }
        w.set("embellish_panel", std::move(jep));
        Json ja = Json::array();
        for (Panel t : atlas) ja.push(panel_json(t));
        w.set("atlas", std::move(ja));
        Json jbi = Json::array();
        for (Panel t : binder) jbi.push(panel_json(t));
        w.set("binder", std::move(jbi));
        Json js = Json::array();
        for (Panel t : stack) js.push(panel_json(t));
        w.set("stack", std::move(js));
        root.set("world", std::move(w));
    }
    {
        Json d = Json::object();
        Json order = Json::array();
        for (const Card& c : deck) {
            Json e = Json::object();
            e.set("kind", Json::of(c.kind));
            e.set("work", Json::of(c.work));
            e.set("uid", Json::of(c.uid));
            order.push(std::move(e));
        }
        d.set("order", std::move(order));
        d.set("marker_uid", marker_uid < 0 ? Json::null() : Json::of(marker_uid));
        d.set("woken", Json::of(woken));
        d.set("next_uid", Json::of(next_uid));
        root.set("deck", std::move(d));
    }
    {
        Json ch = Json::object();
        Json rows = Json::array();
        for (auto& r : era_rows) rows.push(Json::of(r));
        ch.set("era_rows", std::move(rows));
        Json m = Json::object();
        m.set("cliffs", Json::of(M.cliffs));
        m.set("nudges", Json::of(M.nudges));
        m.set("merges", Json::of(M.merges));
        m.set("free_panels", Json::of(M.free_panels));
        m.set("fills", Json::of(M.fills));
        m.set("stroke_units", Json::of(M.stroke_units));
        m.set("reworks", Json::of(M.reworks));
        m.set("crumbles", Json::of(M.crumbles));
        m.set("embellish", Json::of(M.embellish));
        ch.set("metrics", std::move(m));
        Json sk = Json::object();
        for (auto& kv : skips) sk.set(kv.first, Json::of(kv.second));
        ch.set("skips", std::move(sk));
        Json fi = Json::object();
        for (auto& kv : firsts) fi.set(kv.first, Json::of(kv.second));
        ch.set("firsts", std::move(fi));
        Json ge = Json::array();
        for (Panel t : genesis) ge.push(panel_json(t));
        ch.set("genesis_panels", std::move(ge));
        if (cov_set) {
            Json cov = Json::object();
            cov.set("num", Json::of(cov_num));
            cov.set("den", Json::of(cov_den));
            ch.set("genesis_coverage", std::move(cov));
        } else {
            ch.set("genesis_coverage", Json::null());
        }
        Json cpe = Json::object();
        for (auto& kv : completed_per_era)
            cpe.set(std::to_string(kv.first), Json::of(kv.second));
        ch.set("completed_per_era", std::move(cpe));
        Json ape = Json::object();
        for (auto& kv : added_per_era)
            ape.set(std::to_string(kv.first), Json::of(kv.second));
        ch.set("added_per_era", std::move(ape));
        root.set("chronicle", std::move(ch));
    }
    {
        // The oracle's action-step counter leaks across age boundaries (a
        // free-panel event continues the previous age's numbering, CONTRACTS
        // §5.3), so exact resume carries it, with the panel skip() would see.
        Json carry = Json::object();
        carry.set("step", Json::of(step_no_));
        carry.set("panel", have_cur_ ? panel_json(cur_panel_) : Json::null());
        root.set("carry", std::move(carry));
    }
    return root;
}

Sim::Sim(const Json& st, Decider& dec) : dec_(&dec) {
    if (st.at("schema").as_str() != "jerrymap-state" || st.at("version").as_int() != 1)
        throw std::runtime_error("unsupported state schema/version");
    // A lineage bump never changes replayability WITHIN a lineage (CONTRACTS
    // §9); a foreign-lineage world resumed here would speak the wrong dialect.
    if (st.at("lineage").as_str() != LINEAGE)
        throw std::runtime_error("foreign world lineage: " + st.at("lineage").as_str());

    const Json& jc = st.at("config");
    cfg.panel_w = static_cast<int>(jc.at("panel_w").as_int());
    cfg.panel_h = static_cast<int>(jc.at("panel_h").as_int());
    cfg.deck.clear();
    for (auto& e : jc.at("deck").as_arr())
        cfg.deck.emplace_back(e.as_arr()[0].as_str(),
                              static_cast<int>(e.as_arr()[1].as_int()));
    cfg.wake_era = static_cast<int>(jc.at("wake_era").as_int());
    cfg.alive = jc.at("alive").as_bool();
    cfg.semi = jc.at("semi").as_bool();
    cfg.fragile = jc.at("fragile").as_bool();
    cfg.addpanel_copies = static_cast<int>(jc.at("addpanel_copies").as_int());
    cfg.work_spread = jc.at("work_spread").as_bool();
    for (auto& kv : jc.at("work_overrides").as_obj())
        cfg.work_overrides[kv.first] = static_cast<int>(kv.second.as_int());
    for (auto& kv : jc.at("mood_overrides").as_obj())
        cfg.mood_overrides[kv.first] = kv.second.as_str();
    cfg.archive_permille = static_cast<int>(jc.at("archive_permille").as_int());
    cfg.stroke_die = static_cast<int>(jc.at("stroke_die").as_int());
    cfg.stroke_add = static_cast<int>(jc.at("stroke_add").as_int());
    cfg.greatridge_die = static_cast<int>(jc.at("greatridge_die").as_int());
    cfg.greatridge_add = static_cast<int>(jc.at("greatridge_add").as_int());
    cfg.extend_cap = static_cast<int>(jc.at("extend_cap").as_int());
    // A document from the dial era may still carry "exp_fields"; it is simply
    // ignored — the rules it selected are canon now and cannot be turned off.
    geo.W = cfg.panel_w;
    geo.H = cfg.panel_h;

    const Json& tm = st.at("time");
    seed = tm.at("seed").as_int();
    eras_wanted = static_cast<int>(tm.at("eras_wanted").as_int());
    era = static_cast<int>(tm.at("era").as_int());
    age_in_era = static_cast<int>(tm.at("age_in_era").as_int());
    ages_total = tm.at("ages_total").as_int();

    const Json& w = st.at("world");
    for (auto& e : w.at("panels").as_arr())
        panels[{static_cast<int>(e.as_arr()[0].as_int()),
                static_cast<int>(e.as_arr()[1].as_int())}] =
            static_cast<int>(e.as_arr()[2].as_int());
    for (auto& e : w.at("base").as_arr())
        base[{static_cast<int>(e.as_arr()[0].as_int()),
              static_cast<int>(e.as_arr()[1].as_int())}] =
            static_cast<int>(e.as_arr()[2].as_int());
    for (auto& e : w.at("wild").as_arr()) wild.insert(unit_from(e));
    for (auto& e : w.at("marks").as_arr())
        marks[{static_cast<int>(e.as_arr()[0].as_int()),
               static_cast<int>(e.as_arr()[1].as_int())}] = e.as_arr()[2].as_str();
    for (auto& e : w.at("people").as_arr())
        people.set({static_cast<int>(e.as_arr()[0].as_int()),
                    static_cast<int>(e.as_arr()[1].as_int())},
                   e.as_arr()[2].as_str());
    for (auto& e : w.at("embellish").as_arr())
        embellish[{static_cast<int>(e.as_arr()[0].as_int()),
                   static_cast<int>(e.as_arr()[1].as_int())}] =
            static_cast<int>(e.as_arr()[2].as_int());
    for (auto& e : w.at("embellish_panel").as_arr())
        embellish_panel[{static_cast<int>(e.as_arr()[0].as_int()),
                         static_cast<int>(e.as_arr()[1].as_int())}] =
            static_cast<int>(e.as_arr()[2].as_int());
    for (auto& e : w.at("atlas").as_arr()) atlas.insert(panel_from(e));
    for (auto& e : w.at("binder").as_arr()) binder.insert(panel_from(e));
    for (auto& e : w.at("stack").as_arr()) stack.push_back(panel_from(e));

    const Json& d = st.at("deck");
    for (auto& e : d.at("order").as_arr())
        deck.push_back({e.at("kind").as_str(),
                        static_cast<int>(e.at("work").as_int()),
                        e.at("uid").as_int()});
    marker_uid = d.at("marker_uid").t == Json::T::Null ? -1
                                                       : d.at("marker_uid").as_int();
    woken = d.at("woken").as_bool();
    next_uid = d.at("next_uid").as_int();

    const Json& ch = st.at("chronicle");
    for (auto& e : ch.at("era_rows").as_arr()) era_rows.push_back(e.as_str());
    const Json& m = ch.at("metrics");
    M.cliffs = m.at("cliffs").as_int();
    M.nudges = m.at("nudges").as_int();
    M.merges = m.at("merges").as_int();
    M.free_panels = m.at("free_panels").as_int();
    M.fills = m.at("fills").as_int();
    M.stroke_units = m.at("stroke_units").as_int();
    M.reworks = m.at("reworks").as_int();
    M.crumbles = m.at("crumbles").as_int();
    M.embellish = m.at("embellish").as_int();
    for (auto& kv : ch.at("skips").as_obj())
        skips[kv.first] = static_cast<int>(kv.second.as_int());
    for (auto& kv : ch.at("firsts").as_obj())
        firsts[kv.first] = static_cast<int>(kv.second.as_int());
    for (auto& e : ch.at("genesis_panels").as_arr()) genesis.push_back(panel_from(e));
    if (ch.at("genesis_coverage").t != Json::T::Null) {
        cov_set = true;
        cov_num = ch.at("genesis_coverage").at("num").as_int();
        cov_den = ch.at("genesis_coverage").at("den").as_int();
    }
    for (auto& kv : ch.at("completed_per_era").as_obj())
        completed_per_era[std::atoi(kv.first.c_str())] =
            static_cast<int>(kv.second.as_int());
    for (auto& kv : ch.at("added_per_era").as_obj())
        added_per_era[std::atoi(kv.first.c_str())] =
            static_cast<int>(kv.second.as_int());

    const Json& carry = st.at("carry");
    step_no_ = static_cast<int>(carry.at("step").as_int());
    if (carry.at("panel").t != Json::T::Null) {
        have_cur_ = true;
        cur_panel_ = panel_from(carry.at("panel"));
    }
}

// ---------------------------------------------------------------- decisions

std::string decisions_emit(const std::vector<DecisionRecord>& tape) {
    std::string out;
    std::int64_t i = 0;
    for (const auto& r : tape) {
        Json j = Json::object();
        j.set("i", Json::of(i++));
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
        out += json_emit(j);
        out += "\n";
    }
    return out;
}

std::vector<DecisionRecord> decisions_parse(const std::string& text) {
    std::vector<DecisionRecord> tape;
    std::size_t p = 0;
    while (p < text.size()) {
        std::size_t e = text.find('\n', p);
        if (e == std::string::npos) e = text.size();
        std::string line = text.substr(p, e - p);
        p = e + 1;
        if (line.empty() || line == "\r") continue;
        Json j = json_parse(line);
        DecisionRecord r;
        const std::string& k = j.at("kind").as_str();
        r.kind = k == "die" ? DecisionRecord::Kind::Die
                 : k == "pick" ? DecisionRecord::Kind::Pick
                 : k == "chance" ? DecisionRecord::Kind::Chance
                                 : DecisionRecord::Kind::Shuffle;
        r.purpose = j.at("purpose").as_str();
        r.domain = j.at("domain").as_int();
        const Json& res = j.at("result");
        if (r.kind == DecisionRecord::Kind::Shuffle) {
            for (auto& v : res.as_arr())
                r.perm.push_back(static_cast<std::uint32_t>(v.as_int()));
        } else if (r.kind == DecisionRecord::Kind::Chance) {
            r.result = res.as_bool() ? 1 : 0;
        } else {
            r.result = res.as_int();
        }
        tape.push_back(std::move(r));
    }
    return tape;
}

} // namespace jerrymap
