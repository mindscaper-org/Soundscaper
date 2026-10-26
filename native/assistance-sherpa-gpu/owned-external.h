/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <memory>

#include "napi.h"
#include "owned-handles.h"

ScapeOwnedHandleRegistry &ScapeSpeechHandleRegistry();

/** Retain the upstream External shape while making per-job destruction explicit. */
template<typename T>
class ScapeOwnedExternal : public Napi::External<ScapeOwnedHandle> {
  using Base = Napi::External<ScapeOwnedHandle>;

 public:
  ScapeOwnedExternal() = default;
  ScapeOwnedExternal(napi_env env, napi_value value) : Base(env, value) {}
  explicit ScapeOwnedExternal(const Base &value) : Base(value) {}

  template<typename Finalizer>
  static ScapeOwnedExternal New(Napi::Env env, T *value, Finalizer finalize) {
    auto release = [env, finalize](T *pointer) { finalize(env, pointer); };
    std::unique_ptr<T, decltype(release)> pending(value, release);
    auto owned = std::make_unique<ScapeOwnedHandle>(ScapeSpeechHandleRegistry(), value,
        [env, finalize](void *pointer) { finalize(env, static_cast<T *>(pointer)); });
    pending.release();
    auto external = Base::New(env, owned.get(),
        [](Napi::Env, ScapeOwnedHandle *handle) { delete handle; });
    owned.release();
    return ScapeOwnedExternal(external);
  }

  T *Data() const {
    auto *value = static_cast<T *>(Base::Data()->Data());
    if (!value) throw Napi::Error::New(this->Env(), "The native speech handle is disposed.");
    return value;
  }
};
