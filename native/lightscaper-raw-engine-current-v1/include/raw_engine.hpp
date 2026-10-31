/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once

#include <cstddef>
#include <cstdint>
#include <string_view>
#include <vector>

namespace lightscaper::raw::current_v1 {

// Native identities never stand in for the exact existing WASM runtime pin.
inline constexpr std::string_view engine_id = "lightscaper-libraw-native";
inline constexpr unsigned engine_version = 1;
inline constexpr std::string_view upstream_version = "0.22.2";
inline constexpr std::string_view preview_recipe = "lightscaper.native-original-preview.rgba8-nearest/v1";
inline constexpr std::size_t maximum_input_bytes = 64U * 1024U * 1024U;
inline constexpr std::uint32_t maximum_side = 8192U;
inline constexpr std::uint64_t maximum_pixels = 16777216U;
inline constexpr std::size_t maximum_embedded_bytes = 16U * 1024U * 1024U;

enum class Mode { neutral, linear_headroom, highlight_recovery, embedded };
enum class Tier { thumbnail, fit_screen };
enum class Format { none, rgba8, rgba16le, rgba32fle, jpeg, bitmap8, bitmap16le };

/** Trusted native owner, never an IPC authority. Whole linear planes are
 * top-left oriented opaque sRGB. Embedded bytes retain their actual native
 * geometry/flip and have no invented display color interpretation. */
struct Result final {
 Format format = Format::none;
 std::uint32_t width = 0, height = 0, channels = 0, bits = 0, raw_flip = 0;
 double exposure_scale = 1;
 std::vector<std::uint8_t> bytes;
 Result() noexcept = default;
 Result(Result&& other) noexcept;
 Result& operator=(Result&& other) noexcept;
 Result(const Result&) = delete;
 Result& operator=(const Result&) = delete;
 ~Result();
 void wipe() noexcept;
};

/** Own a private encoded snapshot before actual LibRaw work. No filenames,
 * arbitrary processing options or decoder pointers cross this fixed kernel.
 * All decoder objects/scratch retire before successful output delivery. The
 * future supervised process owner additionally owns actual process retirement;
 * this native library makes no account-level sandbox or whole-heap wipe claim. */
Result decode(Mode mode, const std::uint8_t* input, std::size_t byte_length);

/** Disposable exact-profile nearest preview, never Original/develop authority.
 * JPEG pixels and embedded-bitmap transfer interpretation are unsupported;
 * callers must choose the complete declared fallback, not invent a frame. */
Result preview(const Result& decoded, Tier tier);

} // namespace lightscaper::raw::current_v1
