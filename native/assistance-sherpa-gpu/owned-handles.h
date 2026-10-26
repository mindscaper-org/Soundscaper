/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <algorithm>
#include <exception>
#include <functional>
#include <stdexcept>
#include <utility>
#include <vector>

class ScapeOwnedHandle;

class ScapeOwnedHandleRegistry {
 public:
  void DisposeAll();
  void Add(ScapeOwnedHandle *handle) { handles_.push_back(handle); }
  void Remove(ScapeOwnedHandle *handle) {
    handles_.erase(std::remove(handles_.begin(), handles_.end(), handle), handles_.end());
  }

 private:
  std::vector<ScapeOwnedHandle *> handles_;
};

/** The external's finalizer and explicit job cleanup share one idempotent owner. */
class ScapeOwnedHandle {
 public:
  ScapeOwnedHandle(ScapeOwnedHandleRegistry &registry, void *value,
                   std::function<void(void *)> release)
      : registry_(registry), value_(value), release_(std::move(release)) {
    if (!value_ || !release_) throw std::invalid_argument("Invalid owned native handle");
    registry_.Add(this);
  }
  ~ScapeOwnedHandle() {
    try { Dispose(); } catch (...) {}
    registry_.Remove(this);
  }
  ScapeOwnedHandle(const ScapeOwnedHandle &) = delete;
  ScapeOwnedHandle &operator=(const ScapeOwnedHandle &) = delete;
  void *Data() const { return value_; }
  void Dispose() {
    auto *owned = std::exchange(value_, nullptr);
    if (owned) release_(owned);
  }

 private:
  ScapeOwnedHandleRegistry &registry_;
  void *value_;
  std::function<void(void *)> release_;
};

inline void ScapeOwnedHandleRegistry::DisposeAll() {
  std::exception_ptr failure;
  // Streams are created after their recognizers and must retire before them.
  for (auto handle = handles_.rbegin(); handle != handles_.rend(); ++handle) {
    try { (*handle)->Dispose(); }
    catch (...) { if (!failure) failure = std::current_exception(); }
  }
  if (failure) std::rethrow_exception(failure);
}
