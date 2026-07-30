#include "jerrymap/json.hpp"

namespace jerrymap {

namespace {

void emit_str(const std::string& s, std::string& out) {
    out += '"';
    for (char ch : s) {
        switch (ch) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (static_cast<unsigned char>(ch) < 0x20) {
                    static const char* hex = "0123456789abcdef";
                    out += "\\u00";
                    out += hex[(ch >> 4) & 0xF];
                    out += hex[ch & 0xF];
                } else {
                    out += ch;
                }
        }
    }
    out += '"';
}

void emit_val(const Json& j, int indent, int depth, std::string& out) {
    std::string pad(static_cast<std::size_t>(indent) * depth, ' ');
    std::string pad1(static_cast<std::size_t>(indent) * (depth + 1), ' ');
    const char* nl = indent ? "\n" : "";
    switch (j.t) {
        case Json::T::Null: out += "null"; break;
        case Json::T::Bool: out += j.b ? "true" : "false"; break;
        case Json::T::Int: out += std::to_string(j.i); break;
        case Json::T::Str: emit_str(j.s, out); break;
        case Json::T::Arr: {
            if (j.arr->empty()) { out += "[]"; break; }
            out += '[';
            out += nl;
            for (std::size_t k = 0; k < j.arr->size(); ++k) {
                if (indent) out += pad1;
                emit_val((*j.arr)[k], indent, depth + 1, out);
                if (k + 1 < j.arr->size()) out += ',';
                out += nl;
            }
            if (indent) out += pad;
            out += ']';
            break;
        }
        case Json::T::Obj: {
            if (j.obj->empty()) { out += "{}"; break; }
            out += '{';
            out += nl;
            for (std::size_t k = 0; k < j.obj->size(); ++k) {
                if (indent) out += pad1;
                emit_str((*j.obj)[k].first, out);
                out += indent ? ": " : ":";
                emit_val((*j.obj)[k].second, indent, depth + 1, out);
                if (k + 1 < j.obj->size()) out += ',';
                out += nl;
            }
            if (indent) out += pad;
            out += '}';
            break;
        }
    }
}

struct Parser {
    const std::string& t;
    std::size_t p = 0;
    explicit Parser(const std::string& text) : t(text) {}

    [[noreturn]] void fail(const std::string& msg) {
        throw std::runtime_error("json parse: " + msg + " at offset " + std::to_string(p));
    }
    void ws() {
        while (p < t.size() && (t[p] == ' ' || t[p] == '\t' || t[p] == '\n' || t[p] == '\r'))
            ++p;
    }
    char peek() {
        if (p >= t.size()) fail("unexpected end");
        return t[p];
    }
    void expect(char c) {
        if (p >= t.size() || t[p] != c) fail(std::string("expected '") + c + "'");
        ++p;
    }
    bool lit(const char* s) {
        std::size_t n = 0;
        while (s[n]) ++n;
        if (t.compare(p, n, s) == 0) { p += n; return true; }
        return false;
    }

    std::string parse_string() {
        expect('"');
        std::string out;
        for (;;) {
            if (p >= t.size()) fail("unterminated string");
            char c = t[p++];
            if (c == '"') return out;
            if (c == '\\') {
                if (p >= t.size()) fail("bad escape");
                char e = t[p++];
                switch (e) {
                    case '"': out += '"'; break;
                    case '\\': out += '\\'; break;
                    case '/': out += '/'; break;
                    case 'n': out += '\n'; break;
                    case 'r': out += '\r'; break;
                    case 't': out += '\t'; break;
                    case 'b': out += '\b'; break;
                    case 'f': out += '\f'; break;
                    case 'u': {
                        if (p + 4 > t.size()) fail("bad \\u");
                        unsigned v = 0;
                        for (int k = 0; k < 4; ++k) {
                            char h = t[p++];
                            v <<= 4;
                            if (h >= '0' && h <= '9') v |= static_cast<unsigned>(h - '0');
                            else if (h >= 'a' && h <= 'f') v |= static_cast<unsigned>(h - 'a' + 10);
                            else if (h >= 'A' && h <= 'F') v |= static_cast<unsigned>(h - 'A' + 10);
                            else fail("bad hex");
                        }
                        // engine strings are ASCII; encode BMP as UTF-8 for safety
                        if (v < 0x80) out += static_cast<char>(v);
                        else if (v < 0x800) {
                            out += static_cast<char>(0xC0 | (v >> 6));
                            out += static_cast<char>(0x80 | (v & 0x3F));
                        } else {
                            out += static_cast<char>(0xE0 | (v >> 12));
                            out += static_cast<char>(0x80 | ((v >> 6) & 0x3F));
                            out += static_cast<char>(0x80 | (v & 0x3F));
                        }
                        break;
                    }
                    default: fail("bad escape char");
                }
            } else {
                out += c;
            }
        }
    }

    Json parse_value() {
        ws();
        char c = peek();
        if (c == '{') {
            ++p;
            Json j = Json::object();
            ws();
            if (peek() == '}') { ++p; return j; }
            for (;;) {
                ws();
                std::string k = parse_string();
                ws();
                expect(':');
                j.set(k, parse_value());
                ws();
                if (peek() == ',') { ++p; continue; }
                expect('}');
                return j;
            }
        }
        if (c == '[') {
            ++p;
            Json j = Json::array();
            ws();
            if (peek() == ']') { ++p; return j; }
            for (;;) {
                j.push(parse_value());
                ws();
                if (peek() == ',') { ++p; continue; }
                expect(']');
                return j;
            }
        }
        if (c == '"') return Json::of(parse_string());
        if (lit("true")) return Json::of(true);
        if (lit("false")) return Json::of(false);
        if (lit("null")) return Json::null();
        // integer (the engine is float-free; no fraction/exponent accepted)
        bool neg = false;
        if (c == '-') { neg = true; ++p; }
        if (p >= t.size() || t[p] < '0' || t[p] > '9') fail("expected value");
        std::int64_t v = 0;
        while (p < t.size() && t[p] >= '0' && t[p] <= '9') {
            v = v * 10 + (t[p] - '0');
            ++p;
        }
        return Json::of(neg ? -v : v);
    }
};

} // namespace

std::string json_emit(const Json& j, int indent) {
    std::string out;
    emit_val(j, indent, 0, out);
    return out;
}

Json json_parse(const std::string& text) {
    Parser ps(text);
    Json j = ps.parse_value();
    ps.ws();
    if (ps.p != text.size()) ps.fail("trailing content");
    return j;
}

} // namespace jerrymap
