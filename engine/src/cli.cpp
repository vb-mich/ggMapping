// The reference-compatible CLI (CONTRACTS §7): same flags, same defaults, same
// seed{N}_log.txt output — LF always — plus the engine extensions
// --save/--save-at/--load/--record/--replay.
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <random>
#include <sstream>
#include <stdexcept>
#include <string>

#include "jerrymap/sim.hpp"

namespace jerrymap {

namespace {

std::string read_file(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("cannot read " + path);
    std::ostringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

void write_file(const std::string& path, const std::string& data) {
    std::ofstream f(path, std::ios::binary); // binary: LF stays LF
    if (!f) throw std::runtime_error("cannot write " + path);
    f << data;
}

// Percent with at most one decimal (CONTRACTS §3) -> per-mille integer.
int parse_percent_permille(const std::string& s) {
    std::size_t dot = s.find('.');
    std::string whole = dot == std::string::npos ? s : s.substr(0, dot);
    std::string frac = dot == std::string::npos ? "" : s.substr(dot + 1);
    while (frac.size() > 1 && frac.back() == '0') frac.pop_back();
    if (frac.size() > 1)
        throw std::runtime_error("percents allow one decimal: " + s);
    int m = std::atoi(whole.c_str()) * 10;
    if (frac.size() == 1) m += frac[0] - '0';
    return m;
}

std::map<std::string, std::string> parse_kv(const std::string& s) {
    std::map<std::string, std::string> out;
    std::size_t p = 0;
    while (p < s.size()) {
        std::size_t e = s.find(',', p);
        if (e == std::string::npos) e = s.size();
        std::string item = s.substr(p, e - p);
        p = e + 1;
        std::size_t eq = item.find('=');
        if (eq == std::string::npos)
            throw std::runtime_error("expected k=v in: " + item);
        out[item.substr(0, eq)] = item.substr(eq + 1);
    }
    return out;
}

} // namespace

int run_cli(int argc, char** argv) {
    CliOptions o;
    // accepted-and-inert flags, exactly the reference's surface
    for (int i = 1; i < argc; ++i) {
        std::string a = argv[i];
        auto val = [&]() -> std::string {
            if (i + 1 >= argc) throw std::runtime_error("missing value for " + a);
            return argv[++i];
        };
        if (a == "--eras") o.eras = std::atoi(val().c_str());
        else if (a == "--seed") o.seed = std::atoll(val().c_str());
        else if (a == "--out") o.out = val();
        else if (a == "--tile") o.tile = val();
        else if (a == "--addpanel") o.addpanel = std::atoi(val().c_str());
        else if (a == "--archive-chance") o.archive_chance = val();
        else if (a == "--stroke-die") o.stroke_die = std::atoi(val().c_str());
        else if (a == "--stroke-add") o.stroke_add = std::atoi(val().c_str());
        else if (a == "--greatridge-die") o.greatridge_die = std::atoi(val().c_str());
        else if (a == "--greatridge-add") o.greatridge_add = std::atoi(val().c_str());
        else if (a == "--extend-cap") o.extend_cap = std::atoi(val().c_str());
        else if (a == "--flat-work") o.flat_work = true;
        else if (a == "--work") o.work = val();
        else if (a == "--mood") o.mood = val();
        else if (a == "--snapshots" || a == "--alive" || a == "--semi" ||
                 a == "--no-patina" || a == "--living-deck" || a == "--fragile") {
            // inert in this lineage (or PNG-only in the reference)
        } else if (a == "--ld-start" || a == "--ld-add" || a == "--ld-retire" ||
                   a == "--ld-shuffle" || a == "--ld-floor" || a == "--ld-ceiling") {
            val(); // inert, value-bearing
        } else if (a == "--save") o.save_path = val();
        else if (a == "--save-at") o.save_at = std::atoll(val().c_str());
        else if (a == "--load") o.load_path = val();
        else if (a == "--record") o.record_path = val();
        else if (a == "--replay") o.replay_path = val();
        else throw std::runtime_error("unknown flag: " + a);
    }

    std::filesystem::create_directories(o.out);

    // deciders
    std::unique_ptr<AutoDecider> auto_dec;
    std::unique_ptr<ScriptedDecider> scripted;
    std::unique_ptr<RecordingDecider> recorder;
    Decider* dec = nullptr;

    std::unique_ptr<Sim> sim;
    if (!o.load_path.empty()) {
        Json st = json_parse(read_file(o.load_path));
        std::uint64_t rs = std::strtoull(
            st.at("rng").at("state").as_str().c_str(), nullptr, 10);
        if (!o.replay_path.empty()) {
            scripted = std::make_unique<ScriptedDecider>(
                decisions_parse(read_file(o.replay_path)));
            dec = scripted.get();
        } else {
            auto_dec = std::make_unique<AutoDecider>(AutoDecider::from_state(rs));
            dec = auto_dec.get();
        }
        if (!o.record_path.empty()) {
            recorder = std::make_unique<RecordingDecider>(*dec);
            dec = recorder.get();
        }
        sim = std::make_unique<Sim>(st, *dec);
    } else {
        std::int64_t seed = o.seed;
        if (seed < 0) {
            std::random_device rd;
            std::uniform_int_distribution<std::int64_t> dist(1, 10000000);
            seed = dist(rd);
        }
        Config cfg;
        int tw = 5, th = 6;
        {
            std::size_t x = o.tile.find('x');
            if (x == std::string::npos) x = o.tile.find('X');
            if (x == std::string::npos)
                throw std::runtime_error("bad --tile: " + o.tile);
            tw = std::atoi(o.tile.substr(0, x).c_str());
            th = std::atoi(o.tile.substr(x + 1).c_str());
        }
        cfg.panel_w = tw;
        cfg.panel_h = th;
        cfg.alive = true;  // this lineage hard-enables the semi-living game
        cfg.semi = true;
        cfg.fragile = true;
        cfg.addpanel_copies = o.addpanel;
        cfg.archive_permille = parse_percent_permille(o.archive_chance);
        cfg.stroke_die = o.stroke_die;
        cfg.stroke_add = o.stroke_add;
        cfg.greatridge_die = o.greatridge_die;
        cfg.greatridge_add = o.greatridge_add;
        cfg.extend_cap = o.extend_cap;
        cfg.work_spread = !o.flat_work;
        if (!o.work.empty())
            for (auto& kv : parse_kv(o.work))
                cfg.work_overrides[kv.first] = std::atoi(kv.second.c_str());
        if (!o.mood.empty())
            for (auto& kv : parse_kv(o.mood))
                cfg.mood_overrides[kv.first] = kv.second;

        if (!o.replay_path.empty()) {
            scripted = std::make_unique<ScriptedDecider>(
                decisions_parse(read_file(o.replay_path)));
            dec = scripted.get();
        } else {
            auto_dec = std::make_unique<AutoDecider>(
                static_cast<std::uint64_t>(seed));
            dec = auto_dec.get();
        }
        if (!o.record_path.empty()) {
            recorder = std::make_unique<RecordingDecider>(*dec);
            dec = recorder.get();
        }
        sim = std::make_unique<Sim>(cfg, seed, o.eras, *dec);
    }

    // run (optionally stopping at an age boundary to save)
    if (o.save_at >= 0) {
        for (std::int64_t k = 0; k < o.save_at && sim->step(); ++k) {}
        if (o.save_path.empty())
            throw std::runtime_error("--save-at needs --save FILE");
        write_file(o.save_path, json_emit(sim->save_state(), 2) + "\n");
        std::string logtxt;
        for (auto& l : sim->loglines()) { logtxt += l; logtxt += "\n"; }
        std::string logpath = o.out + "/seed" + std::to_string(sim->seed) + "_log.txt";
        write_file(logpath, logtxt);
        if (recorder && !o.record_path.empty())
            write_file(o.record_path, decisions_emit(recorder->tape()));
        std::cout << "saved at age " << sim->ages_total << " -> " << o.save_path
                  << "\n";
        return 0;
    }

    sim->run();
    std::string report = sim->final_report();
    std::string logtxt;
    for (auto& l : sim->loglines()) { logtxt += l; logtxt += "\n"; }
    logtxt += report;
    logtxt += "\n";
    std::string logpath = o.out + "/seed" + std::to_string(sim->seed) + "_log.txt";
    write_file(logpath, logtxt);
    if (recorder && !o.record_path.empty())
        write_file(o.record_path, decisions_emit(recorder->tape()));
    if (!o.save_path.empty())
        write_file(o.save_path, json_emit(sim->save_state(), 2) + "\n");
    std::cout << "seed " << sim->seed << "\n" << report << "\n";
    return 0;
}

} // namespace jerrymap
