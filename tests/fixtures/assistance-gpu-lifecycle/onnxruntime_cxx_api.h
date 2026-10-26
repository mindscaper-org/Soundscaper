/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <cstddef>
#include <cstdint>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>

inline constexpr int ORT_LOGGING_LEVEL_ERROR = 3;
inline constexpr int OrtArenaAllocator = 1;
inline constexpr int OrtMemTypeDefault = 0;

namespace FakeOrt {
inline int registrations = 0;
inline int sessions = 0;
inline bool fail_session = false;
inline bool available = true;
}

namespace Ort {
inline void InitApi() {}

struct Env {
  bool registered = false;
  Env(int, const char *) {}
  void RegisterExecutionProviderLibrary(const char *, const char *) {
    if (FakeOrt::registrations) throw std::runtime_error("duplicate provider registration");
    registered = true;
    ++FakeOrt::registrations;
  }
  void UnregisterExecutionProviderLibrary(const char *) {
    if (FakeOrt::sessions || !registered) throw std::runtime_error("provider has active sessions");
    registered = false;
    --FakeOrt::registrations;
  }
  std::vector<int> GetEpDevices() { return FakeOrt::available ? std::vector<int>{1} : std::vector<int>{}; }
};

struct SessionOptions {
  void AppendExecutionProvider_V2(Env &, std::initializer_list<int>,
      const std::unordered_map<std::string, std::string> &) {}
  void AddConfigEntry(const char *, const char *) {}
  void SetIntraOpNumThreads(int) {}
  void SetInterOpNumThreads(int) {}
  void EnableProfiling(const char *) {}
};

struct MemoryInfo {
  static MemoryInfo CreateCpu(int, int) { return {}; }
};

struct Value {
  template<typename T>
  static Value CreateTensor(MemoryInfo &, T *, std::size_t, const std::int64_t *, std::size_t) { return {}; }
};

struct RunOptions { explicit RunOptions(std::nullptr_t) {} };
struct AllocatorWithDefaultOptions {};

struct Session {
  Session(Env &, const unsigned char *, std::size_t, const SessionOptions &) {
    if (FakeOrt::fail_session) throw std::runtime_error("session initialization failed");
    ++FakeOrt::sessions;
  }
  ~Session() { --FakeOrt::sessions; }
  void Run(RunOptions, const char *const *, Value *, std::size_t, const char *const *, Value *, std::size_t) {}
  void EndProfilingAllocated(AllocatorWithDefaultOptions &) {}
};
}
