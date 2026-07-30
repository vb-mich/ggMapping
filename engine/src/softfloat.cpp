#include "jerrymap/softfloat.hpp"

#include <cassert>

namespace jerrymap {

using u128 = unsigned __int128;

namespace {

int top_bit(u128 v) { // index of highest set bit
    int b = -1;
    while (v) { v >>= 1; ++b; }
    return b;
}

// Round a value known exactly as (q + sticky_tail) * 2^k, q a u128 with more
// than 53 significant bits, to a 53-bit mantissa, round-to-nearest-even.
F64 round_to_53(u128 q, bool sticky, int e_of_q) {
    int tb = top_bit(q);
    int shift = tb - 52;             // > 0 by construction
    u128 keep = q >> shift;
    u128 rest = q & ((static_cast<u128>(1) << shift) - 1);
    u128 half = static_cast<u128>(1) << (shift - 1);
    if (rest > half || (rest == half && (sticky || (keep & 1))))
        keep += 1;
    if (keep == (static_cast<u128>(1) << 53)) { keep >>= 1; ++shift; }
    F64 r;
    r.zero = false;
    r.m = static_cast<std::uint64_t>(keep);
    r.e = e_of_q + shift;
    return r;
}

} // namespace

F64 sf_from_int(std::int64_t v) {
    assert(v >= 0);
    F64 r;
    if (v == 0) return r;
    r.zero = false;
    std::uint64_t m = static_cast<std::uint64_t>(v);
    int e = 0;
    while (m >= (1ULL << 53)) { // v <= 2^63; our values are far smaller
        m >>= 1;
        ++e;
    }
    while (m < (1ULL << 52)) { m <<= 1; --e; }
    r.m = m;
    r.e = e;
    return r;
}

F64 sf_div(F64 a, F64 b) {
    assert(!b.zero);
    if (a.zero) return F64{};
    // (m_a << 62) / m_b has 61..63 significant bits; remainder feeds sticky.
    u128 num = static_cast<u128>(a.m) << 62;
    u128 q = num / b.m;
    u128 rem = num % b.m;
    return round_to_53(q, rem != 0, a.e - b.e - 62);
}

F64 sf_mul(F64 a, F64 b) {
    if (a.zero || b.zero) return F64{};
    u128 p = static_cast<u128>(a.m) * b.m; // 104..106 bits
    return round_to_53(p, false, a.e + b.e);
}

F64 sf_add(F64 a, F64 b) {
    if (a.zero) return b;
    if (b.zero) return a;
    if (a.e < b.e) { F64 t = a; a = b; b = t; }
    int d = a.e - b.e;
    if (d >= 55) return a; // b < half an ulp of a: rounds away entirely
    u128 sum = (static_cast<u128>(a.m) << d) + b.m; // <= 108 bits
    if (top_bit(sum) <= 52) { // no rounding needed: exact at scale 2^b.e
        F64 r;
        r.zero = false;
        std::uint64_t m = static_cast<std::uint64_t>(sum);
        int e = b.e;
        while (m < (1ULL << 52)) { m <<= 1; --e; }
        r.m = m;
        r.e = e;
        return r;
    }
    return round_to_53(sum, false, b.e);
}

std::string sf_fmt(F64 x, int decimals) {
    assert(decimals == 0 || decimals == 1);
    std::uint64_t pow10 = decimals == 1 ? 10 : 1;
    u128 scaled_int; // round_half_even(x * 10^decimals)
    if (x.zero) {
        scaled_int = 0;
    } else if (x.e >= 0) {
        scaled_int = (static_cast<u128>(x.m) * pow10) << x.e; // exact, small e
    } else {
        int shift = -x.e;
        u128 num = static_cast<u128>(x.m) * pow10;
        if (shift > 120) {
            scaled_int = 0; // far below one half of the last digit
        } else {
            u128 q = num >> shift;
            u128 rest = num & ((static_cast<u128>(1) << shift) - 1);
            u128 half = static_cast<u128>(1) << (shift - 1);
            if (rest > half || (rest == half && (q & 1))) q += 1;
            scaled_int = q;
        }
    }
    std::uint64_t n = static_cast<std::uint64_t>(scaled_int);
    if (decimals == 0) return std::to_string(n);
    return std::to_string(n / 10) + "." + std::to_string(n % 10);
}

} // namespace jerrymap
