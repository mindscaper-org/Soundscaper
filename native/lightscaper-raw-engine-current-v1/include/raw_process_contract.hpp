/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <cstddef>
#include <cstdint>
namespace lightscaper::raw::process_current_v1 {
inline constexpr char magic[] = "SRR1";
inline constexpr std::uint8_t version = 1;
inline constexpr std::size_t header_bytes = 16, control_bytes = 4096, chunk_bytes = 1048576;
enum class opcode : std::uint8_t { init=1, begin=2, data=3, seal=4, read=5, release=6, error=255 };
} // namespace lightscaper::raw::process_current_v1
