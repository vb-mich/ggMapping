// Minimal JSON (parse + emit) for state and decision records. Integers only —
// the engine is float-free; u64 values travel as decimal strings (CONTRACTS §6.3).
#pragma once
#include <cstdint>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace jerrymap {

struct Json;
using JsonArr = std::vector<Json>;
using JsonObj = std::vector<std::pair<std::string, Json>>; // insertion-ordered

struct Json {
    enum class T { Null, Bool, Int, Str, Arr, Obj } t = T::Null;
    bool b = false;
    std::int64_t i = 0;
    std::string s;
    std::shared_ptr<JsonArr> arr;
    std::shared_ptr<JsonObj> obj;

    Json() = default;
    static Json null() { return Json(); }
    static Json of(bool v) { Json j; j.t = T::Bool; j.b = v; return j; }
    static Json of(std::int64_t v) { Json j; j.t = T::Int; j.i = v; return j; }
    static Json of(int v) { return of(static_cast<std::int64_t>(v)); }
    static Json of(std::string v) { Json j; j.t = T::Str; j.s = std::move(v); return j; }
    static Json of(const char* v) { return of(std::string(v)); }
    static Json array() { Json j; j.t = T::Arr; j.arr = std::make_shared<JsonArr>(); return j; }
    static Json object() { Json j; j.t = T::Obj; j.obj = std::make_shared<JsonObj>(); return j; }

    void push(Json v) { arr->push_back(std::move(v)); }
    void set(const std::string& k, Json v) { obj->emplace_back(k, std::move(v)); }

    bool has(const std::string& k) const {
        if (t != T::Obj) return false;
        for (auto& kv : *obj) if (kv.first == k) return true;
        return false;
    }
    const Json& at(const std::string& k) const {
        for (auto& kv : *obj) if (kv.first == k) return kv.second;
        throw std::runtime_error("json: missing key " + k);
    }
    std::int64_t as_int() const {
        if (t != T::Int) throw std::runtime_error("json: not an int");
        return i;
    }
    bool as_bool() const {
        if (t != T::Bool) throw std::runtime_error("json: not a bool");
        return b;
    }
    const std::string& as_str() const {
        if (t != T::Str) throw std::runtime_error("json: not a string");
        return s;
    }
    const JsonArr& as_arr() const {
        if (t != T::Arr) throw std::runtime_error("json: not an array");
        return *arr;
    }
    const JsonObj& as_obj() const {
        if (t != T::Obj) throw std::runtime_error("json: not an object");
        return *obj;
    }
};

std::string json_emit(const Json& j, int indent = 0);
Json json_parse(const std::string& text);

} // namespace jerrymap
