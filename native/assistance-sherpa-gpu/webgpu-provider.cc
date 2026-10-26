// SPDX-License-Identifier: AGPL-3.0-only
// Native GPU registration shared by every Sherpa ONNX model family.
#include <algorithm>
#include <filesystem>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#include "onnxruntime_cxx_api.h"
#include "webgpu_probe.h"
#if defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace sherpa_onnx {
namespace {
std::filesystem::path ProviderLibraryPath() {
#if defined(_WIN32)
  HMODULE module = nullptr;
  if (!GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                             GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                         reinterpret_cast<LPCWSTR>(&ProviderLibraryPath), &module)) {
    throw std::runtime_error("Cannot locate authenticated Sherpa WebGPU closure");
  }
  std::vector<wchar_t> path(32768);
  DWORD size = GetModuleFileNameW(module, path.data(), static_cast<DWORD>(path.size()));
  if (!size || size >= path.size()) {
    throw std::runtime_error("Cannot locate authenticated Sherpa WebGPU closure");
  }
  return std::filesystem::path(std::wstring(path.data(), size)).parent_path() /
         "onnxruntime_providers_webgpu.dll";
#else
  Dl_info info{};
  if (!dladdr(reinterpret_cast<void *>(&ProviderLibraryPath), &info) || !info.dli_fname) {
    throw std::runtime_error("Cannot locate authenticated Sherpa WebGPU closure");
  }
#if defined(__APPLE__)
  constexpr const char *filename = "libonnxruntime_providers_webgpu.dylib";
#else
  constexpr const char *filename = "libonnxruntime_providers_webgpu.so";
#endif
  return std::filesystem::path(info.dli_fname).parent_path() / filename;
#endif
}

struct WebGpuPlugin {
  const std::filesystem::path path = ProviderLibraryPath();
  // ORT CreateEnv retains the process-global OrtEnv used by Sherpa's models.
  Ort::Env env{ORT_LOGGING_LEVEL_ERROR, "soundscaper-sherpa-webgpu"};
  WebGpuPlugin() {
#if defined(_WIN32)
    const auto probe = path.parent_path() / "onnx-webgpu-device-probe.exe";
#else
    const auto probe = path.parent_path() / "onnx-webgpu-device-probe";
#endif
    ScapeRunWebGpuProbe(probe);
    env.RegisterExecutionProviderLibrary("soundscaper-sherpa-webgpu", path.c_str());
  }
};

struct WebGpuState {
  std::mutex mutex;
  std::unique_ptr<WebGpuPlugin> plugin;
};

WebGpuState &GpuState() {
  static WebGpuState state;
  return state;
}
}  // namespace

void ScapeAppendWebGpuProvider(Ort::SessionOptions &options) {
  auto &state = GpuState();
  std::lock_guard<std::mutex> lock(state.mutex);
  if (!state.plugin) state.plugin = std::make_unique<WebGpuPlugin>();
  auto &plugin = *state.plugin;
  const auto devices = plugin.env.GetEpDevices();
  for (const auto &device : devices) {
    if (ScapeIsWebGpuPluginDevice(device, plugin.path)) {
      options.AppendExecutionProvider_V2(plugin.env, {device},
                                         std::unordered_map<std::string, std::string>{});
      return;
    }
  }
  throw std::runtime_error("No compatible WebGPU device is available");
}
}  // namespace sherpa_onnx

// Called only after the owning Node-API environment has released every session.
#if defined(_WIN32)
#define SCAPE_SHERPA_EXPORT __declspec(dllexport)
#else
#define SCAPE_SHERPA_EXPORT __attribute__((visibility("default")))
#endif
extern "C" SCAPE_SHERPA_EXPORT int SherpaOnnxReleaseWebGpuProvider() noexcept {
  auto &state = sherpa_onnx::GpuState();
  std::lock_guard<std::mutex> lock(state.mutex);
  if (!state.plugin) return 0;
  try {
    state.plugin->env.UnregisterExecutionProviderLibrary("soundscaper-sherpa-webgpu");
    state.plugin.reset();
    return 0;
  } catch (...) { return 1; }
}
