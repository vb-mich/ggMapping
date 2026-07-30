// Integer-only binary64 emulation for the report renderer (CONTRACTS.md §5.2).
//
// The oracle formats percentages as CPython formats IEEE-754 doubles with :.0f/:.1f.
// The engine is float-free, so the handful of double operations the reference
// performs (int/int division, multiplication, left-to-right addition) are emulated
// here exactly: 53-bit mantissas, round-to-nearest-even, and exact fixed-decimal
// conversion with round-half-even ties — byte-identical to Python's output.
#pragma once
#include <cstdint>
#include <string>

namespace jerrymap {

// Non-negative binary64 value: zero, or m * 2^e with 2^52 <= m < 2^53.
struct F64 {
    std::uint64_t m = 0;
    int e = 0;
    bool zero = true;
};

F64 sf_from_int(std::int64_t v);        // exact for 0 <= v <= 2^53
F64 sf_div(F64 a, F64 b);               // a / b, correctly rounded
F64 sf_mul(F64 a, F64 b);               // a * b, correctly rounded
F64 sf_add(F64 a, F64 b);               // a + b, correctly rounded
std::string sf_fmt(F64 x, int decimals); // CPython f"{x:.Nf}", N in {0, 1}

} // namespace jerrymap
