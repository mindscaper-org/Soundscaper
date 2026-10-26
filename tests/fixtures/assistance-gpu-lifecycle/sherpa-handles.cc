/* SPDX-License-Identifier: AGPL-3.0-only */
#include "owned-handles.h"
#include "webgpu-provider.cc"
#include <cassert>

int main() {
  ScapeOwnedHandleRegistry registry;
  int destroyed = 0;
  Ort::SessionOptions options;
  sherpa_onnx::ScapeAppendWebGpuProvider(options);
  auto create = [&]() {
    ++FakeOrt::sessions;
    return std::make_unique<ScapeOwnedHandle>(registry, new int(1), [&](void *value) {
      delete static_cast<int *>(value);
      ++destroyed;
      --FakeOrt::sessions;
    });
  };
  auto first = create();
  auto second = create();
  assert(SherpaOnnxReleaseWebGpuProvider() == 1);
  assert(FakeOrt::registrations == 1);
  first->Dispose();
  first->Dispose();
  assert(destroyed == 1);
  registry.DisposeAll();
  assert(destroyed == 2 && FakeOrt::sessions == 0);
  assert(SherpaOnnxReleaseWebGpuProvider() == 0);
  assert(FakeOrt::registrations == 0);
  first.reset();
  second.reset();
  assert(destroyed == 2);
  assert(SherpaOnnxReleaseWebGpuProvider() == 0);

  std::vector<int> order;
  ScapeOwnedHandle parent(registry, new int(1), [&](void *value) {
    order.push_back(*static_cast<int *>(value));
    delete static_cast<int *>(value);
  });
  ScapeOwnedHandle child(registry, new int(2), [&](void *value) {
    order.push_back(*static_cast<int *>(value));
    delete static_cast<int *>(value);
  });
  registry.DisposeAll();
  assert((order == std::vector<int>{2, 1}));

  sherpa_onnx::ScapeAppendWebGpuProvider(options);
  try {
    auto partial = create();
    throw std::runtime_error("later construction failed");
  } catch (const std::runtime_error &) {}
  registry.DisposeAll();
  assert(destroyed == 3);
  assert(SherpaOnnxReleaseWebGpuProvider() == 0);
  assert(FakeOrt::registrations == 0 && FakeOrt::sessions == 0);
}
