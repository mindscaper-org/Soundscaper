/* SPDX-License-Identifier: AGPL-3.0-only */
#include "owned-external.h"

#if defined(_WIN32)
extern "C" __declspec(dllimport) int SherpaOnnxReleaseWebGpuProvider() noexcept;
#else
extern "C" int SherpaOnnxReleaseWebGpuProvider() noexcept;
#endif

ScapeOwnedHandleRegistry &ScapeSpeechHandleRegistry() {
  static thread_local ScapeOwnedHandleRegistry registry;
  return registry;
}

static void DisposeSpeechResources() {
  ScapeSpeechHandleRegistry().DisposeAll();
  if (SherpaOnnxReleaseWebGpuProvider() != 0) {
    throw std::runtime_error("The native speech GPU provider could not be released.");
  }
}

void InitScapeSpeechDisposal(Napi::Env env, Napi::Object exports) {
  exports.Set("disposeGpuResources", Napi::Function::New(env, [](const Napi::CallbackInfo &info) {
    DisposeSpeechResources();
    return info.Env().Undefined();
  }));
  // Cancellation can bypass the JS terminal path; release sessions before N-API finalizers.
  env.AddCleanupHook([]() {
    try { DisposeSpeechResources(); } catch (...) {}
  });
}
