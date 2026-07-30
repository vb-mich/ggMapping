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
    if (failures) {
        std::cerr << failures << " failure(s)\n";
        return 1;
    }
    std::cout << "all engine tests: OK\n";
    return 0;
}
