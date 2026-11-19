/* SPDX-License-Identifier: AGPL-3.0-only */
#include "raw_engine.hpp"
#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace lightscaper::raw::current_v1 {
namespace {
static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
std::uint16_t word(const Result& source, std::size_t sample) {
 const auto offset = sample * 2U;
 return static_cast<std::uint16_t>(std::uint16_t(source.bytes[offset]) | (std::uint16_t(source.bytes[offset + 1]) << 8U));
}
float floating(const Result& source, std::size_t sample) {
 const auto offset = sample * 4U;
 const auto bits = std::uint32_t(source.bytes[offset]) | (std::uint32_t(source.bytes[offset + 1]) << 8U)
  | (std::uint32_t(source.bytes[offset + 2]) << 16U) | (std::uint32_t(source.bytes[offset + 3]) << 24U);
 return std::bit_cast<float>(bits);
}
std::uint8_t display(double linear) {
 linear = std::clamp(linear, 0.0, 1.0);
 const double encoded = linear <= .0031308 ? linear * 12.92 : 1.055 * std::pow(linear, 1.0 / 2.4) - .055;
 return static_cast<std::uint8_t>(std::floor(encoded * 255.0 + .5));
}
void validate(const Result& source) {
 if (!source.width || !source.height || source.width > maximum_side || source.height > maximum_side
  || std::uint64_t(source.width) * source.height > maximum_pixels || source.channels != 4 || source.raw_flip > 7
  || !std::isfinite(source.exposure_scale) || source.exposure_scale < 1 || source.exposure_scale > 65536)
  throw std::range_error("Native preview source geometry/provenance is invalid.");
 const auto pixels = std::size_t(source.width) * source.height;
 if (source.format == Format::rgba16le) {
  if (source.bits != 16 || source.bytes.size() != pixels * 8U) throw std::range_error("Native neutral preview source storage is invalid.");
  for (std::size_t pixel = 0; pixel < pixels; ++pixel) if (word(source, pixel * 4U + 3U) != 65535)
   throw std::range_error("Native neutral preview source is not opaque.");
 } else if (source.format == Format::rgba32fle) {
  if (source.bits != 32 || source.bytes.size() != pixels * 16U) throw std::range_error("Native derived preview source storage is invalid.");
  for (std::size_t sample = 0; sample < pixels * 4U; ++sample) {
   const float value = floating(source, sample);
   if (!std::isfinite(value) || (sample % 4U == 3U && value != 1.F)) throw std::range_error("Native derived preview source is nonfinite or nonopaque.");
  }
 } else throw std::range_error("Native JPEG/bitmap pixel preview requires a separately authenticated decoder/profile.");
}
} // namespace

Result preview(const Result& source, Tier tier) {
 const auto side = tier == Tier::thumbnail ? 512U : tier == Tier::fit_screen ? 2048U : 0U;
 if (!side) throw std::range_error("Native preview tier is unsupported.");
 validate(source);
 const double scale = std::min(1.0, std::min(double(side) / source.width, double(side) / source.height));
 Result result; result.format = Format::rgba8;
 result.width = std::max(1U, static_cast<unsigned>(std::floor(source.width * scale + .5)));
 result.height = std::max(1U, static_cast<unsigned>(std::floor(source.height * scale + .5)));
 result.channels = 4; result.bits = 8; result.raw_flip = source.raw_flip; result.exposure_scale = source.exposure_scale;
 if (result.width > side || result.height > side || std::uint64_t(result.width) * result.height * 4U > 16U * 1024U * 1024U)
  throw std::range_error("Native preview output exceeds its declared tier.");
 result.bytes.resize(std::size_t(result.width) * result.height * 4U);
 for (std::uint32_t y = 0; y < result.height; ++y) for (std::uint32_t x = 0; x < result.width; ++x) {
  const auto source_y = std::uint64_t(y) * source.height / result.height;
  const auto source_x = std::uint64_t(x) * source.width / result.width;
  const auto from = (std::size_t(source_y) * source.width + static_cast<std::size_t>(source_x)) * 4U;
  const auto to = (std::size_t(y) * result.width + x) * 4U;
  for (std::size_t channel = 0; channel < 3; ++channel) {
   const double sample = source.format == Format::rgba16le ? double(word(source, from + channel)) * (1.0 / 65535.0)
    : double(floating(source, from + channel));
   result.bytes[to + channel] = display(sample);
  }
  result.bytes[to + 3] = 255;
 }
 return result;
}
} // namespace lightscaper::raw::current_v1
