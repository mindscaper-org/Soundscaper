/* SPDX-License-Identifier: AGPL-3.0-only */
#include "raw_engine.hpp"
#include "libraw/libraw.h"
#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>

namespace lightscaper::raw::current_v1::detail {
void wipe_bytes(void* memory, std::size_t length) noexcept;
namespace {
constexpr std::uint64_t native_working_bytes = 512U * 1024U * 1024U;
constexpr std::uint64_t metadata_reserve = 32U * 1024U * 1024U;
constexpr std::uint64_t ahd_scratch = 6815744U;
constexpr std::uint64_t histogram_and_profile = 4U * 8192U * 4U + 1024U;
static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
bool dimensions(std::uint32_t width, std::uint32_t height) {
 return width >= 16 && height >= 16 && width <= maximum_side && height <= maximum_side
  && std::uint64_t(width) * height <= maximum_pixels;
}
void require_status(int status, const char* phase) {
 if (status) throw std::runtime_error(std::string("Native LibRaw recovery ") + phase + " refused (" + std::to_string(status) + ").");
}
void float_le(std::vector<std::uint8_t>& bytes, std::size_t offset, float value) {
 const auto bits = std::bit_cast<std::uint32_t>(value);
 for (unsigned index = 0; index < 4; ++index) bytes[offset + index] = static_cast<std::uint8_t>(bits >> (index * 8U));
}

/** The same fixed pre-ushort capture as the independently pinned ABI2 oracle.
 * State is local to this actual LibRaw object; no static decoder/heap pointer. */
class RecoveryDecoder final : public LibRaw {
public:
 explicit RecoveryDecoder(std::size_t length) : input_length_(length) {}
 ~RecoveryDecoder() override { wipe_bytes(rgb_.data(), rgb_.size() * sizeof(float)); }
 void parameters(int mode) {
  auto& p = imgdata.params;
  p.output_bps = 16; p.output_color = 1; p.gamm[0] = 1.0; p.gamm[1] = 1.0;
  p.no_auto_bright = 1; p.bright = 1.F; p.user_qual = 3; p.user_flip = -1;
  p.use_auto_wb = 0; p.use_camera_wb = 0; p.use_camera_matrix = 1; p.no_auto_scale = 0;
  p.highlight = mode; p.adjust_maximum_thr = .75F;
  p.half_size = 0; p.four_color_rgb = 0; p.threshold = 0; p.no_interpolation = 0;
  p.green_matching = 0; p.med_passes = 0; p.exp_correc = 0; p.use_fuji_rotate = 1;
  p.output_profile = nullptr; p.camera_profile = nullptr; p.bad_pixels = nullptr; p.dark_frame = nullptr;
  p.user_black = -1; p.user_sat = -1;
  for (unsigned channel = 0; channel < 4; ++channel) { p.user_mul[channel] = 0; p.user_cblack[channel] = -1000001; p.aber[channel] = 1.0; }
  p.cropbox[0] = p.cropbox[1] = 0; p.cropbox[2] = p.cropbox[3] = std::numeric_limits<unsigned>::max();
  imgdata.rawparams.max_raw_memory_mb = 256;
  imgdata.rawparams.use_rawspeed = 0; imgdata.rawparams.use_dngsdk = 0; imgdata.rawparams.options = 0;
 }
 bool supported_layout(bool unpacked) {
  const auto& s = imgdata.sizes; const auto& id = imgdata.idata; const auto& internal = libraw_internal_data;
  if (!dimensions(s.raw_width, s.raw_height) || !dimensions(s.width, s.height)
   || std::uint64_t(s.left_margin) + s.width > s.raw_width || std::uint64_t(s.top_margin) + s.height > s.raw_height
   || !std::isfinite(s.pixel_aspect) || s.pixel_aspect != 1.0 || s.flip < 0 || s.flip > 7
   || id.colors != 3 || id.is_foveon || id.filters <= 1000
   || id.cdesc[0] != 'R' || id.cdesc[1] != 'G' || id.cdesc[2] != 'B' || (id.cdesc[3] != 'G' && id.cdesc[3] != '\0')
   || internal.internal_output_params.fuji_width || internal.unpacker_data.fuji_layout
   || internal.internal_output_params.shrink || imgdata.params.half_size || imgdata.params.four_color_rgb
   || is_floating_point() || is_sraw()) return false;
  if (s.raw_pitch && std::uint64_t(s.raw_pitch) != std::uint64_t(s.raw_width) * 2U) return false;
  static constexpr unsigned char tiles[4][4] = {{0,1,1,2},{2,1,1,0},{1,0,2,1},{1,2,0,1}};
  bool regular = false;
  for (unsigned tile = 0; tile < 4; ++tile) {
   bool matches = true;
   for (int row = 0; row < 8; ++row) for (int column = 0; column < 2; ++column) {
    const int channel = FC(row, column), canonical = channel == 3 ? 1 : channel;
    if (canonical != tiles[tile][(row % 2) * 2 + column]) matches = false;
   }
   regular = regular || matches;
  }
  if (!regular) return false;
  if (unpacked) {
   const auto& r = imgdata.rawdata;
   if (!r.raw_image || r.color3_image || r.color4_image || r.float_image || r.float3_image || r.float4_image
    || have_fpdata() || std::uint64_t(s.raw_pitch) != std::uint64_t(s.raw_width) * 2U) return false;
  }
  return true;
 }
 bool working_bounds() const {
  const auto& s = imgdata.sizes;
  if (!dimensions(s.raw_width, s.raw_height) || !dimensions(s.width, s.height)) return false;
  const auto raw_bytes = std::uint64_t(s.raw_width) * (std::uint64_t(s.raw_height) + 8U) * 2U;
  const auto image_bytes = (std::uint64_t(s.width) + 2U) * (std::uint64_t(s.height) + 2U) * 8U;
  const auto recovery_map = std::uint64_t(s.width / 4U) * (s.height / 4U) * 4U;
  const auto float_output = std::uint64_t(s.width) * s.height * 12U;
  const auto phase = std::max(ahd_scratch, std::max(recovery_map, float_output + histogram_and_profile));
  const auto metadata = std::uint64_t(libraw_internal_data.unpacker_data.meta_length);
  return metadata <= native_working_bytes && input_length_ + raw_bytes + image_bytes + metadata_reserve + metadata + phase <= native_working_bytes;
 }
 Result execute(const std::uint8_t* input, std::size_t length, int mode) {
  parameters(1); require_status(open_buffer(input, length), "open");
  if (!supported_layout(false) || !working_bounds()) throw std::range_error("Native RAW recovery layout or working profile is unsupported.");
  original_flip_ = static_cast<std::uint32_t>(imgdata.sizes.flip); parameters(mode);
  require_status(unpack(), "unpack");
  if (!supported_layout(true) || !working_bounds()) throw std::range_error("Native RAW recovery unpacked profile is unsupported.");
  require_status(dcraw_process(), "process");
  const auto& sizes = imgdata.sizes;
  const auto width = original_flip_ & 4U ? sizes.height : sizes.width;
  const auto height = original_flip_ & 4U ? sizes.width : sizes.height;
  if (!captured_ || rgb_.empty() || !supported_layout(true) || sizes.flip != static_cast<int>(original_flip_)
   || output_width_ != width || output_height_ != height || rgb_.size() != std::uint64_t(width) * height * 3U)
   throw std::runtime_error("Native RAW recovery did not return its complete fixed-profile plane.");
  Result result; result.format = Format::rgba32fle; result.width = width; result.height = height; result.channels = 4; result.bits = 32;
  result.raw_flip = original_flip_; result.exposure_scale = exposure_scale_;
  // Retire raw/image/scratch before RGB12 and the final RGBA16 byte plane
  // coexist. Together with the private <=64MiB input they fit <=512MiB.
  recycle(); result.bytes.resize(std::size_t(width) * height * 16U);
  for (std::size_t pixel = 0; pixel < std::size_t(width) * height; ++pixel) {
   for (std::size_t channel = 0; channel < 3; ++channel) float_le(result.bytes, (pixel * 4 + channel) * 4, rgb_[pixel * 3 + channel]);
   float_le(result.bytes, (pixel * 4 + 3) * 4, 1.F);
  }
  return result;
 }
protected:
 void convert_to_rgb_loop(float matrix[3][4]) override {
  if (captured_ || !rgb_.empty() || !supported_layout(true) || !working_bounds()
   || libraw_internal_data.internal_output_params.raw_color || !imgdata.image || imgdata.idata.colors != 3
   || imgdata.sizes.flip != static_cast<int>(original_flip_) || imgdata.sizes.iwidth != imgdata.sizes.width
   || imgdata.sizes.iheight != imgdata.sizes.height || !imgdata.color.maximum)
   throw std::range_error("Native RAW recovery conversion profile is unsupported.");
  double minimum = 2.0;
  for (unsigned channel = 0; channel < 4; ++channel) {
   const float q = imgdata.color.pre_mul[channel];
   if (!std::isfinite(q) || q <= 0 || q > 1.000001F || (channel < 3 && int(32000.F * q) < 1))
    throw std::range_error("Native RAW recovery normalization is unsupported.");
   minimum = std::min(minimum, double(q));
  }
  const double scale = 1.0 / minimum;
  if (!std::isfinite(scale) || scale < 1.0 || scale > 65536.0) throw std::range_error("Native RAW recovery exposure scale is invalid.");
  for (unsigned channel = 0; channel < 3; ++channel) for (unsigned camera = 0; camera < 4; ++camera)
   if (!std::isfinite(matrix[channel][camera])) throw std::range_error("Native RAW recovery matrix is invalid.");
  const std::uint32_t width = imgdata.sizes.width, height = imgdata.sizes.height;
  const auto oriented_width = original_flip_ & 4U ? height : width;
  const auto oriented_height = original_flip_ & 4U ? width : height;
  if (!dimensions(oriented_width, oriented_height)) throw std::range_error("Native RAW recovery output exceeds its geometry bound.");
  rgb_.resize(std::size_t(oriented_width) * oriented_height * 3U);
  // Exactly the upstream flip_index transform without an unoriented float
  // intermediate, followed by the same double-expression -> Float32 rounding.
  for (std::uint32_t row = 0; row < oriented_height; ++row) for (std::uint32_t column = 0; column < oriented_width; ++column) {
   auto source_row = row, source_column = column;
   if (original_flip_ & 4U) std::swap(source_row, source_column);
   if (original_flip_ & 2U) source_row = height - 1U - source_row;
   if (original_flip_ & 1U) source_column = width - 1U - source_column;
   const auto* camera = imgdata.image[std::uint64_t(source_row) * width + source_column];
   const auto to = (std::size_t(row) * oriented_width + column) * 3U;
   for (unsigned channel = 0; channel < 3; ++channel) {
    const double value = (double(matrix[channel][0]) * camera[0] + double(matrix[channel][1]) * camera[1]
     + double(matrix[channel][2]) * camera[2]) * scale / 65535.0;
    if (!std::isfinite(value) || std::fabs(value) > double(std::numeric_limits<float>::max())) throw std::range_error("Native RAW recovery sample is invalid.");
    const float stored = static_cast<float>(value);
    if (!std::isfinite(stored)) throw std::range_error("Native RAW recovery Float32 sample is invalid.");
    rgb_[to + channel] = stored;
   }
  }
  output_width_ = oriented_width; output_height_ = oriented_height; exposure_scale_ = scale; captured_ = true;
  // No LibRaw base conversion: its ushort clipping/histogram/gamma are outside
  // this explicit signed/headroom capture, just as in the existing ABI2.
 }
private:
 std::size_t input_length_;
 std::uint32_t original_flip_ = 0, output_width_ = 0, output_height_ = 0;
 double exposure_scale_ = 0;
 bool captured_ = false;
 std::vector<float> rgb_;
};
} // namespace

Result decode_recovery(Mode mode, const std::uint8_t* input, std::size_t length) {
 const int highlight = mode == Mode::linear_headroom ? 1 : mode == Mode::highlight_recovery ? 3 : 0;
 if (!highlight) throw std::range_error("Native RAW recovery requires a fixed supported mode.");
 RecoveryDecoder decoder(length); return decoder.execute(input, length, highlight);
}
} // namespace lightscaper::raw::current_v1::detail
