// Engine unit tests. The RNG vectors are asserted before anything else builds
// on the RNG (CONTRACTS §3); the softfloat goldens pin the renderer to
// CPython's double formatting (§5.2).
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#include "jerrymap/decider.hpp"
#include "jerrymap/geometry.hpp"
#include "jerrymap/json.hpp"
#include "jerrymap/rng.hpp"
#include "jerrymap/sim.hpp"
#include "jerrymap/softfloat.hpp"

using namespace jerrymap;

static int failures = 0;

#define CHECK(cond)                                                     \
    do {                                                                \
        if (!(cond)) {                                                  \
            ++failures;                                                 \
            std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << ": " \
                      << #cond << "\n";                                 \
        }                                                               \
    } while (0)

#define CHECK_EQ(a, b)                                                     \
    do {                                                                   \
        auto va = (a);                                                     \
        auto vb = (b);                                                     \
        if (!(va == vb)) {                                                 \
            ++failures;                                                    \
            std::cerr << "FAIL " << __FILE__ << ":" << __LINE__ << ": "    \
                      << #a << " == " << #b << "  [" << va << " vs " << vb \
                      << "]\n";                                            \
        }                                                                  \
    } while (0)

static void test_rng_vectors() {
    // Official vectors, CONTRACTS §3 — these run first.
    {
        Pcg32 r(42);
        const std::uint32_t want[8] = {2707161783u, 2068313097u, 3122475824u,
                                       2211639955u, 3215226955u, 3421331566u,
                                       3217466285u, 2167406445u};
        for (int i = 0; i < 8; ++i) CHECK_EQ(r.next(), want[i]);
    }
    {
        Pcg32 r(42);
        const int want[8] = {4, 4, 3, 2, 2, 5, 6, 4};
        for (int i = 0; i < 8; ++i) CHECK_EQ(r.die(6), want[i]);
    }
    {
        Pcg32 r(8065818);
        const std::uint32_t want[4] = {2259990538u, 1539960839u, 2586682155u,
                                       529441677u};
        for (int i = 0; i < 4; ++i) CHECK_EQ(r.next(), want[i]);
    }
}

static void test_softfloat_goldens(const std::string& path) {
    // Lines: "<c> <n> <fmt0-of-c/n*100> <fmt1-of-c/n*100>" from CPython.
    std::ifstream f(path);
    if (!f) {
        ++failures;
        std::cerr << "FAIL cannot open golden file " << path << "\n";
        return;
    }
    std::string line;
    long long cases = 0;
    F64 hundred = sf_from_int(100);
    while (std::getline(f, line)) {
        if (line.empty()) continue;
        std::istringstream ss(line);
        long long c, n;
        std::string want0, want1;
        ss >> c >> n >> want0 >> want1;
        F64 v = sf_mul(sf_div(sf_from_int(c), sf_from_int(n)), hundred);
        if (sf_fmt(v, 0) != want0 || sf_fmt(v, 1) != want1) {
            ++failures;
            std::cerr << "FAIL softfloat " << c << "/" << n << "*100: got "
                      << sf_fmt(v, 0) << "/" << sf_fmt(v, 1) << " want " << want0
                      << "/" << want1 << "\n";
        }
        ++cases;
    }
    CHECK(cases > 1000);
    // Left-to-right sums, as the era row's water percent does.
    // 1/8*100 = 12.5 exactly: CPython f"{12.5:.0f}" == "12" (half-even).
    F64 x = sf_mul(sf_div(sf_from_int(1), sf_from_int(8)), hundred);
    CHECK_EQ(sf_fmt(x, 0), std::string("12"));
    F64 y = sf_mul(sf_div(sf_from_int(3), sf_from_int(8)), hundred); // 37.5
    CHECK_EQ(sf_fmt(y, 0), std::string("38"));
    CHECK_EQ(sf_fmt(F64{}, 1), std::string("0.0"));
    CHECK_EQ(sf_fmt(F64{}, 0), std::string("0"));
}

static void test_geometry() {
    Geo g;
    CHECK_EQ(Geo::name({-1, 2}), std::string("N2/W1"));
    CHECK_EQ(Geo::name({1, -1}), std::string("S1/E1"));
    for (int tx : {-3, -2, -1, 1, 2, 3})
        for (int ty : {-3, -2, -1, 1, 2, 3}) {
            Panel t{tx, ty};
            for (GPos u : g.units(t)) CHECK(g.panel_of(u) == t);
            int r, c;
            g.rc_of(g.unit_at(t, 3, 2), r, c);
            CHECK_EQ(r, 3);
            CHECK_EQ(c, 2);
        }
    // side_panel skips the zero row/column
    CHECK(Geo::side_panel({1, 1}, -1, 0) == (Panel{-1, 1}));
    CHECK(Geo::side_panel({-1, 1}, 1, 0) == (Panel{1, 1}));
    CHECK(Geo::side_panel({1, 1}, 0, -1) == (Panel{1, -1}));
}

static void test_json() {
    std::string src =
        "{\"a\": [1, -2, \"x\\n\"], \"b\": {\"c\": true, \"d\": null}}";
    Json j = json_parse(src);
    CHECK_EQ(j.at("a").as_arr()[1].as_int(), -2);
    CHECK_EQ(j.at("a").as_arr()[2].as_str(), std::string("x\n"));
    CHECK(j.at("b").at("c").as_bool());
    Json round = json_parse(json_emit(j));
    CHECK_EQ(json_emit(round), json_emit(j));
}

static void test_ordered_people() {
    OrderedPeople p;
    p.set({1, 1}, "rural");
    p.set({2, 2}, "urb_lo");
    p.set({3, 3}, "rural");
    p.erase({2, 2});
    p.set({2, 2}, "farm_lo"); // re-insertion goes to the end
    std::vector<int> xs;
    p.for_each([&](GPos u, const std::string&) { xs.push_back(u.x); });
    CHECK_EQ(xs.size(), static_cast<std::size_t>(3));
    CHECK_EQ(xs[0], 1);
    CHECK_EQ(xs[1], 3);
    CHECK_EQ(xs[2], 2);
    p.set({1, 1}, "urb_md"); // update keeps position
    xs.clear();
    p.for_each([&](GPos u, const std::string&) { xs.push_back(u.x); });
    CHECK_EQ(xs[0], 1);
}

static void test_decisions_roundtrip() {
    std::vector<DecisionRecord> tape = {
        {DecisionRecord::Kind::Die, "row", 6, 4, {}},
        {DecisionRecord::Kind::Pick, "fill spot", 3, 1, {}},
        {DecisionRecord::Kind::Chance, "archive", 250, 1, {}},
        {DecisionRecord::Kind::Shuffle, "deck", 3, 0, {2, 0, 1}},
    };
    auto back = decisions_parse(decisions_emit(tape));
    CHECK_EQ(back.size(), tape.size());
    ScriptedDecider sd(back);
    CHECK_EQ(sd.die(6, "row"), 4);
    CHECK_EQ(sd.pick(3, "fill spot"), 1);
    CHECK(sd.chance(250, "archive"));
    auto perm = sd.shuffle(3, "deck");
    CHECK_EQ(perm[0], 2u);
}

// ---- the experimental fields dial (handbook ch. 11, FORK_NOTES §v0.6) ----
// The dial's rules are reached through the test seam so each case can be
// constructed exactly, rather than fished out of a whole run.
namespace jerrymap {
struct SimTestAccess {
    static bool constrains(const Sim& s, GPos u) { return s.constrains(u); }
    static bool dens_legal(const Sim& s, GPos u, int d) { return s.dens_legal(u, d); }
    static bool crowd(const Sim& s, GPos u, int need) {
        return s.neighbors_of_height(u, need);
    }
    static bool place(Sim& s, const std::vector<GPos>& c, const std::string& k,
                      const std::vector<int>& b) {
        return s.place_people(c, k, b);
    }
    static void grow(Sim& s, const std::vector<GPos>& comp) { s.grow_once(comp); }
    static void set_decider(Sim& s, Decider& d) { s.dec_ = &d; }
};
} // namespace jerrymap

// A world with one panel's worth of plain ground and nothing else on it.
static void plain_ground(Sim& s, GPos from, int w, int h) {
    for (int dx = 0; dx < w; ++dx)
        for (int dy = 0; dy < h; ++dy) s.base[{from.x + dx, from.y + dy}] = PL;
}

static void test_exp_fields_blocking_and_support() {
    for (bool on : {false, true}) {
        AutoDecider dec(1);
        Config cfg;
        cfg.exp_fields = on;
        Sim s(cfg, 1, 1, dec);
        const GPos origin{-5, -12};
        plain_ground(s, origin, 5, 6);
        const GPos field{origin.x, origin.y};
        s.people.set(field, "farm_lo");

        // (1) a field must not BLOCK a step: with the dial on it stops
        // constraining, so an urban-medium home may sit beside it. The spot's
        // other side neighbours are hills, which never constrain, so the
        // field is the only thing that can refuse the step.
        CHECK_EQ(SimTestAccess::constrains(s, field), !on);
        const GPos beside{origin.x + 1, origin.y};
        for (int i = 0; i < 4; ++i) {
            GPos n{beside.x + SIDE_DX[i], beside.y + SIDE_DY[i]};
            if (!(n == field)) s.base[n] = HI;
        }
        CHECK_EQ(SimTestAccess::dens_legal(s, beside, 3), on);

        // (2) a field must not SUPPORT a step: it stays out of the crowd count.
        // Three neighbours of `hub`, all fields: canon counts 3, the dial 0.
        const GPos hub{origin.x + 2, origin.y + 2};
        s.people.set({hub.x - 1, hub.y}, "farm_lo");
        s.people.set({hub.x + 1, hub.y}, "farm_hi");
        s.people.set({hub.x, hub.y - 1}, "farm_lo");
        CHECK_EQ(SimTestAccess::crowd(s, hub, 3), !on);
        // and a real home beside them still counts, dial or not
        s.people.set({hub.x, hub.y + 1}, "urb_lo");
        CHECK(SimTestAccess::crowd(s, hub, 1));
    }
}

static void test_exp_fields_placement_beside_urban() {
    // A field may be sown beside an urban unit: it is never itself subject to
    // the step rule. Canon refuses (density 0 beside density 2).
    for (bool on : {false, true}) {
        AutoDecider dec(2);
        Config cfg;
        cfg.exp_fields = on;
        Sim s(cfg, 1, 1, dec);
        const GPos origin{-5, -12};
        plain_ground(s, origin, 5, 6);
        const GPos city{origin.x, origin.y};
        s.people.set(city, "urb_lo");           // density 2
        const GPos spot{origin.x + 1, origin.y}; // its side neighbour
        CHECK_EQ(SimTestAccess::place(s, {spot}, "farm_lo", {PL}), on);
        CHECK_EQ(s.people.contains(spot), on);
    }
}

static void test_exp_fields_deepen_before_clearing() {
    // The farm step deepens an existing low field before clearing new ground,
    // and only clears once every field is high. The grow roll is scripted so
    // the farm branch (1..2) is the one under test.
    AutoDecider seedy(3); // builds and shuffles the deck at construction
    Config cfg;
    cfg.exp_fields = true;
    Sim s(cfg, 1, 1, seedy);
    const GPos origin{-5, -12};
    plain_ground(s, origin, 5, 6);
    // An interior unit, so all eight neighbours are this panel's. Exactly one
    // stays plain: the later clearing then has a single candidate, and a
    // single-candidate pick consumes no randomness (CONTRACTS §4).
    const GPos low{origin.x + 2, origin.y + 2};
    const GPos only_spot{low.x + 1, low.y};
    for (int dx = -1; dx <= 1; ++dx)
        for (int dy = -1; dy <= 1; ++dy) {
            GPos n{low.x + dx, low.y + dy};
            if (!(n == low) && !(n == only_spot)) s.base[n] = HI;
        }
    s.people.set(low, "farm_lo");

    std::vector<DecisionRecord> tape = {
        {DecisionRecord::Kind::Die, "grow", 6, 1, {}}, // first: must deepen
        {DecisionRecord::Kind::Die, "grow", 6, 1, {}}, // second: must clear
    };
    ScriptedDecider dec(tape);
    SimTestAccess::set_decider(s, dec);
    const std::size_t before = s.loglines().size();

    SimTestAccess::grow(s, {low});
    const std::string* k = s.people.get(low);
    CHECK(k && *k == "farm_hi");                 // deepened, not cleared
    CHECK_EQ(s.people.size(), std::size_t{1});   // no new ground taken
    bool logged = false;
    for (std::size_t i = before; i < s.loglines().size(); ++i)
        if (s.loglines()[i] == "    the field deepens") logged = true;
    CHECK(logged);

    // every field now high: the next farm step clears new ground instead
    SimTestAccess::grow(s, {low});
    CHECK_EQ(s.people.size(), std::size_t{2});
    CHECK(s.people.contains(only_spot));
}

int main(int argc, char** argv) {
    std::string golden = argc > 1 ? argv[1] : "engine/tests/golden/softfloat_cases.txt";
    test_rng_vectors();
    if (failures) { // the vectors gate everything else
        std::cerr << "RNG VECTORS FAILED — aborting\n";
        return 1;
    }
    std::cout << "rng vectors: OK\n";
    test_softfloat_goldens(golden);
    test_geometry();
    test_json();
    test_ordered_people();
    test_decisions_roundtrip();
    test_exp_fields_blocking_and_support();
    test_exp_fields_placement_beside_urban();
    test_exp_fields_deepen_before_clearing();
    if (failures) {
        std::cerr << failures << " failure(s)\n";
        return 1;
    }
    std::cout << "all engine tests: OK\n";
    return 0;
}
