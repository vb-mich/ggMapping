// The coordinate convention, CONTRACTS.md §2. Panels (tx,ty) with no zero row or
// column, y north-positive; units (gx,gy) on one global grid, y growing south;
// r/c 1-based from the north and west edges.
#pragma once
#include <compare>
#include <string>
#include <vector>

namespace jerrymap {

struct GPos {
    int x = 0, y = 0;
    auto operator<=>(const GPos&) const = default;
};

struct Panel {
    int tx = 0, ty = 0;
    auto operator<=>(const Panel&) const = default;
};

// N NE E SE S SW W NW
inline constexpr int DIR_DX[8] = {0, 1, 1, 1, 0, -1, -1, -1};
inline constexpr int DIR_DY[8] = {-1, -1, 0, 1, 1, 1, 0, -1};
inline constexpr const char* DIR_NAME[8] = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};
// Side-neighbor order: N E S W (DIRS indices 0 2 4 6).
inline constexpr int SIDE_DX[4] = {0, 1, 0, -1};
inline constexpr int SIDE_DY[4] = {-1, 0, 1, 0};

enum Rung { VD = 0, DP = 1, MD = 2, SH = 3, CO = 4, PL = 5, HI = 6, MO = 7 };
inline constexpr const char* RUNG_NAME[8] = {
    "verydeep", "deep", "medium", "shallow", "coastal", "plain", "hills", "mountains"};
inline bool is_water(int r) { return r <= SH; }
inline bool is_height(int r) { return r >= HI; }

inline int cheb(GPos a, GPos b) {
    int dx = a.x > b.x ? a.x - b.x : b.x - a.x;
    int dy = a.y > b.y ? a.y - b.y : b.y - a.y;
    return dx > dy ? dx : dy;
}

// Panel geometry: held by the sim, never global (CONTRACTS: no globals).
struct Geo {
    int W = 5, H = 6;
    int area() const { return W * H; }

    GPos origin(Panel t) const {
        int txi = t.tx > 0 ? t.tx - 1 : t.tx;
        int tyi = t.ty > 0 ? -t.ty : -t.ty - 1;
        return {txi * W, tyi * H};
    }
    Panel panel_of(GPos g) const {
        int txi = g.x >= 0 ? g.x / W : -((-g.x + W - 1) / W);
        int tyi = g.y >= 0 ? g.y / H : -((-g.y + H - 1) / H);
        return {txi >= 0 ? txi + 1 : txi, tyi >= 0 ? -(tyi + 1) : -tyi};
    }
    // Row-major, north row first: the oracle's tile_units order.
    std::vector<GPos> units(Panel t) const {
        GPos o = origin(t);
        std::vector<GPos> out;
        out.reserve(static_cast<std::size_t>(W) * H);
        for (int r = 0; r < H; ++r)
            for (int c = 0; c < W; ++c) out.push_back({o.x + c, o.y + r});
        return out;
    }
    GPos unit_at(Panel t, int row, int col) const { // 1-based
        GPos o = origin(t);
        return {o.x + col - 1, o.y + row - 1};
    }
    void rc_of(GPos g, int& r, int& c) const {
        GPos o = origin(panel_of(g));
        r = g.y - o.y + 1;
        c = g.x - o.x + 1;
    }
    static std::string name(Panel t) {
        std::string ns = t.ty > 0 ? "N" + std::to_string(t.ty) : "S" + std::to_string(-t.ty);
        std::string ew = t.tx > 0 ? "E" + std::to_string(t.tx) : "W" + std::to_string(-t.tx);
        return ns + "/" + ew;
    }
    // Panel-grid side step skipping the nonexistent zero row/column.
    static Panel side_panel(Panel t, int dx, int dy) {
        int nx = t.tx + dx, ny = t.ty + dy;
        if (nx == 0) nx = dx > 0 ? 1 : -1;
        if (ny == 0) ny = dy > 0 ? 1 : -1;
        return {nx, ny};
    }
};

} // namespace jerrymap
