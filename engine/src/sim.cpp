// The engine core: a line-faithful port of reference/sim.py (v0.4 oracle).
// Byte-identity with the oracle is enforced by the gate (CONTRACTS §8); every
// deviation from the Python control flow is a bug.
#include "jerrymap/sim.hpp"

#include <algorithm>
#include <cassert>
#include <stdexcept>

#include "jerrymap/softfloat.hpp"

namespace jerrymap {

namespace {

const std::map<std::string, int>& work_living() {
    static const std::map<std::string, int> t = {
        {"calm", 6}, {"anomaly", 7}, {"settlement", 7}, {"extend", 7},
        {"basin", 7}, {"ridge", 7}, {"greatridge", 7}, {"freestroke", 7},
        {"addpanel", 4}};
    return t;
}

const std::map<std::string, int>& work_standard() {
    static const std::map<std::string, int> t = {
        {"calm", 7}, {"anomaly", 3}, {"settlement", 4}, {"extend", 5},
        {"basin", 5}, {"ridge", 5}, {"greatridge", 5}, {"freestroke", 5},
        {"addpanel", 5}};
    return t;
}

std::string mood_of(const std::string& kind) {
    if (kind == "ridge" || kind == "greatridge" || kind == "anomaly") return "rise";
    if (kind == "calm") return "level";
    return "settle"; // extend, basin, settlement, freestroke, addpanel
}

int mood_fd(const std::string& mood) {
    if (mood == "settle") return 3;
    if (mood == "level") return 6;
    if (mood == "rise") return 8;
    throw std::runtime_error("unknown mood: " + mood);
}

std::string spirit_of(const std::string& card) {
    if (card == "extend") return "trace your richest border";
    if (card == "basin") return "ripple the water";
    if (card == "ridge" || card == "greatridge") return "shade the slopes";
    if (card == "settlement") return "the town celebrates";
    if (card == "anomaly") return "mark the strange";
    return "any flourish"; // freestroke and any other
}

// Per-copy work numbers around a type average: +-1 at the ends, exact mean,
// floor 3, empty spread for singles.
std::vector<int> spread_work(int avg, int n, bool on) {
    std::vector<int> vals(static_cast<std::size_t>(n), avg);
    if (!on || n <= 1 || avg - 1 < 3) return vals;
    vals.front() -= 1;
    vals.back() += 1;
    return vals;
}

const int DENS_OF[] = {0};
int dens_of_kind(const std::string& k) {
    (void)DENS_OF;
    if (k == "rural") return 1;
    if (k == "urb_lo") return 2;
    if (k == "urb_md") return 3;
    if (k == "urb_hi") return 4;
    return 0; // farm_lo, farm_hi
}

const char* up_of(const std::string& k) {
    if (k == "rural") return "urb_lo";
    if (k == "urb_lo") return "urb_md";
    if (k == "urb_md") return "urb_hi";
    return nullptr;
}

const char* down_of(const std::string& k) {
    if (k == "urb_hi") return "urb_md";
    if (k == "urb_md") return "urb_lo";
    if (k == "urb_lo") return "rural";
    return nullptr;
}

const char* display_name(const std::string& k) {
    if (k == "urb_lo") return "urban low";
    if (k == "urb_md") return "urban medium";
    if (k == "urb_hi") return "urban high";
    return nullptr;
}

bool in_cls(int rung, bool water_cls) {
    return water_cls ? is_water(rung) : is_height(rung);
}

} // namespace

// ---------------------------------------------------------------- plumbing

void Sim::emit(Event e) {
    e.seq = ev_seq_++;
    std::size_t lo = log_.size();
    render_event(e, geo, log_);
    events_.push_back({std::move(e), lo, log_.size()});
}

void Sim::note(Ev kind, const std::string& s1, const std::string& s2,
               const std::string& s3, std::int64_t a, std::int64_t b) {
    Event e;
    e.kind = kind;
    e.s1 = s1; e.s2 = s2; e.s3 = s3;
    e.a = a; e.b = b;
    emit(std::move(e));
}

void Sim::ev_action(Event e) {
    e.step = ++step_no_;
    emit(std::move(e));
}

int Sim::roll_die(int n, const std::string& purpose) {
    int v = dec_->die(n, purpose);
    Event e; e.kind = Ev::Die; e.a = n; e.b = v; e.s1 = purpose;
    emit(std::move(e));
    return v;
}

template <class T>
T Sim::pick(std::vector<T> cands, const std::string& purpose) {
    assert(!cands.empty());
    std::sort(cands.begin(), cands.end());
    if (cands.size() == 1) return cands[0];
    int idx = dec_->pick(static_cast<int>(cands.size()), purpose);
    Event e; e.kind = Ev::Choice; e.a = static_cast<std::int64_t>(cands.size());
    e.s1 = purpose;
    emit(std::move(e));
    return cands[static_cast<std::size_t>(idx)];
}

bool Sim::roll_chance(int permille, const std::string& purpose) {
    bool hitv = dec_->chance(permille, purpose);
    Event e; e.kind = Ev::Chance; e.s1 = purpose; e.flag = hitv;
    e.a = permille;
    emit(std::move(e));
    return hitv;
}

void Sim::shuffle_deck_now() {
    std::vector<Card> tmp(deck.begin(), deck.end());
    std::vector<std::uint32_t> perm = dec_->shuffle(tmp.size(), "deck");
    std::deque<Card> next;
    for (std::size_t k = 0; k < tmp.size(); ++k)
        next.push_back(tmp[perm[k]]);
    deck = std::move(next);
}

// ---------------------------------------------------------------- board

std::vector<GPos> Sim::side_nb(GPos g) const {
    std::vector<GPos> out;
    for (int s = 0; s < 4; ++s) {
        GPos n{g.x + SIDE_DX[s], g.y + SIDE_DY[s]};
        if (exists(n)) out.push_back(n);
    }
    return out;
}

void Sim::legal_interval(GPos g, int& lo, int& hi) const {
    lo = 0; hi = 7;
    for (GPos n : side_nb(g)) {
        auto it = base.find(n);
        if (it != base.end() && !wild.count(n)) {
            lo = std::max(lo, it->second - 1);
            hi = std::min(hi, it->second + 1);
        }
    }
}

int Sim::cap_class(GPos g, int wanted, bool water_cls) const {
    int lo, hi;
    legal_interval(g, lo, hi);
    int cmin = water_cls ? VD : HI, cmax = water_cls ? SH : MO;
    int clo = std::max(lo, cmin), chi = std::min(hi, cmax);
    if (clo > chi) return -1;
    return std::min(std::max(wanted, clo), chi);
}

void Sim::trace_unit(GPos g, const std::string& label) {
    auto it = base.find(g);
    if (it != base.end() && it->second == CO && !wild.count(g)) {
        bool watery = false;
        for (GPos n : side_nb(g)) {
            auto bn = base.find(n);
            if (bn != base.end() && is_water(bn->second)) { watery = true; break; }
        }
        if (!watery) {
            it->second = PL;
            Event e; e.kind = Ev::ShoreHeal; e.has_unit = true; e.unit = g;
            ev_action(std::move(e));
            return;
        }
    }
    M.embellish += 1;
    embellish[g] += 1;
    Event e; e.kind = Ev::Trace; e.has_unit = true; e.unit = g; e.s1 = label;
    ev_action(std::move(e));
}

void Sim::set_mark(GPos g, const std::string& name) {
    marks[g] = name;
    wild.insert(g);
    Event e; e.kind = Ev::Mark; e.has_unit = true; e.unit = g; e.s1 = name;
    ev_action(std::move(e));
}

void Sim::paint(GPos g, int rung, const std::string& why) {
    assert(!base.count(g));
    base[g] = rung;
    panels[geo.panel_of(g)] += 1;
    Event e; e.kind = Ev::Paint; e.has_unit = true; e.unit = g;
    e.a = rung; e.s1 = why;
    ev_action(std::move(e));
}

void Sim::skip_card(const std::string& card, const std::string& why,
                    const std::string& spirit) {
    skips[card] += 1;
    if (!have_cur_ || panels.count(cur_panel_) == 0 || panels.at(cur_panel_) == 0) {
        note(Ev::CardSkip, card, why);
        return;
    }
    M.embellish += 1;
    embellish_panel[cur_panel_] += 1;
    Event e; e.kind = Ev::SkipEmbellish; e.s1 = card; e.s2 = why;
    e.has_panel = true; e.panel = cur_panel_; // the panel that took the embellish
    e.s3 = spirit.empty() ? spirit_of(card) : spirit;
    ev_action(std::move(e));
}

std::vector<Sim::BorderSide> Sim::border_pairs(Panel t) const {
    GPos o = geo.origin(t);
    int W = geo.W, H = geo.H;
    std::vector<BorderSide> out;
    struct Spec { int d; std::vector<std::pair<GPos, GPos>> pairs; };
    std::vector<Spec> specs;
    {
        Spec n{0, {}};
        for (int i = 0; i < W; ++i)
            n.pairs.push_back({{o.x + i, o.y}, {o.x + i, o.y - 1}});
        Spec s{4, {}};
        for (int i = 0; i < W; ++i)
            s.pairs.push_back({{o.x + i, o.y + H - 1}, {o.x + i, o.y + H}});
        Spec e{2, {}};
        for (int j = 0; j < H; ++j)
            e.pairs.push_back({{o.x + W - 1, o.y + j}, {o.x + W, o.y + j}});
        Spec w{6, {}};
        for (int j = 0; j < H; ++j)
            w.pairs.push_back({{o.x, o.y + j}, {o.x - 1, o.y + j}});
        specs = {n, s, e, w};
    }
    for (auto& sp : specs)
        if (exists(sp.pairs[0].second)) out.push_back({sp.d, sp.pairs});
    return out;
}

// ---------------------------------------------------------------- strokes

int Sim::stroke(GPos first, int first_wanted, int heading, int total,
                bool water_cls, int mode, const std::string& label) {
    bool semi = cfg.semi;
    bool ghost = false;
    int painted = 0, prev = 0;
    GPos pos = first;
    int r = cap_class(first, first_wanted, water_cls);
    if (r < 0 || (semi && base.count(first))) {
        if (r < 0) note(Ev::StrokeNote, label, "first_illegal");
        if (!semi) return 0;
        ghost = true;
        if (base.count(first)) trace_unit(first, label);
        painted = 0; prev = first_wanted; pos = first;
    } else {
        paint(first, r, label);
        painted = 1; prev = r; pos = first;
    }
    int steps = 1;
    while (steps < total) {
        int w;
        if (stroke_choice_) {
            w = pick(std::vector<int>{1, 2, 3, 4, 5, 6}, "wobble (choice)");
        } else {
            w = roll_die(6, "wobble");
        }
        if (w == 5) heading = (heading + 7) % 8;
        else if (w == 6) heading = (heading + 1) % 8;
        GPos tgt{pos.x + DIR_DX[heading], pos.y + DIR_DY[heading]};
        if (!exists(tgt)) {
            note(Ev::StrokeNote, label, "edge", DIR_NAME[heading]);
            break;
        }
        if (ghost) {
            if (base.count(tgt)) trace_unit(tgt, label);
            ++steps; pos = tgt;
            continue;
        }
        if (base.count(tgt)) {
            if (!wild.count(tgt) && in_cls(base.at(tgt), water_cls)) {
                M.merges += 1;
                note(Ev::StrokeNote, label, "merge", RUNG_NAME[base.at(tgt)]);
            } else {
                note(Ev::StrokeNote, label, "blocked",
                     wild.count(tgt) ? "anomaly" : RUNG_NAME[base.at(tgt)]);
            }
            if (!semi) break;
            ghost = true;
            trace_unit(tgt, label);
            ++steps; pos = tgt;
            continue;
        }
        int wanted = prev;
        if (mode == 1) wanted = std::max(0, prev - 1);       // dig
        else if (mode == 2) wanted = std::min(7, prev + 1);  // climb
        r = cap_class(tgt, wanted, water_cls);
        if (r < 0) {
            note(Ev::StrokeNote, label, "no_rung");
            if (!semi) break;
            ghost = true;
            ++steps; pos = tgt;
            continue;
        }
        paint(tgt, r, label);
        ++painted; ++steps;
        prev = r; pos = tgt;
    }
    M.stroke_units += painted;
    return painted;
}

std::optional<GPos> Sim::nudge_unit(Panel t, GPos g0,
                                    const std::function<bool(GPos)>& pred,
                                    const std::string& what) {
    std::vector<GPos> cands;
    for (GPos u : geo.units(t))
        if (pred(u)) cands.push_back(u);
    if (cands.empty()) return std::nullopt;
    int best = cheb(g0, cands[0]);
    for (GPos u : cands) best = std::min(best, cheb(g0, u));
    std::vector<GPos> near;
    for (GPos u : cands)
        if (cheb(g0, u) == best) near.push_back(u);
    GPos u = pick(near, "nudge " + what);
    if (!(u == g0)) M.nudges += 1;
    return u;
}

GPos Sim::roll_unit(Panel t) {
    if (geo.W == 5 && geo.H == 6) {
        int r = roll_die(6, "row");
        int c = roll_die(10, "column");
        c = c <= 5 ? c : c - 5;
        return geo.unit_at(t, r, c);
    }
    auto is_die = [](int n) {
        return n == 4 || n == 6 || n == 8 || n == 10 || n == 12 || n == 20;
    };
    int r, c;
    if (is_die(geo.H)) {
        r = roll_die(geo.H, "row");
    } else {
        std::vector<int> rows;
        for (int i = 1; i <= geo.H; ++i) rows.push_back(i);
        r = pick(rows, "row (choice)");
    }
    if (is_die(geo.W)) {
        c = roll_die(geo.W, "column");
    } else {
        std::vector<int> cols;
        for (int i = 1; i <= geo.W; ++i) cols.push_back(i);
        c = pick(cols, "column (choice)");
    }
    return geo.unit_at(t, r, c);
}

// ---------------------------------------------------------------- fill

void Sim::fill_quota(Panel t, int quota) {
    if (has_work_panel_) {
        t = work_panel_;
        has_work_panel_ = false;
        Event e; e.kind = Ev::WorkFollows; e.has_panel = true; e.panel = t;
        emit(std::move(e));
    }
    int done = 0;
    while (done < quota) {
        if (panels.at(t) >= geo.area()) {
            if (cfg.alive) {
                rework_walk(t, quota - done);
            } else {
                int n = quota - done;
                M.embellish += n;
                embellish_panel[t] += n;
                Event e; e.kind = Ev::FullEmbellish; e.a = n;
                e.has_panel = true; e.panel = t; // the panel that took them
                ev_action(std::move(e));
            }
            return;
        }
        fill_one(t);
        ++done;
    }
}

void Sim::rework_walk(Panel t, int steps) {
    GPos land = roll_unit(t);
    std::vector<GPos> order = geo.units(t); // row-major == sorted by (y, x)
    std::size_t i = 0;
    for (std::size_t k = 0; k < order.size(); ++k)
        if (order[k] == land) { i = k; break; }
    for (int k = 0; k < steps; ++k)
        rework_body(order[(i + static_cast<std::size_t>(k)) % order.size()]);
}

void Sim::rework_body(GPos g) {
    M.reworks += 1;
    if (wild.count(g) || marks.count(g)) {
        M.embellish += 1;
        embellish[g] += 1;
        Event e; e.kind = Ev::Hold; e.has_unit = true; e.unit = g; e.s1 = "land";
        ev_action(std::move(e));
        return;
    }
    if (people.contains(g) && !cfg.fragile) {
        M.embellish += 1;
        embellish[g] += 1;
        Event e; e.kind = Ev::Hold; e.has_unit = true; e.unit = g; e.s1 = "town";
        ev_action(std::move(e));
        return;
    }
    int cur = base.at(g);
    int fd = mood_fd(mood_);
    std::vector<int> nbs;
    for (GPos n : side_nb(g)) {
        auto it = base.find(n);
        if (it != base.end() && !wild.count(n)) nbs.push_back(it->second);
    }
    if (nbs.empty()) return;
    int want;
    if (fd <= 5) {
        std::map<int, int> tally;
        for (int r : nbs) tally[r] += 1;
        int top = 0;
        for (auto& kv : tally) top = std::max(top, kv.second);
        std::vector<int> doms;
        for (auto& kv : tally)
            if (kv.second == top) doms.push_back(kv.first);
        int dom = pick(doms, "rework dominant");
        want = cur + (dom > cur ? 1 : (dom < cur ? -1 : 0));
    } else if (fd <= 7) {
        want = cur + (cur < PL ? 1 : (cur > PL ? -1 : 0));
    } else {
        if (cur == PL) {
            want = pick(std::vector<int>{CO, HI}, "away direction");
        } else {
            want = cur < PL ? std::max(0, cur - 1) : std::min(7, cur + 1);
        }
    }
    int lo, hi;
    legal_interval(g, lo, hi);
    if (lo > hi || want == cur) {
        M.embellish += 1;
        embellish[g] += 1;
        Event e; e.kind = Ev::Hold; e.has_unit = true; e.unit = g; e.s1 = "settled";
        ev_action(std::move(e));
        return;
    }
    if (cfg.semi) {
        trace_unit(g, "walk");
        return;
    }
    // The living (non-semi) walk: unreachable through the reference CLI but
    // ported for engine completeness (CONTRACTS §5.1 marks these kinds).
    int newr = std::min(std::max(want, lo), hi);
    if (newr == CO || cur == CO) {
        bool watery = false;
        for (GPos n : side_nb(g)) {
            auto it = base.find(n);
            if (it != base.end() && is_water(it->second)) { watery = true; break; }
        }
        if (!watery) newr = PL;
    }
    if (newr == cur) {
        M.embellish += 1;
        embellish[g] += 1;
        Event e; e.kind = Ev::Hold; e.has_unit = true; e.unit = g; e.s1 = "settled";
        ev_action(std::move(e));
        return;
    }
    if ((newr == PL || newr == CO) && !(cur == PL || cur == CO)) {
        for (GPos n : side_nb(g)) {
            if (dens(n) >= 2) {
                M.embellish += 1;
                embellish[g] += 1;
                Event e; e.kind = Ev::Hold; e.has_unit = true; e.unit = g; e.s1 = "city_shore";
                ev_action(std::move(e));
                return;
            }
        }
    }
    int old = cur;
    base[g] = newr;
    {
        Event e; e.kind = Ev::ReworkChange; e.has_unit = true; e.unit = g;
        e.a = old; e.b = newr;
        ev_action(std::move(e));
    }
    if (people.contains(g)) {
        const std::string kind = *people.get(g);
        bool allowed = kind.rfind("farm", 0) == 0 ? (newr == PL)
                                                  : (newr == PL || newr == CO);
        if (!allowed) {
            people.erase(g);
            Event e; e.kind = Ev::HomesLost; e.has_unit = true; e.unit = g;
            ev_action(std::move(e));
            cascade();
        }
    }
}

void Sim::fill_one(Panel t) {
    M.fills += 1;
    std::vector<GPos> empties;
    for (GPos u : geo.units(t))
        if (!base.count(u)) empties.push_back(u);
    int mx = 0;
    std::map<GPos, int> counts;
    for (GPos u : empties) {
        int c = 0;
        for (GPos n : side_nb(u))
            if (base.count(n)) ++c;
        counts[u] = c;
        mx = std::max(mx, c);
    }
    GPos g;
    if (mx == 0) {
        g = roll_unit(t); // guaranteed empty (panel has no filled units)
        assert(!base.count(g));
    } else {
        std::vector<GPos> best;
        for (GPos u : empties)
            if (counts[u] == mx) best.push_back(u);
        g = pick(best, "fill spot");
    }
    int fd = mood_fd(mood_);
    std::vector<int> nbs;
    for (GPos n : side_nb(g)) {
        auto it = base.find(n);
        if (it != base.end() && !wild.count(n)) nbs.push_back(it->second);
    }
    int rung;
    if (nbs.empty()) {
        int fr = roll_die(6, "first elevation");
        static const int FIRST[7] = {0, SH, CO, PL, PL, HI, MO};
        rung = FIRST[fr];
    } else {
        std::map<int, int> tally;
        for (int r : nbs) tally[r] += 1;
        int top = 0;
        for (auto& kv : tally) top = std::max(top, kv.second);
        std::vector<int> doms;
        for (auto& kv : tally)
            if (kv.second == top) doms.push_back(kv.first);
        int dom = pick(doms, "dominant tie");
        rung = dom;
        if (fd == 6 || fd == 7) {
            rung = dom + (dom < PL ? 1 : (dom > PL ? -1 : 0));
        } else if (fd == 8) {
            if (dom == PL) rung = pick(std::vector<int>{CO, HI}, "away direction");
            else if (dom < PL) rung = std::max(0, dom - 1);
            else rung = std::min(7, dom + 1);
        }
    }
    int lo, hi;
    legal_interval(g, lo, hi);
    if (lo > hi) {
        int mn = nbs[0];
        for (int r : nbs) mn = std::min(mn, r);
        rung = mn + 1;
        M.cliffs += 1;
        note(Ev::Cliff);
    } else {
        rung = std::min(std::max(rung, lo), hi);
    }
    paint(g, rung, "fill");
}

// ---------------------------------------------------------------- cards

void Sim::card_calm(Panel) { note(Ev::Calm); }

void Sim::card_ridge(Panel t, bool great) {
    std::vector<GPos> cands;
    for (GPos u : geo.units(t))
        if (!base.count(u) && cap_class(u, HI, false) >= 0) cands.push_back(u);
    if (cands.empty() && cfg.semi) {
        cands = geo.units(t);
        std::sort(cands.begin(), cands.end());
    }
    if (cands.empty()) {
        skip_card(great ? "greatridge" : "ridge", "no legal seed");
        return;
    }
    GPos g = pick(cands, "ridge seed (choice)");
    std::vector<int> headings{0, 1, 2, 3, 4, 5, 6, 7};
    int h = pick(headings, "heading (choice)");
    int L;
    if (great && cfg.greatridge_die) {
        L = roll_die(cfg.greatridge_die, "length") + cfg.greatridge_add;
    } else {
        std::vector<int> lens;
        if (great) for (int v = 4; v <= 10; ++v) lens.push_back(v);
        else for (int v = 2; v <= 5; ++v) lens.push_back(v);
        L = pick(lens, "length (choice)");
    }
    stroke_choice_ = true;
    stroke(g, HI, h, L, false, 2, "ridge");
    stroke_choice_ = false;
}

namespace {
struct BasinCand {
    GPos start;
    bool has_facing = false;
    GPos facing{};
    bool operator<(const BasinCand& o) const { return start < o.start; }
};
} // namespace

void Sim::card_basin(Panel t) {
    std::vector<BasinCand> cands;
    for (GPos u : geo.units(t)) {
        auto it = base.find(u);
        if (it != base.end() && is_water(it->second) && !wild.count(u))
            cands.push_back({u, false, {}});
    }
    for (auto& bs : border_pairs(t)) {
        for (auto& pr : bs.pairs) {
            GPos inside = pr.first, outside = pr.second;
            auto it = base.find(outside);
            if (it != base.end() && is_water(it->second) && !wild.count(outside) &&
                !base.count(inside) && cap_class(inside, it->second, true) >= 0)
                cands.push_back({outside, true, inside});
        }
    }
    if (!cands.empty()) {
        BasinCand chosen = pick(cands, "basin start");
        int L = roll_die(cfg.stroke_die, "len") + cfg.stroke_add;
        int ref = base.at(chosen.start);
        if (!chosen.has_facing) {
            int h = roll_die(8, "heading") - 1;
            GPos tgt{chosen.start.x + DIR_DX[h], chosen.start.y + DIR_DY[h]};
            if (!exists(tgt) || (base.count(tgt) && !cfg.semi)) {
                skip_card("basin", "grow blocked immediately");
                return;
            }
            stroke(tgt, std::max(0, ref - 1), h, L, true, 1, "basin grow");
        } else {
            int dx = chosen.facing.x - chosen.start.x;
            int dy = chosen.facing.y - chosen.start.y;
            int h = 0;
            for (int d = 0; d < 8; ++d)
                if (DIR_DX[d] == dx && DIR_DY[d] == dy) { h = d; break; }
            stroke(chosen.facing, std::max(0, ref - 1), h, L, true, 1, "basin grow");
        }
        return;
    }
    GPos g0 = roll_unit(t);
    std::optional<GPos> g = nudge_unit(
        t, g0,
        [&](GPos u) { return !base.count(u) && cap_class(u, SH, true) >= 0; },
        "basin seed");
    if (!g && cfg.semi) g = g0;
    if (!g) {
        skip_card("basin", "no legal seed");
        return;
    }
    int h = roll_die(8, "heading") - 1;
    int L = roll_die(cfg.stroke_die, "len") + cfg.stroke_add;
    stroke(*g, SH, h, L, true, 1, "basin seed");
}

namespace {
struct ExtRun {
    int length;
    int d;
    bool water_cls;
    std::vector<std::pair<GPos, GPos>> seg;             // (inside, outside)
    std::vector<std::pair<int, std::pair<GPos, GPos>>> open_facing;
};
struct EntryCand {
    int k;
    std::pair<GPos, GPos> p;
    bool operator<(const EntryCand& o) const { return k < o.k; }
};
} // namespace

void Sim::card_extend(Panel t) {
    std::vector<ExtRun> runs;
    for (auto& bs : border_pairs(t)) {
        const auto& pairs = bs.pairs;
        std::size_t i = 0;
        while (i < pairs.size()) {
            GPos out = pairs[i].second;
            int cls = -1; // 0 water, 1 heights
            auto it = base.find(out);
            if (it != base.end() && !wild.count(out)) {
                if (is_water(it->second)) cls = 0;
                else if (is_height(it->second)) cls = 1;
            }
            if (cls < 0) { ++i; continue; }
            bool water_cls = cls == 0;
            std::size_t j = i;
            while (j + 1 < pairs.size()) {
                GPos nxt = pairs[j + 1].second;
                auto itn = base.find(nxt);
                if (itn != base.end() && !wild.count(nxt) &&
                    in_cls(itn->second, water_cls)) ++j;
                else break;
            }
            std::vector<std::pair<GPos, GPos>> seg(pairs.begin() + static_cast<long>(i),
                                                   pairs.begin() + static_cast<long>(j + 1));
            std::vector<std::pair<int, std::pair<GPos, GPos>>> open_facing;
            for (std::size_t k = 0; k < seg.size(); ++k) {
                if (!base.count(seg[k].first) &&
                    cap_class(seg[k].first, base.at(seg[k].second), water_cls) >= 0)
                    open_facing.push_back({static_cast<int>(k), seg[k]});
            }
            if (open_facing.empty() && cfg.semi) {
                // nearest to the middle, first wins ties (Python min)
                int n = static_cast<int>(seg.size());
                int bestk = 0, bestd2 = 1 << 30;
                for (int k = 0; k < n; ++k) {
                    int d2 = std::abs(2 * k - (n - 1));
                    if (d2 < bestd2) { bestd2 = d2; bestk = k; }
                }
                open_facing.push_back({bestk, seg[static_cast<std::size_t>(bestk)]});
            }
            if (!open_facing.empty())
                runs.push_back({static_cast<int>(j - i + 1), bs.d, water_cls, seg,
                                open_facing});
            i = j + 1;
        }
    }
    if (runs.empty()) {
        skip_card("extend", "no open runs");
        return;
    }
    long long cap = cfg.extend_cap ? cfg.extend_cap : 1000000000LL;
    auto counted = [&](const ExtRun& r) {
        return std::min(static_cast<long long>(r.length), cap);
    };
    long long best = counted(runs[0]);
    for (auto& r : runs) best = std::max(best, counted(r));
    std::vector<int> idxs;
    for (std::size_t k = 0; k < runs.size(); ++k)
        if (counted(runs[k]) == best) idxs.push_back(static_cast<int>(k));
    const ExtRun run = runs[static_cast<std::size_t>(pick(idxs, "extend run"))];
    int n = static_cast<int>(run.seg.size());
    int bestd = 1 << 30;
    for (auto& kp : run.open_facing)
        bestd = std::min(bestd, std::abs(2 * kp.first - (n - 1)));
    std::vector<EntryCand> entries;
    for (auto& kp : run.open_facing)
        if (std::abs(2 * kp.first - (n - 1)) == bestd)
            entries.push_back({kp.first, kp.second});
    EntryCand entry = pick(entries, "extend entry");
    GPos inside = entry.p.first, outside = entry.p.second;
    int heading = (run.d + 4) % 8;
    int L = roll_die(cfg.stroke_die, "len") + cfg.stroke_add;
    {
        Event e; e.kind = Ev::ExtendRun; e.a = run.length;
        e.s1 = run.water_cls ? "water" : "heights";
        e.s2 = DIR_NAME[run.d];
        emit(std::move(e));
    }
    stroke(inside, base.at(outside), heading, L, run.water_cls, 0, "extend");
}

void Sim::card_free(Panel t) {
    bool water_cls = pick(std::vector<int>{0, 1}, "free class (choice)") == 0;
    int seedr = water_cls ? SH : HI;
    std::vector<GPos> cands;
    for (GPos u : geo.units(t))
        if (!base.count(u) && cap_class(u, seedr, water_cls) >= 0)
            cands.push_back(u);
    if (cands.empty() && cfg.semi) cands = geo.units(t);
    if (cands.empty()) {
        skip_card("freestroke", "no legal seed");
        return;
    }
    GPos g = pick(cands, "free seed (choice)");
    std::vector<int> headings{0, 1, 2, 3, 4, 5, 6, 7};
    int h = pick(headings, "heading (choice)");
    int L = roll_die(cfg.stroke_die, "len") + cfg.stroke_add;
    stroke(g, seedr, h, L, water_cls, water_cls ? 1 : 2, "free stroke");
}

// ---------------------------------------------------------------- settlement

int Sim::dens(GPos u) const {
    const std::string* k = people.get(u);
    return k ? dens_of_kind(*k) : 0;
}

// Fields are not people (handbook ch. 9): farmland is off the density ladder.
bool Sim::is_field(GPos u) const {
    const std::string* k = people.get(u);
    return k && k->rfind("farm", 0) == 0;
}

bool Sim::constrains(GPos u) const {
    auto it = base.find(u);
    return it != base.end() && (it->second == PL || it->second == CO) &&
           !wild.count(u) &&
           // ch. 9: a field never blocks a density step
           !is_field(u);
}

bool Sim::dens_legal(GPos u, int d) const {
    for (GPos n : side_nb(u)) {
        if (constrains(n) && std::abs(d - dens(n)) > 1) return false;
    }
    return true;
}

bool Sim::neighbors_of_height(GPos u, int need) const {
    int n = 0;
    for (int dx = -1; dx <= 1; ++dx)
        for (int dy = -1; dy <= 1; ++dy) {
            GPos v{u.x + dx, u.y + dy};
            // ch. 9: a field never counts toward the support a tower needs
            if ((dx || dy) && people.contains(v) && !is_field(v))
                ++n;
        }
    return n >= need;
}

void Sim::note_first(const std::string& kind) {
    const char* name = display_name(kind);
    if (name && !firsts.count(name)) firsts[name] = era;
}

void Sim::cascade() {
    for (;;) {
        std::vector<GPos> viol;
        people.for_each([&](GPos u, const std::string& kind) {
            if (!down_of(kind)) return;
            for (GPos n : side_nb(u)) {
                if (constrains(n) && dens(n) < dens(u) - 1) {
                    viol.push_back(u);
                    return;
                }
            }
        });
        if (viol.empty()) return;
        std::sort(viol.begin(), viol.end());
        GPos u = viol[0];
        people.set(u, down_of(*people.get(u)));
        M.crumbles += 1;
        Event e; e.kind = Ev::Crumble; e.has_unit = true; e.unit = u;
        ev_action(std::move(e));
    }
}

std::vector<std::vector<GPos>> Sim::settlement_components(Panel t) {
    std::set<GPos> zone;
    for (GPos u : geo.units(t)) zone.insert(u);
    static const int SDX[4] = {0, 0, 1, -1};
    static const int SDY[4] = {1, -1, 0, 0};
    for (int s = 0; s < 4; ++s) {
        Panel nb = Geo::side_panel(t, SDX[s], SDY[s]);
        if (panels.count(nb))
            for (GPos u : geo.units(nb)) zone.insert(u);
    }
    std::vector<GPos> seeds;
    people.for_each([&](GPos u, const std::string& kind) {
        if ((kind.rfind("rural", 0) == 0 || kind.rfind("urb", 0) == 0) &&
            zone.count(u))
            seeds.push_back(u);
    });
    std::vector<std::vector<GPos>> comps;
    std::set<GPos> seen;
    for (GPos s : seeds) {
        if (seen.count(s)) continue;
        std::set<GPos> comp;
        std::vector<GPos> q{s};
        while (!q.empty()) {
            GPos u = q.back();
            q.pop_back();
            if (comp.count(u)) continue;
            comp.insert(u);
            seen.insert(u);
            for (int dx = -1; dx <= 1; ++dx)
                for (int dy = -1; dy <= 1; ++dy) {
                    GPos v{u.x + dx, u.y + dy};
                    if (people.contains(v) && !comp.count(v)) q.push_back(v);
                }
        }
        comps.push_back(std::vector<GPos>(comp.begin(), comp.end())); // sorted
    }
    return comps;
}

namespace {
struct PlaceCand {
    GPos u;
    bool needs_paint = false;
    std::vector<int> legal;
    bool operator<(const PlaceCand& o) const { return u < o.u; }
};
} // namespace

bool Sim::place_people(const std::vector<GPos>& cand_units, const std::string& kind,
                       const std::vector<int>& bases) {
    int d = dens_of_kind(kind);
    std::vector<PlaceCand> ok;
    for (GPos u : cand_units) {
        if (people.contains(u) || wild.count(u)) continue;
        // ch. 9: a field is never itself subject to the People Step Rule
        if (!(kind.rfind("farm", 0) == 0 || dens_legal(u, d))) continue;
        auto it = base.find(u);
        if (it != base.end()) {
            if (std::find(bases.begin(), bases.end(), it->second) != bases.end())
                ok.push_back({u, false, {}});
        } else if (exists(u)) {
            int lo, hi;
            legal_interval(u, lo, hi);
            std::vector<int> legal;
            for (int b : bases)
                if (lo <= b && b <= hi) legal.push_back(b);
            if (!legal.empty()) ok.push_back({u, true, legal});
        }
    }
    if (ok.empty()) return false;
    PlaceCand chosen = pick(ok, "place " + kind);
    if (chosen.needs_paint) {
        int b = chosen.legal.size() == 1 ? chosen.legal[0]
                                         : pick(chosen.legal, "people base");
        paint(chosen.u, b, "people base");
    }
    people.set(chosen.u, kind);
    note_first(kind);
    Event e; e.kind = Ev::People; e.has_unit = true; e.unit = chosen.u; e.s1 = kind;
    ev_action(std::move(e));
    return true;
}

std::vector<GPos> Sim::touching(const std::vector<GPos>& comp) const {
    std::set<GPos> inset(comp.begin(), comp.end()), s;
    for (GPos u : comp)
        for (int dx = -1; dx <= 1; ++dx)
            for (int dy = -1; dy <= 1; ++dy) {
                GPos v{u.x + dx, u.y + dy};
                if (!inset.count(v) && exists(v)) s.insert(v);
            }
    return std::vector<GPos>(s.begin(), s.end()); // sorted
}

bool Sim::rural_spot(const std::vector<GPos>& comp) {
    std::vector<GPos> cands = touching(comp);
    if (!comp.empty()) {
        int top = 0;
        for (GPos u : comp) top = std::max(top, dens(u));
        if (top >= 1) {
            std::vector<GPos> anchors;
            for (GPos u : comp)
                if (dens(u) == top) anchors.push_back(u);
            std::vector<GPos> near;
            for (GPos c : cands) {
                bool close = false;
                for (GPos a : anchors)
                    if (cheb(c, a) <= 1) { close = true; break; }
                if (close && !people.contains(c) && !wild.count(c) &&
                    dens_legal(c, 1))
                    near.push_back(c);
            }
            if (!near.empty()) return place_people(near, "rural", {CO, PL});
        }
    }
    return place_people(cands, "rural", {CO, PL});
}

bool Sim::try_upgrade(const std::vector<GPos>& comp) {
    std::vector<GPos> risers;
    for (GPos u : comp) {
        const std::string* k = people.get(u);
        if (!k || !up_of(*k)) continue;
        int du = dens(u);
        if (!dens_legal(u, du + 1)) continue;
        if (du + 1 < 3 || neighbors_of_height(u, du)) risers.push_back(u);
    }
    if (!risers.empty()) {
        int top = 0;
        for (GPos u : risers) top = std::max(top, dens(u));
        std::vector<GPos> topping;
        for (GPos u : risers)
            if (dens(u) == top) topping.push_back(u);
        GPos u = pick(topping, "riser");
        people.set(u, up_of(*people.get(u)));
        note_first(*people.get(u));
        note(Ev::Upgrade, *people.get(u));
        return true;
    }
    if (rural_spot(comp)) {
        note(Ev::Sprawl);
        return true;
    }
    return false;
}

void Sim::grow_once(const std::vector<GPos>& comp) {
    int g = roll_die(6, "grow");
    if (g <= 2) {
        // ch. 9, growth d6 row 1-2: deepen a low field of the settlement before
        // clearing new ground; only when none remains does the town clear more.
        std::vector<GPos> lows;
        for (GPos u : comp) {
            const std::string* k = people.get(u);
            if (k && *k == "farm_lo") lows.push_back(u);
        }
        if (!lows.empty()) {
            GPos u = pick(lows, "deepen field"); // sorts; silent when single
            people.set(u, "farm_hi");
            Event e; e.kind = Ev::FieldDeepens; e.has_unit = true; e.unit = u;
            ev_action(std::move(e));
        } else if (!place_people(touching(comp), "farm_lo", {PL})) {
            skip_card("settlement", "no room for farmland");
        }
    } else if (g <= 4) {
        if (!rural_spot(comp)) skip_card("settlement", "no room for rural");
    } else {
        if (!try_upgrade(comp)) skip_card("settlement", "nothing can grow");
    }
}

void Sim::city_lives(Panel t) {
    auto comps = settlement_components(t);
    if (comps.empty()) return;
    auto key = [&](const std::vector<GPos>& c) {
        int top = 0;
        for (GPos u : c) top = std::max(top, dens(u));
        return std::pair<int, int>(top, static_cast<int>(c.size()));
    };
    std::pair<int, int> best = key(comps[0]);
    for (auto& c : comps) best = std::max(best, key(c));
    std::vector<int> tied;
    for (std::size_t i = 0; i < comps.size(); ++i)
        if (key(comps[i]) == best) tied.push_back(static_cast<int>(i));
    int idx = tied.size() == 1 ? tied[0] : pick(tied, "living city");
    note(Ev::CityLives);
    try_upgrade(comps[static_cast<std::size_t>(idx)]);
}

void Sim::card_settlement(Panel t) {
    auto comps = settlement_components(t);
    if (!comps.empty()) {
        auto key = [&](const std::vector<GPos>& c) {
            int top = 0;
            for (GPos u : c) top = std::max(top, dens(u));
            return std::pair<int, int>(top, static_cast<int>(c.size()));
        };
        std::pair<int, int> best = key(comps[0]);
        for (auto& c : comps) best = std::max(best, key(c));
        std::vector<int> tied;
        for (std::size_t i = 0; i < comps.size(); ++i)
            if (key(comps[i]) == best) tied.push_back(static_cast<int>(i));
        int idx = tied.size() == 1 ? tied[0] : pick(tied, "lead city");
        std::vector<GPos> comp = comps[static_cast<std::size_t>(idx)];
        for (int rep = 0; rep < 2; ++rep) {
            std::vector<GPos> halo;
            people.for_each([&](GPos u, const std::string&) {
                for (GPos v : comp)
                    if (cheb(u, v) <= 1) { halo.push_back(u); return; }
            });
            if (!halo.empty()) comp = halo;
            grow_once(comp);
        }
        return;
    }
    GPos g0 = roll_unit(t);
    std::optional<GPos> home = nudge_unit(
        t, g0,
        [&](GPos u) {
            auto it = base.find(u);
            return it != base.end() && (it->second == PL || it->second == CO) &&
                   !people.contains(u) && !wild.count(u);
        },
        "home");
    if (!home) {
        if (base.count(g0)) trace_unit(g0, "settlement");
        else skip_card("settlement", "no legal home", "leave a waymark");
        return;
    }
    int f = roll_die(6, "foundation");
    auto put = [&](GPos u, const std::string& kind, const std::string& why) {
        people.set(u, kind);
        Event e; e.kind = Ev::People; e.has_unit = true; e.unit = u;
        e.s1 = kind; e.s2 = why;
        ev_action(std::move(e));
    };
    if (f <= 3) {
        note(Ev::Foundation, "hamlet");
        put(*home, "rural", "found hamlet");
    } else if (f <= 5) {
        note(Ev::Foundation, "village");
        put(*home, "rural", "found village");
        place_people(touching({*home}), "rural", {CO, PL});
    } else {
        note(Ev::Foundation, "town");
        for (GPos n : side_nb(*home)) {
            if (constrains(n) && !people.contains(n)) put(n, "rural", "town ring");
        }
        if (dens_legal(*home, 2)) {
            put(*home, "urb_lo", "town core");
            note_first("urb_lo");
        } else {
            put(*home, "rural", "town core, capped");
        }
    }
    std::vector<GPos> comp;
    people.for_each([&](GPos u, const std::string&) {
        if (cheb(u, *home) <= 2) comp.push_back(u);
    });
    std::string kind = roll_die(4, "farm intensity") <= 2 ? "farm_lo" : "farm_hi";
    place_people(touching(comp), kind, {PL});
}

// ---------------------------------------------------------------- anomaly

void Sim::card_anomaly(Panel t) {
    int a = roll_die(12, "anomaly");
    GPos g0 = roll_unit(t);
    bool frag = cfg.fragile;
    auto water_u = [&](GPos u) {
        auto it = base.find(u);
        return it != base.end() && is_water(it->second) && !wild.count(u) &&
               (!people.contains(u) || frag);
    };
    auto dry_u = [&](GPos u) {
        auto it = base.find(u);
        return it != base.end() && it->second >= CO && !wild.count(u) &&
               (!people.contains(u) || frag);
    };
    auto strike = [&](GPos u) {
        if (frag && people.contains(u)) {
            people.erase(u);
            Event e; e.kind = Ev::AnomalyStrike; e.has_unit = true; e.unit = u;
            ev_action(std::move(e));
            hit_ = true;
        }
    };
    hit_ = false;
    auto beside = [&](GPos u, const std::function<bool(GPos)>& pred) {
        for (GPos n : side_nb(u))
            if (pred(n)) return true;
        return false;
    };
    std::string name = "?";
    bool done = false;
    if (a == 1) {
        name = "lone island";
        auto g = nudge_unit(t, g0, water_u, name);
        if (g) { strike(*g); base[*g] = HI; wild.insert(*g); done = true; }
    } else if (a == 2) {
        name = "sunken land";
        auto g = nudge_unit(t, g0, [&](GPos u) {
            return (dry_u(u) || !base.count(u)) &&
                   beside(u, [&](GPos n) {
                       auto it = base.find(n);
                       return it != base.end() && is_water(it->second);
                   });
        }, name);
        if (g) {
            strike(*g);
            if (!base.count(*g)) paint(*g, CO, name);
            else base[*g] = CO;
            set_mark(*g, "sunken");
            done = true;
        }
    } else if (a == 3) {
        name = "crater lake";
        auto g = nudge_unit(t, g0, [&](GPos u) {
            auto it = base.find(u);
            return it != base.end() && it->second == MO && !wild.count(u);
        }, name);
        if (g) { base[*g] = SH; wild.insert(*g); done = true; }
    } else if (a == 4) {
        name = "archipelago";
        int n = roll_die(4, "islets");
        GPos prev = g0;
        for (int k = 0; k < n; ++k) {
            auto g = nudge_unit(t, prev, [&](GPos u) {
                return water_u(u) && cheb(u, prev) <= 2;
            }, name);
            if (!g) break;
            strike(*g);
            base[*g] = CO;
            wild.insert(*g);
            prev = *g;
            done = true;
        }
    } else if (a == 5) {
        name = "marsh";
        auto g = nudge_unit(t, g0, [&](GPos u) {
            auto it = base.find(u);
            bool coastal = it != base.end() && it->second == CO && !wild.count(u) &&
                           (!people.contains(u) || frag);
            bool empty_by_water = !base.count(u) &&
                                  beside(u, [&](GPos n) {
                                      auto bn = base.find(n);
                                      return bn != base.end() && is_water(bn->second);
                                  });
            return coastal || empty_by_water;
        }, name);
        if (g) {
            strike(*g);
            if (!base.count(*g)) paint(*g, CO, name);
            set_mark(*g, "marsh");
            done = true;
        }
    } else if (a == 6) {
        name = "trench";
        auto g = nudge_unit(t, g0, water_u, name);
        if (g) { strike(*g); base[*g] = VD; wild.insert(*g); done = true; }
    } else if (a == 7) {
        name = "mesa";
        auto g = nudge_unit(t, g0, [&](GPos u) {
            auto it = base.find(u);
            bool plainish = it != base.end() && it->second == PL &&
                            !wild.count(u) && !people.contains(u);
            bool empty_by_plain = !base.count(u) &&
                                  beside(u, [&](GPos n) {
                                      auto bn = base.find(n);
                                      return bn != base.end() && bn->second == PL;
                                  });
            return plainish || empty_by_plain;
        }, name);
        if (g) {
            strike(*g);
            if (!base.count(*g)) paint(*g, MO, name);
            else base[*g] = MO;
            wild.insert(*g);
            done = true;
        }
    } else if (a == 8) {
        name = "oasis";
        auto far = [&](GPos u) {
            for (int dx = -3; dx <= 3; ++dx)
                for (int dy = -3; dy <= 3; ++dy) {
                    auto it = base.find({u.x + dx, u.y + dy});
                    if (it != base.end() && is_water(it->second)) return false;
                }
            return true;
        };
        auto g = nudge_unit(t, g0, [&](GPos u) { return dry_u(u) && far(u); }, name);
        if (g) {
            strike(*g);
            base[*g] = SH;
            wild.insert(*g);
            place_people(touching({*g}), "farm_lo", {PL});
            done = true;
        }
    } else if (a == 9) {
        name = "volcano";
        auto g = nudge_unit(t, g0, [&](GPos u) {
            auto it = base.find(u);
            return !base.count(u) ||
                   (it != base.end() && is_height(it->second) && !wild.count(u));
        }, name);
        if (g) {
            if (!base.count(*g)) paint(*g, MO, name);
            else base[*g] = MO;
            set_mark(*g, "volcano");
            done = true;
            for (int dx = -1; dx <= 1; ++dx)
                for (int dy = -1; dy <= 1; ++dy) {
                    if (dx == 0 && dy == 0) continue;
                    GPos nb{g->x + dx, g->y + dy};
                    if (base.count(nb) && !wild.count(nb)) {
                        strike(nb);
                        base[nb] = HI;
                    }
                }
            Event e; e.kind = Ev::VolcanoRing; e.has_unit = true; e.unit = *g;
            ev_action(std::move(e));
        }
    } else if (a == 10) {
        name = "canyon";
        auto g = nudge_unit(t, g0, dry_u, name);
        if (g) { strike(*g); set_mark(*g, "canyon"); done = true; }
    } else if (a == 11) {
        name = "old ruins";
        auto farp = [&](GPos u) {
            for (int dx = -3; dx <= 3; ++dx)
                for (int dy = -3; dy <= 3; ++dy)
                    if (people.contains({u.x + dx, u.y + dy})) return false;
            return true;
        };
        auto g = nudge_unit(t, g0, [&](GPos u) { return dry_u(u) && farp(u); }, name);
        if (g) { strike(*g); set_mark(*g, "ruins"); done = true; }
    } else {
        name = "wonder";
        auto g = nudge_unit(t, g0, dry_u, name);
        if (g) { strike(*g); set_mark(*g, "star"); done = true; }
    }
    if (done) note(Ev::AnomalyResult, name);
    if (hit_) cascade();
    if (!done) skip_card("anomaly", name + " does not fit");
}

// ---------------------------------------------------------------- add a panel

bool Sim::panel_touches(Panel tk) const {
    static const int SDX[4] = {0, 0, 1, -1};
    static const int SDY[4] = {1, -1, 0, 0};
    for (int s = 0; s < 4; ++s)
        if (panels.count(Geo::side_panel(tk, SDX[s], SDY[s]))) return true;
    return false;
}

bool Sim::loose_end(Panel tk) const {
    for (GPos u : geo.units(tk)) {
        for (GPos n : side_nb(u)) {
            auto it = base.find(n);
            if (it != base.end() && (is_water(it->second) || is_height(it->second)))
                return true;
        }
    }
    return false;
}

void Sim::card_addpanel() {
    std::set<Panel> cset;
    static const int SDX[4] = {0, 0, 1, -1};
    static const int SDY[4] = {1, -1, 0, 0};
    for (auto& kv : panels) {
        for (int s = 0; s < 4; ++s) {
            Panel nb = Geo::side_panel(kv.first, SDX[s], SDY[s]);
            if (!panels.count(nb) && panel_touches(nb)) cset.insert(nb);
        }
    }
    std::vector<Panel> cands(cset.begin(), cset.end()); // sorted
    if (cands.empty()) {
        skip_card("addpanel", "no open positions");
        return;
    }
    auto score = [](Panel c) { return c.tx * c.tx + c.ty * c.ty; };
    int s = score(cands[0]);
    for (Panel c : cands) s = std::min(s, score(c));
    std::vector<Panel> nearest;
    for (Panel c : cands)
        if (score(c) == s) nearest.push_back(c);
    std::vector<Panel> loose;
    for (Panel c : nearest)
        if (loose_end(c)) loose.push_back(c);
    if (!loose.empty()) nearest = loose;
    Panel np = pick(nearest, "panel position");
    panels[np] = 0;
    stack.push_back(np);
    work_panel_ = np;
    has_work_panel_ = true;
    added_per_era[era] += 1;
    Event e; e.kind = Ev::NewPanel; e.has_panel = true; e.panel = np;
    e.a = static_cast<std::int64_t>(np.tx) * np.tx +
          static_cast<std::int64_t>(np.ty) * np.ty; // the distance score, book ch. 9
    ev_action(std::move(e));
}

// ---------------------------------------------------------------- turn loop

std::map<std::string, int> Sim::work_table() const {
    std::map<std::string, int> wa = cfg.alive ? work_living() : work_standard();
    for (auto& kv : cfg.work_overrides) wa[kv.first] = kv.second;
    return wa;
}

void Sim::build_deck() {
    auto wa = work_table();
    std::vector<Card> cards;
    for (auto& kn : cfg.deck) {
        for (int w : spread_work(wa.at(kn.first), kn.second, cfg.work_spread))
            cards.push_back({kn.first, w, next_uid++});
    }
    std::vector<std::uint32_t> perm = dec_->shuffle(cards.size(), "deck");
    deck.clear();
    for (std::size_t k = 0; k < cards.size(); ++k)
        deck.push_back(cards[perm[k]]);
}

// A config the rules cannot be played on is refused here, once, for every
// surface: the CLI prints it, the FFI turns it into a null handle. Nothing
// below this point may assert on a value a caller could have supplied. Found
// by the error-path suite (FORK_NOTES: the gate exercises happy paths only) —
// a 0x0 panel reached pick() with no candidates and took the engine down.
static void validate(const Config& c, int eras) {
    auto bad = [](const std::string& why) {
        throw std::invalid_argument("config: " + why);
    };
    if (c.panel_w < 2 || c.panel_w > 64 || c.panel_h < 2 || c.panel_h > 64)
        bad("panel is " + std::to_string(c.panel_w) + "x" +
            std::to_string(c.panel_h) + "; each side must be 2..64");
    if (eras < 1 || eras > 100000) bad("eras must be 1..100000");
    if (c.stroke_die < 1 || c.stroke_die > 100) bad("stroke die must be 1..100");
    if (c.stroke_add < 0 || c.stroke_add > 100) bad("stroke bonus must be 0..100");
    if (c.greatridge_die < 0 || c.greatridge_die > 100)
        bad("great ridge die must be 0..100 (0 means the player chooses)");
    if (c.greatridge_add < 0 || c.greatridge_add > 100)
        bad("great ridge bonus must be 0..100");
    if (c.extend_cap < 0 || c.extend_cap > 1000) bad("extend cap must be 0..1000");
    if (c.archive_permille < 0 || c.archive_permille > 1000)
        bad("archive chance must be 0..100 percent");
    if (c.addpanel_copies > 1000) bad("too many Add Panel copies");
    int cards = 0;
    for (const auto& kv : c.deck) {
        if (kv.second < 0 || kv.second > 1000)
            bad("deck: " + kv.first + " has an impossible number of copies");
        cards += kv.second;
    }
    if (cards < 1) bad("the deck is empty");
}

Sim::Sim(const Config& config, std::int64_t sd, int eras, Decider& dec)
    : cfg(config), seed(sd), eras_wanted(eras), dec_(&dec) {
    validate(cfg, eras);
    geo.W = cfg.panel_w;
    geo.H = cfg.panel_h;
    if (cfg.addpanel_copies < 0) cfg.addpanel_copies = cfg.alive ? 1 : 4;
    if (cfg.semi) cfg.alive = true;
    std::vector<Panel> layout;
    if (geo.W == 5 && geo.H == 6) {
        layout = {{-1, 2}, {1, 2}, {-2, 1}, {-1, 1}, {1, 1}, {2, 1},
                  {-2, -1}, {-1, -1}, {1, -1}, {2, -1}, {-1, -2}, {1, -2}};
    } else {
        layout = {{-1, 1}, {1, 1}, {-1, -1}, {1, -1}};
    }
    genesis = layout;
    for (Panel tk : layout) {
        panels[tk] = 0;
        stack.push_back(tk);
    }
    Event e; e.kind = Ev::RunStart; e.a = seed; e.b = eras_wanted;
    emit(std::move(e));
    build_deck();
    Event e1; e1.kind = Ev::EraStart; e1.a = 1;
    emit(std::move(e1));
}

bool Sim::step() {
    if (finished_) return false;
    if (era > eras_wanted) { // a world loaded at its end finishes here
        finish_run();
        return false;
    }
    Card c = deck.front();
    deck.pop_front();
    if (stack.empty()) {
        M.free_panels += 1;
        Event e; e.kind = Ev::FreePanel; e.a = era;
        emit(std::move(e));
        card_addpanel();
    }
    auto set_mood = [&] {
        auto mo = cfg.mood_overrides.find(c.kind);
        mood_ = mo != cfg.mood_overrides.end() ? mo->second : mood_of(c.kind);
    };

    if (c.kind == "addpanel") {
        // v0.7, handbook ch. 6 note 3: step 2 is skipped — the panel this card
        // places IS the working panel. The front of the Stack is not popped,
        // not cycled, and is visited next age; the new panel entered the back
        // of the Stack once, at placement. No city-lives step fires: a newborn
        // panel has no settlement.
        ages_total += 1;
        age_in_era += 1;
        {
            Event e; e.kind = Ev::AgeStart; e.a = era; e.b = age_in_era;
            e.s1 = c.kind; // no panel: the header reads "the new panel"
            emit(std::move(e));
        }
        step_no_ = 0;
        set_mood();
        card_addpanel(); // may skip (no open positions), leaving no panel
        const bool placed = has_work_panel_;
        Panel t{};
        if (placed) {
            t = work_panel_;
            cur_panel_ = t;
            have_cur_ = true;
        } else {
            have_cur_ = false;
        }
        int quota = c.work;
        note(Ev::Work, mood_, "", "", quota);
        if (placed) fill_quota(t, quota); // consumes work_panel_, logs the line
    } else {
        Panel t = stack.front();
        stack.pop_front();
        ages_total += 1;
        age_in_era += 1;
        {
            Event e; e.kind = Ev::AgeStart; e.a = era; e.b = age_in_era;
            e.has_panel = true; e.panel = t; e.s1 = c.kind;
            emit(std::move(e));
        }
        cur_panel_ = t;
        have_cur_ = true;
        step_no_ = 0;
        set_mood();
        if (c.kind == "extend") card_extend(t);
        else if (c.kind == "basin") card_basin(t);
        else if (c.kind == "ridge") card_ridge(t, false);
        else if (c.kind == "greatridge") card_ridge(t, true);
        else if (c.kind == "settlement") card_settlement(t);
        else if (c.kind == "calm") card_calm(t);
        else if (c.kind == "anomaly") card_anomaly(t);
        else if (c.kind == "freestroke") card_free(t);
        else throw std::runtime_error("unknown card kind: " + c.kind);
        int quota = c.work;
        note(Ev::Work, mood_, "", "", quota);
        fill_quota(t, quota);
        // the city lives (handbook ch. 6): every visit to a full panel gives
        // its tallest settlement one climb or sprawl step, whatever the card
        if (cfg.alive && panels.at(t) >= geo.area()) city_lives(t);
        if (panels.at(t) >= geo.area()) {
            if (!atlas.count(t)) {
                atlas.insert(t);
                if (cfg.archive_permille &&
                    roll_chance(cfg.archive_permille, "archive")) {
                    binder.insert(t);
                    Event e; e.kind = Ev::PanelArchived; e.has_panel = true; e.panel = t;
                    emit(std::move(e));
                }
                completed_per_era[era] += 1;
            }
            if (!binder.count(t)) {
                stack.push_back(t);
                Event e; e.kind = Ev::PanelStays; e.has_panel = true; e.panel = t;
                emit(std::move(e));
            }
        } else {
            stack.push_back(t);
            Event e; e.kind = Ev::PanelReturns; e.has_panel = true; e.panel = t;
            e.a = panels.at(t); e.b = geo.area();
            emit(std::move(e));
        }
    }
    deck.push_back(c);
    // v0.5, the depth erratum: Add Panel carries no shuffle rider; the
    // cycle-marker shuffle applies for the whole game. The next card played
    // after a shuffle becomes the new marker.
    bool do_shuffle = false;
    if (marker_uid < 0) {
        marker_uid = c.uid;
    } else if (c.uid == marker_uid) {
        do_shuffle = true;
        note(Ev::CycleComplete);
        marker_uid = -1;
    }
    if (do_shuffle) {
        shuffle_deck_now();
        marker_uid = -1;
        // the shuffle belongs to the age, not to a place; it carries the age's
        // panel so every numbered step can be found on the map
        Event e; e.kind = Ev::DeckShuffled;
        if (have_cur_) { e.has_panel = true; e.panel = cur_panel_; }
        ev_action(std::move(e));
    }
    if (age_in_era == 25) {
        // era summary
        std::int64_t cnt[8] = {0, 0, 0, 0, 0, 0, 0, 0};
        for (auto& kv : base) cnt[kv.second] += 1;
        std::string row = format_era_row(
            era, age_in_era, static_cast<std::int64_t>(base.size()), cnt,
            static_cast<std::int64_t>(atlas.size()),
            static_cast<std::int64_t>(panels.size()),
            static_cast<std::int64_t>(binder.size()), M.cliffs, M.merges,
            cfg.archive_permille != 0);
        era_rows.push_back(row);
        Event e; e.kind = Ev::EraSummary; e.a = era; e.b = age_in_era;
        e.c = static_cast<std::int64_t>(base.size());
        e.counts.assign(cnt, cnt + 8);
        e.counts.push_back(static_cast<std::int64_t>(atlas.size()));
        e.counts.push_back(static_cast<std::int64_t>(panels.size()));
        e.counts.push_back(static_cast<std::int64_t>(binder.size()));
        e.counts.push_back(M.cliffs);
        e.counts.push_back(M.merges);
        e.flag = cfg.archive_permille != 0;
        emit(std::move(e));
        age_in_era = 0;
        if (era == 3) {
            cov_num = 0;
            for (Panel tk : genesis) cov_num += panels.at(tk);
            cov_den = static_cast<std::int64_t>(geo.area()) *
                      static_cast<std::int64_t>(genesis.size());
            cov_set = true;
        }
        era += 1;
        if (era > eras_wanted) {
            finish_run();
            return false;
        }
        if (era >= cfg.wake_era && !woken) {
            auto wa = work_table();
            for (int w : spread_work(wa.at("addpanel"), cfg.addpanel_copies,
                                     cfg.work_spread))
                deck.push_back({"addpanel", w, next_uid++});
            woken = true;
            note(Ev::AddpanelWake);
        }
        Event e2; e2.kind = Ev::EraStart; e2.a = era;
        emit(std::move(e2));
    }
    return true;
}

void Sim::finish_run() {
    deck_size_end_ = static_cast<int>(deck.size());
    composed_end_ = 0; // this lineage composes no cards
    finished_ = true;
}

// ---------------------------------------------------------------- report

std::string Sim::final_report() const {
    std::int64_t n = static_cast<std::int64_t>(base.size());
    std::int64_t cnt[8] = {0, 0, 0, 0, 0, 0, 0, 0};
    for (auto& kv : base) cnt[kv.second] += 1;
    F64 sh[8], hundred = sf_from_int(100), fn = sf_from_int(n);
    for (int i = 0; i < 8; ++i)
        sh[i] = n ? sf_mul(sf_div(sf_from_int(cnt[i]), fn), hundred) : F64{};
    F64 w = sf_add(sf_add(sf_add(sh[0], sh[1]), sh[2]), sh[3]);

    std::vector<std::string> lines;
    lines.push_back("");
    lines.push_back("===== FINAL METRICS =====");
    for (auto& r : era_rows) lines.push_back(r);
    lines.push_back("total units " + std::to_string(n) + " | panels " +
                    std::to_string(panels.size()) + " (atlas " +
                    std::to_string(atlas.size()) + ")");
    {
        std::string s = "elevation shares:";
        for (int i = 0; i < 8; ++i)
            s += std::string(" ") + RUNG_NAME[i] + " " + sf_fmt(sh[i], 1) + "%";
        lines.push_back(s);
    }
    lines.push_back("aggregates: water " + sf_fmt(w, 1) + "% (target 30-40) | plain " +
                    sf_fmt(sh[5], 1) + "% (30-35) | hills " + sf_fmt(sh[6], 1) +
                    "% (10-15) | mountains " + sf_fmt(sh[7], 1) + "% (5-8)");
    if (cov_set) {
        F64 cov = sf_mul(sf_div(sf_from_int(cov_num), sf_from_int(cov_den)), hundred);
        lines.push_back("genesis coverage at end of era 3: " + sf_fmt(cov, 0) +
                        "% (claim: most of 360 units)");
    }
    {
        std::string s;
        for (auto& kv : skips) {
            if (!s.empty()) s += ", ";
            s += kv.first + " " + std::to_string(kv.second);
        }
        lines.push_back("skips: " + (s.empty() ? "none" : s));
    }
    lines.push_back("cliffs " + std::to_string(M.cliffs) + " | nudges " +
                    std::to_string(M.nudges) + " | merges " +
                    std::to_string(M.merges) + " | free panels " +
                    std::to_string(M.free_panels));
    {
        std::map<std::string, int> ppl;
        people.for_each([&](GPos, const std::string& k) { ppl[k] += 1; });
        std::string s;
        for (auto& kv : ppl) {
            if (!s.empty()) s += ", ";
            s += kv.first + " " + std::to_string(kv.second);
        }
        lines.push_back("people: " + (s.empty() ? "none" : s));
    }
    lines.push_back("deck: " + std::to_string(deck_size_end_) + " cards, " +
                    std::to_string(composed_end_) + " composed");
    lines.push_back("embellishment: " + std::to_string(M.embellish) +
                    " steps across " + std::to_string(embellish.size()) + " units");
    {
        std::string s;
        for (auto& kv : firsts) {
            if (!s.empty()) s += ", ";
            s += kv.first + " era " + std::to_string(kv.second);
        }
        lines.push_back("city firsts: " + (s.empty() ? "no urban" : s) +
                        " | reworks " + std::to_string(M.reworks) + " | crumbles " +
                        std::to_string(M.crumbles));
    }
    std::string out;
    for (std::size_t i = 0; i < lines.size(); ++i) {
        if (i) out += "\n";
        out += lines[i];
    }
    return out;
}

} // namespace jerrymap
