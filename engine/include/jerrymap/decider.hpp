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

    // The candidate witness (CONTRACTS §4): right before a multi-candidate
    // pick, the engine describes the sorted candidate list as JSON — the
    // domain a player choosing on a map needs to see. A side channel only:
    // no randomness, no events, no effect on any other decider; the engine
    // builds the JSON only when wants_offer() says someone is listening.
    virtual bool wants_offer() const { return false; }
    virtual void offer(const std::string& candidates_json) { (void)candidates_json; }
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

// The frontier sentinel (CONTRACTS §4): the next open decision of an age
// whose script has run out — kind, purpose, domain, and (for picks) the
// witnessed candidates. Thrown by FrontierDecider, caught at the FFI edge.
struct PendingDecision {
    DecisionRecord::Kind kind;
    std::string purpose;
    std::int64_t domain = 0;
    std::string candidates_json; // "" for die/chance/shuffle: the domain suffices
};
struct FrontierReached {
    PendingDecision pending;
};

// The Helper's replay-to-frontier decider (HELPER_DESIGN): ScriptedDecider's
// law — kind and domain must match, divergence is a hard error — but
// exhaustion is not an error: it is the age's next open question, thrown as
// a sentinel carrying what the player must be asked.
class FrontierDecider : public Decider {
public:
    explicit FrontierDecider(std::vector<DecisionRecord> tape) : tape_(std::move(tape)) {}
    std::size_t consumed() const { return pos_; }

    bool wants_offer() const override { return true; }
    void offer(const std::string& j) override { cands_ = j; }

    int die(int n, const std::string& purpose) override {
        return static_cast<int>(take(DecisionRecord::Kind::Die, n, purpose).result);
    }
    int pick(int count, const std::string& purpose) override {
        return static_cast<int>(take(DecisionRecord::Kind::Pick, count, purpose).result);
    }
    bool chance(int permille, const std::string& purpose) override {
        return take(DecisionRecord::Kind::Chance, permille, purpose).result != 0;
    }
    std::vector<std::uint32_t> shuffle(std::size_t len, const std::string& purpose) override {
        return take(DecisionRecord::Kind::Shuffle,
                    static_cast<std::int64_t>(len), purpose).perm;
    }

private:
    const DecisionRecord& take(DecisionRecord::Kind k, std::int64_t domain,
                               const std::string& purpose) {
        if (pos_ >= tape_.size()) {
            // Only a pick carries a witnessed candidate list; the offer that
            // immediately precedes this call is the one we surface.
            throw FrontierReached{
                {k, purpose, domain,
                 k == DecisionRecord::Kind::Pick ? cands_ : std::string()}};
        }
        const DecisionRecord& r = tape_[pos_++];
        if (r.kind != k || r.domain != domain)
            throw std::runtime_error("helper script: divergence at record " +
                                     std::to_string(pos_ - 1) + " ('" + purpose + "')");
        return r;
    }
    std::vector<DecisionRecord> tape_;
    std::size_t pos_ = 0;
    std::string cands_;
};

// Proposal mode (HELPER_DESIGN): replay the script; past its end the
// simulator's own policy answers — an AutoDecider carried by state — and
// every policy answer is recorded beside the candidates it chose from, so
// the proposal can be shown, step by step, with its honesty marks.
// rng_state stays unreported on purpose: a helper world's state document
// carries rng "0" whichever mode wrote it — the modes may never diverge in
// what they write. The policy's state travels beside the response instead.
class PolicyFallbackDecider : public Decider {
public:
    PolicyFallbackDecider(std::vector<DecisionRecord> tape, std::uint64_t policy_state)
        : tape_(std::move(tape)), auto_(AutoDecider::from_state(policy_state)) {}
    std::size_t consumed() const { return pos_; }
    const std::vector<DecisionRecord>& fresh() const { return fresh_; }
    const std::vector<std::string>& fresh_cands() const { return fresh_cands_; }
    std::uint64_t policy_state() const {
        std::uint64_t s = 0;
        auto_.rng_state(s);
        return s;
    }

    bool wants_offer() const override { return true; }
    void offer(const std::string& j) override { cands_ = j; }

    int die(int n, const std::string& purpose) override {
        const DecisionRecord* r = replay(DecisionRecord::Kind::Die, n, purpose);
        if (r) return static_cast<int>(r->result);
        int v = auto_.die(n, purpose);
        note({DecisionRecord::Kind::Die, purpose, n, v, {}}, "");
        return v;
    }
    int pick(int count, const std::string& purpose) override {
        const DecisionRecord* r = replay(DecisionRecord::Kind::Pick, count, purpose);
        if (r) return static_cast<int>(r->result);
        int v = auto_.pick(count, purpose);
        note({DecisionRecord::Kind::Pick, purpose, count, v, {}}, cands_);
        return v;
    }
    bool chance(int permille, const std::string& purpose) override {
        const DecisionRecord* r = replay(DecisionRecord::Kind::Chance, permille, purpose);
        if (r) return r->result != 0;
        bool v = auto_.chance(permille, purpose);
        note({DecisionRecord::Kind::Chance, purpose, permille, v ? 1 : 0, {}}, "");
        return v;
    }
    std::vector<std::uint32_t> shuffle(std::size_t len, const std::string& purpose) override {
        const DecisionRecord* r =
            replay(DecisionRecord::Kind::Shuffle, static_cast<std::int64_t>(len), purpose);
        if (r) return r->perm;
        std::vector<std::uint32_t> p = auto_.shuffle(len, purpose);
        note({DecisionRecord::Kind::Shuffle, purpose,
              static_cast<std::int64_t>(len), 0, p}, "");
        return p;
    }

private:
    const DecisionRecord* replay(DecisionRecord::Kind k, std::int64_t domain,
                                 const std::string& purpose) {
        if (pos_ >= tape_.size()) return nullptr;
        const DecisionRecord& r = tape_[pos_++];
        if (r.kind != k || r.domain != domain)
            throw std::runtime_error("helper script: divergence at record " +
                                     std::to_string(pos_ - 1) + " ('" + purpose + "')");
        return &r;
    }
    void note(DecisionRecord r, const std::string& cands) {
        fresh_.push_back(std::move(r));
        fresh_cands_.push_back(cands);
    }
    std::vector<DecisionRecord> tape_;
    std::size_t pos_ = 0;
    AutoDecider auto_;
    std::vector<DecisionRecord> fresh_;
    std::vector<std::string> fresh_cands_;
    std::string cands_;
};

// JSONL round-trip for tapes (one record per line).
std::string decisions_emit(const std::vector<DecisionRecord>& tape);
std::vector<DecisionRecord> decisions_parse(const std::string& text);

} // namespace jerrymap
