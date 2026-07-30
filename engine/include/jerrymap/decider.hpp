// The Decider, CONTRACTS.md §4. Every die, pick, and chance flows through here;
// the engine never touches the RNG directly. AutoDecider implements the PCG32
// contract; ScriptedDecider replays recorded decisions (the re-roll machinery).
#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

#include "rng.hpp"

namespace jerrymap {

struct DecisionRecord {
    enum class Kind { Die, Pick, Chance, Shuffle } kind;
    std::string purpose;
    std::int64_t domain = 0;              // n / count / permille / len
    std::int64_t result = 0;              // die value, pick index, chance 0|1
    std::vector<std::uint32_t> perm;      // shuffle only
};

class Decider {
public:
    virtual ~Decider() = default;
    virtual int die(int n, const std::string& purpose) = 0;                  // 1..n
    virtual int pick(int count, const std::string& purpose) = 0;             // 0..count-1, count >= 2
    virtual bool chance(int permille, const std::string& purpose) = 0;
    virtual std::vector<std::uint32_t> shuffle(std::size_t len,
                                               const std::string& purpose) = 0;
    // Saves serialize the AutoDecider's PCG32 state (CONTRACTS §6). Deciders
    // without one (scripted) report false; such runs save "0".
    virtual bool rng_state(std::uint64_t& out) const { (void)out; return false; }
};

class AutoDecider : public Decider {
public:
    explicit AutoDecider(std::uint64_t seed) : rng_(Pcg32(seed)) {}
    static AutoDecider from_state(std::uint64_t s) { return AutoDecider(Pcg32::from_state(s)); }
    bool rng_state(std::uint64_t& out) const override { out = rng_.state(); return true; }

    int die(int n, const std::string&) override { return rng_.die(n); }
    int pick(int count, const std::string&) override {
        return static_cast<int>(rng_.bounded(static_cast<std::uint32_t>(count)));
    }
    bool chance(int permille, const std::string&) override {
        return rng_.chance_permille(permille);
    }
    std::vector<std::uint32_t> shuffle(std::size_t len, const std::string&) override {
        std::vector<std::uint32_t> p(len);
        rng_.shuffle_perm(len, p.data());
        return p;
    }

private:
    explicit AutoDecider(Pcg32 rng) : rng_(rng) {}
    Pcg32 rng_;
};

// Wraps another decider and records every decision (the helper tool's tape).
class RecordingDecider : public Decider {
public:
    explicit RecordingDecider(Decider& inner) : inner_(inner) {}
    const std::vector<DecisionRecord>& tape() const { return tape_; }
    bool rng_state(std::uint64_t& out) const override { return inner_.rng_state(out); }

    int die(int n, const std::string& purpose) override {
        int v = inner_.die(n, purpose);
        tape_.push_back({DecisionRecord::Kind::Die, purpose, n, v, {}});
        return v;
    }
    int pick(int count, const std::string& purpose) override {
        int v = inner_.pick(count, purpose);
        tape_.push_back({DecisionRecord::Kind::Pick, purpose, count, v, {}});
        return v;
    }
    bool chance(int permille, const std::string& purpose) override {
        bool v = inner_.chance(permille, purpose);
        tape_.push_back({DecisionRecord::Kind::Chance, purpose, permille, v ? 1 : 0, {}});
        return v;
    }
    std::vector<std::uint32_t> shuffle(std::size_t len, const std::string& purpose) override {
        auto p = inner_.shuffle(len, purpose);
        tape_.push_back({DecisionRecord::Kind::Shuffle, purpose,
                         static_cast<std::int64_t>(len), 0, p});
        return p;
    }

private:
    Decider& inner_;
    std::vector<DecisionRecord> tape_;
};

// Replays a tape. Kind and domain must match the engine's request exactly;
// divergence is a hard error (CONTRACTS §4).
class ScriptedDecider : public Decider {
public:
    explicit ScriptedDecider(std::vector<DecisionRecord> tape) : tape_(std::move(tape)) {}
    std::size_t consumed() const { return pos_; }

    int die(int n, const std::string& purpose) override {
        const DecisionRecord& r = take(DecisionRecord::Kind::Die, n, purpose);
        return static_cast<int>(r.result);
    }
    int pick(int count, const std::string& purpose) override {
        const DecisionRecord& r = take(DecisionRecord::Kind::Pick, count, purpose);
        return static_cast<int>(r.result);
    }
    bool chance(int permille, const std::string& purpose) override {
        const DecisionRecord& r = take(DecisionRecord::Kind::Chance, permille, purpose);
        return r.result != 0;
    }
    std::vector<std::uint32_t> shuffle(std::size_t len, const std::string& purpose) override {
        const DecisionRecord& r = take(DecisionRecord::Kind::Shuffle,
                                       static_cast<std::int64_t>(len), purpose);
        return r.perm;
    }

private:
    const DecisionRecord& take(DecisionRecord::Kind k, std::int64_t domain,
                               const std::string& purpose) {
        if (pos_ >= tape_.size())
            throw std::runtime_error("scripted decider: tape exhausted at '" + purpose + "'");
        const DecisionRecord& r = tape_[pos_++];
        if (r.kind != k || r.domain != domain)
            throw std::runtime_error("scripted decider: divergence at record " +
                                     std::to_string(pos_ - 1) + " ('" + purpose + "')");
        return r;
    }
    std::vector<DecisionRecord> tape_;
    std::size_t pos_ = 0;
};

// JSONL round-trip for tapes (one record per line).
std::string decisions_emit(const std::vector<DecisionRecord>& tape);
std::vector<DecisionRecord> decisions_parse(const std::string& text);

} // namespace jerrymap
