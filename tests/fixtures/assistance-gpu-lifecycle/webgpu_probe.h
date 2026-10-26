/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <filesystem>

inline void ScapeRunWebGpuProbe(const std::filesystem::path &) {}
inline bool ScapeIsWebGpuPluginDevice(int, const std::filesystem::path &) { return true; }
