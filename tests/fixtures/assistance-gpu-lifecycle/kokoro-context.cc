/* SPDX-License-Identifier: AGPL-3.0-only */
#include "ort-gemm.cc"
#include <cassert>

int main() {
  void *first = nullptr;
  void *second = nullptr;
  assert(scape_g2p_gpu_open(&first, "profile") == 0);
  assert(scape_g2p_gpu_open(&second, nullptr) == 0);
  assert(FakeOrt::registrations == 1 && FakeOrt::sessions == 2);
  assert(scape_g2p_gpu_close(first) == 0);
  assert(FakeOrt::registrations == 1 && FakeOrt::sessions == 1);
  assert(scape_g2p_gpu_close(second) == 0);
  assert(FakeOrt::registrations == 0 && FakeOrt::sessions == 0);

  // A later request owns a fresh registration; failed construction retires it too.
  assert(scape_g2p_gpu_open(&first, nullptr) == 0);
  assert(scape_g2p_gpu_close(first) == 0);
  FakeOrt::fail_session = true;
  assert(scape_g2p_gpu_open(&first, nullptr) == 2 && first == nullptr);
  assert(FakeOrt::registrations == 0 && FakeOrt::sessions == 0);
  FakeOrt::fail_session = false;
  FakeOrt::available = false;
  assert(scape_g2p_gpu_open(&first, nullptr) == 2 && first == nullptr);
  assert(FakeOrt::registrations == 0 && FakeOrt::sessions == 0);

  FakeOrt::available = true;
  FakeOrt::fail_unregister = true;
  assert(scape_g2p_gpu_open(&first, nullptr) == 0);
  assert(scape_g2p_gpu_close(first) == 0);
  assert(FakeOrt::registrations == 0 && FakeOrt::sessions == 0);
}
