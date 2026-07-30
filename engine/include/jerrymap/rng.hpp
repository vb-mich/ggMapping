// The portable RNG: PCG32, stream 54. CONTRACTS.md §3 / FORK_NOTES "The portable
// RNG, v0.4". Bit-exact across every port; official test vectors asserted in tests.
#pragma once
#include <cstdint>
#include <cstddef>

namespace jerrymap {

class Pcg32 {
public:
    static constexpr std::uint64_t MUL = 6364136223846793005ULL;
    static constexpr std::uint64_t INC = (54ULL << 1) | 1ULL;

    explicit Pcg32(std::uint64_t seed) : state_(0) {
        next();
        state_ += seed;
        next();
    }
    // Restore from a serialized state (CONTRACTS §6.3).
    static Pcg32 from_state(std::uint64_t s) { Pcg32 r; r.state_ = s; return r; }
    std::uint64_t state() const { return state_; }

    std::uint32_t next() {
        std::uint64_t old = state_;
        state_ = old * MUL + INC;
        std::uint32_t xs = static_cast<std::uint32_t>(((old >> 18) ^ old) >> 27);
        std::uint32_t rot = static_cast<std::uint32_t>(old >> 59);
        return (xs >> rot) | (xs << ((32u - rot) & 31u));
    }

    // Uniform 0..n-1, rejection-bounded.
    std::uint32_t bounded(std::uint32_t n) {
        std::uint32_t t = static_cast<std::uint32_t>((1ULL << 32) % n);
        for (;;) {
            std::uint32_t r = next();
            if (r >= t) return r % n;
        }
    }

    int die(int n) { return 1 + static_cast<int>(bounded(static_cast<std::uint32_t>(n))); }

    // Per-mille chance: hit iff next < (m << 32) / 1000, integer division.
    bool chance_permille(int m) {
        return static_cast<std::uint64_t>(next()) <
               ((static_cast<std::uint64_t>(m) << 32) / 1000ULL);
    }

    // Fisher-Yates from the top over an index permutation of length n.
    // perm must hold n slots; filled with 0..n-1 then shuffled in place.
    void shuffle_perm(std::size_t n, std::uint32_t* perm) {
        for (std::size_t i = 0; i < n; ++i) perm[i] = static_cast<std::uint32_t>(i);
        for (std::size_t i = n; i-- > 1;) {
            std::uint32_t j = bounded(static_cast<std::uint32_t>(i + 1));
            std::uint32_t tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
        }
    }

private:
    Pcg32() : state_(0) {}
    std::uint64_t state_;
};

} // namespace jerrymap
