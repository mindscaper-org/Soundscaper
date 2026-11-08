/* SPDX-License-Identifier: AGPL-3.0-only */
#include "raw_engine.hpp"
#include "libraw/libraw.h"
#include <algorithm>
#include <cstring>
#include <cstdio>
#include <ctime>
#include <memory>
#include <stdexcept>
#include <string>
#include <utility>

#if LIBRAW_MAJOR_VERSION != 0 || LIBRAW_MINOR_VERSION != 22 || LIBRAW_PATCH_VERSION != 2
#error The fixed native RAW engine requires the exact reviewed LibRaw 0.22.2 source.
#endif

namespace lightscaper::raw::current_v1 {
namespace detail {
Result decode_recovery(Mode mode, const std::uint8_t* input, std::size_t length);
void wipe_bytes(void* memory, std::size_t length) noexcept {
 auto* cursor = static_cast<volatile std::uint8_t*>(memory);
 for (std::size_t offset = 0; offset < length; ++offset) cursor[offset] = 0;
}
}
namespace {
constexpr std::uint64_t native_working_bytes = 512U * 1024U * 1024U;
bool dimensions(std::uint32_t width, std::uint32_t height) {
 return width && height && width <= maximum_side && height <= maximum_side
  && std::uint64_t(width) * height <= maximum_pixels;
}
void require_status(int status, const char* phase) {
 if (status) throw std::runtime_error(std::string("Native LibRaw ") + phase + " refused (" + std::to_string(status) + ").");
}
struct Input final {
 std::vector<std::uint8_t> bytes;
 Input(const std::uint8_t* source, std::size_t length) : bytes(source, source + length) {}
 Input(const Input&) = delete; Input& operator=(const Input&) = delete;
 ~Input() { detail::wipe_bytes(bytes.data(), bytes.size()); }
};
struct Image final {
 libraw_processed_image_t* value = nullptr;
 Image() = default; Image(const Image&) = delete; Image& operator=(const Image&) = delete;
 ~Image() {
  if (value) {
   // The trusted allocation belongs to LibRaw; its declared payload is checked
   // before delivery. Bound wiping too on every refusal path.
   detail::wipe_bytes(value->data, std::min<std::size_t>(value->data_size, maximum_pixels * 6U));
   LibRaw::dcraw_clear_mem(value);
  }
 }
};
void fixed_parameters(LibRaw& decoder) {
 auto& p = decoder.imgdata.params;
 p.output_bps = 16; p.output_color = 1; p.gamm[0] = 1.0; p.gamm[1] = 1.0;
 p.no_auto_bright = 1; p.bright = 1.F; p.user_qual = 3; p.user_flip = -1;
 p.use_auto_wb = 0; p.use_camera_wb = 0; p.no_auto_scale = 0;
 p.output_profile = nullptr; p.camera_profile = nullptr; p.bad_pixels = nullptr; p.dark_frame = nullptr;
 decoder.imgdata.rawparams.max_raw_memory_mb = 256;
 decoder.imgdata.rawparams.use_rawspeed = 0; decoder.imgdata.rawparams.use_dngsdk = 0;
}
void source_bounds(const LibRaw& decoder, std::size_t input_length) {
 const auto& s = decoder.imgdata.sizes;
 if (!dimensions(s.raw_width, s.raw_height) || !dimensions(s.width, s.height)
  || input_length + std::uint64_t(s.raw_width) * s.raw_height * 18U
   + std::uint64_t(s.width) * s.height * 6U > native_working_bytes)
  throw std::range_error("Native RAW source exceeds its fixed geometry/working profile.");
}
void word_le(std::vector<std::uint8_t>& output, std::size_t offset, std::uint16_t word) {
 output[offset] = static_cast<std::uint8_t>(word); output[offset + 1] = static_cast<std::uint8_t>(word >> 8U);
}
Result neutral(LibRaw& decoder, std::size_t input_length, std::uint32_t flip) {
 source_bounds(decoder, input_length); fixed_parameters(decoder);
 require_status(decoder.unpack(), "unpack"); require_status(decoder.dcraw_process(), "neutral process");
 int width = 0, height = 0, channels = 0, bits = 0;
 decoder.get_mem_image_format(&width, &height, &channels, &bits);
 if (!dimensions(static_cast<std::uint32_t>(width), static_cast<std::uint32_t>(height)) || channels != 3 || bits != 16
  || input_length + std::uint64_t(width) * static_cast<std::uint32_t>(height) * 24U > native_working_bytes)
  throw std::range_error("Native RAW neutral output exceeds its fixed profile.");
 int error = 0; Image image; image.value = decoder.dcraw_make_mem_image(&error);
 require_status(error, "neutral image");
 if (!image.value || image.value->type != LIBRAW_IMAGE_BITMAP || image.value->width != width || image.value->height != height
  || image.value->colors != 3 || image.value->bits != 16
  || image.value->data_size != std::uint64_t(width) * static_cast<std::uint32_t>(height) * 6U)
  throw std::runtime_error("Native LibRaw returned an invalid neutral plane.");
 // The independent processed allocation survives recycle; retire decoder
 // scratch before allocating the additional owned RGBA delivery plane.
 decoder.recycle();
 Result result; result.format = Format::rgba16le; result.width = static_cast<std::uint32_t>(width);
 result.height = static_cast<std::uint32_t>(height); result.channels = 4; result.bits = 16; result.raw_flip = flip;
 const auto pixels = std::size_t(result.width) * result.height; result.bytes.resize(pixels * 8U);
 for (std::size_t pixel = 0; pixel < pixels; ++pixel) {
  for (std::size_t channel = 0; channel < 3; ++channel) {
   std::uint16_t word = 0; std::memcpy(&word, image.value->data + (pixel * 3 + channel) * 2, sizeof(word));
   word_le(result.bytes, (pixel * 4 + channel) * 2, word);
  }
  word_le(result.bytes, (pixel * 4 + 3) * 2, 65535);
 }
 return result;
}
void jpeg_geometry(const std::uint8_t* bytes, std::size_t length, Result& result) {
 if (length < 4 || bytes[0] != 0xff || bytes[1] != 0xd8) throw std::runtime_error("Native embedded JPEG header is invalid.");
 std::size_t at = 2;
 while (at + 4 <= length) {
  if (bytes[at++] != 0xff) break;
  while (at < length && bytes[at] == 0xff) ++at;
  if (at >= length) break;
  const auto marker = bytes[at++];
  if (marker == 0xd9 || marker == 0xda) break;
  if (marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
  if (at + 2 > length) break;
  const auto size = (std::uint32_t(bytes[at]) << 8U) | bytes[at + 1];
  if (size < 2 || size > length - at) break;
  if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
   || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
   if (size < 8) break;
   result.bits = bytes[at + 2]; result.height = (std::uint32_t(bytes[at + 3]) << 8U) | bytes[at + 4];
   result.width = (std::uint32_t(bytes[at + 5]) << 8U) | bytes[at + 6]; result.channels = bytes[at + 7];
   if (!dimensions(result.width, result.height) || result.bits != 8 || (result.channels != 1 && result.channels != 3)
    || size != 8U + 3U * result.channels) break;
   return;
  }
  at += size;
 }
 throw std::range_error("Native embedded JPEG geometry is unsupported or malformed.");
}
// LibRaw adds an APP1 block only when the camera JPEG has no Exif. Its
// default DateTime uses process-local time; this fixed engine owns UTC instead.
// Parse the actual generated TIFF rather than depending on a native struct ABI.
void synthesized_utc_date(libraw_processed_image_t& image, std::time_t timestamp) {
 const auto* input = image.data; const auto length = std::size_t(image.data_size);
 if (image.type != LIBRAW_IMAGE_JPEG || length < 20 || input[0] != 0xff || input[1] != 0xd8
  || input[2] != 0xff || input[3] != 0xe1 || std::memcmp(input + 6, "Exif\0\0", 6))
  throw std::runtime_error("Native synthesized JPEG Exif header is invalid.");
 const auto segment_length = (std::size_t(input[4]) << 8U) | input[5];
 if (segment_length < 16 || segment_length > length - 4U) throw std::range_error("Native synthesized Exif segment is invalid.");
 const auto tiff_length = segment_length - 8U; const auto* tiff = input + 12;
 const bool little = tiff[0] == 'I' && tiff[1] == 'I';
 if (!little && !(tiff[0] == 'M' && tiff[1] == 'M')) throw std::range_error("Native synthesized TIFF order is invalid.");
 const auto u16 = [tiff, little](std::size_t at) -> std::uint16_t {
  return little ? std::uint16_t(tiff[at] | (std::uint16_t(tiff[at + 1]) << 8U))
   : std::uint16_t((std::uint16_t(tiff[at]) << 8U) | tiff[at + 1]);
 };
 const auto u32 = [tiff, little](std::size_t at) -> std::uint32_t {
  std::uint32_t value = 0;
  for (unsigned index = 0; index < 4; ++index) value |= std::uint32_t(tiff[at + index]) << ((little ? index : 3U - index) * 8U);
  return value;
 };
 if (u16(2) != 42) throw std::range_error("Native synthesized TIFF identity is invalid.");
 const auto ifd = std::size_t(u32(4));
 if (ifd < 8 || ifd > tiff_length - 2U) throw std::range_error("Native synthesized TIFF directory is invalid.");
 const auto count = std::size_t(u16(ifd));
 if (!count || count > 23 || 2U + count * 12U + 4U > tiff_length - ifd)
  throw std::range_error("Native synthesized TIFF entries exceed their segment.");
 std::size_t date = 0;
 for (std::size_t index = 0; index < count; ++index) {
  const auto at = ifd + 2U + index * 12U;
  if (u16(at) != 306) continue;
  if (date || u16(at + 2U) != 2 || u32(at + 4U) != 20)
   throw std::range_error("Native synthesized TIFF DateTime tag is invalid.");
  date = std::size_t(u32(at + 8U));
  if (date < 8 || date > tiff_length - 20U) throw std::range_error("Native synthesized TIFF DateTime exceeds its segment.");
 }
 if (!date) throw std::range_error("Native synthesized TIFF has no DateTime tag.");
 std::tm utc{};
#ifdef _WIN32
 if (gmtime_s(&utc, &timestamp) != 0) throw std::range_error("Native thumbnail timestamp is unsupported.");
#else
 if (!gmtime_r(&timestamp, &utc)) throw std::range_error("Native thumbnail timestamp is unsupported.");
#endif
 const auto year = static_cast<long long>(utc.tm_year) + 1900;
 if (year < 0 || year > 9999 || utc.tm_mon < 0 || utc.tm_mon > 11 || utc.tm_mday < 1 || utc.tm_mday > 31
  || utc.tm_hour < 0 || utc.tm_hour > 23 || utc.tm_min < 0 || utc.tm_min > 59 || utc.tm_sec < 0 || utc.tm_sec > 60)
  throw std::range_error("Native thumbnail UTC calendar is unsupported.");
 char text[20];
 if (std::snprintf(text, sizeof(text), "%04d:%02d:%02d %02d:%02d:%02d", static_cast<int>(year), utc.tm_mon + 1,
  utc.tm_mday, utc.tm_hour, utc.tm_min, utc.tm_sec) != 19) throw std::range_error("Native thumbnail UTC formatting failed.");
 std::memcpy(image.data + 12U + date, text, sizeof(text));
}

Result embedded(LibRaw& decoder, std::uint32_t flip) {
 const auto& header = decoder.imgdata.thumbnail;
 if (header.tlength > maximum_embedded_bytes || (header.twidth && header.theight && !dimensions(header.twidth, header.theight)))
  throw std::range_error("Native embedded preview exceeds its fixed bound.");
 Result result; result.raw_flip = flip;
 const int unpacked = decoder.unpack_thumb();
 if (unpacked == -5 || unpacked == -6) return result;
 require_status(unpacked, "embedded unpack");
 if (decoder.imgdata.thumbnail.tlength > maximum_embedded_bytes) throw std::range_error("Native embedded preview exceeds its payload bound.");
 const auto& thumbnail = decoder.imgdata.thumbnail;
 const bool synthesized = thumbnail.tformat == LIBRAW_THUMBNAIL_JPEG && thumbnail.thumb && thumbnail.tlength >= 11
  && std::memcmp(thumbnail.thumb + 6, "Exif\0", 5) != 0;
 const std::time_t timestamp = decoder.imgdata.other.timestamp;
 int error = 0; Image image; image.value = decoder.dcraw_make_mem_thumb(&error);
 if (error == -5 || error == -6) return result;
 require_status(error, "embedded image");
 if (!image.value || !image.value->data_size || image.value->data_size > maximum_embedded_bytes)
  throw std::range_error("Native embedded preview has an invalid payload.");
 if (synthesized) synthesized_utc_date(*image.value, timestamp);
 decoder.recycle();
 if (image.value->type == LIBRAW_IMAGE_JPEG) {
  result.format = Format::jpeg; jpeg_geometry(image.value->data, image.value->data_size, result);
  result.bytes.assign(image.value->data, image.value->data + image.value->data_size);
 } else if (image.value->type == LIBRAW_IMAGE_BITMAP) {
  result.width = image.value->width; result.height = image.value->height; result.channels = image.value->colors; result.bits = image.value->bits;
  if (!dimensions(result.width, result.height) || (result.channels != 1 && result.channels != 3) || (result.bits != 8 && result.bits != 16)
   || image.value->data_size != std::uint64_t(result.width) * result.height * result.channels * (result.bits / 8U))
   throw std::range_error("Native embedded bitmap geometry is invalid.");
  result.format = result.bits == 8 ? Format::bitmap8 : Format::bitmap16le;
  result.bytes.resize(image.value->data_size);
  if (result.bits == 8) std::copy_n(image.value->data, result.bytes.size(), result.bytes.data());
  else for (std::size_t offset = 0; offset < result.bytes.size(); offset += 2) {
   std::uint16_t word = 0; std::memcpy(&word, image.value->data + offset, 2); word_le(result.bytes, offset, word);
  }
 } else throw std::range_error("Native embedded preview representation is unsupported.");
 return result;
}
} // namespace

Result::Result(Result&& other) noexcept { *this = std::move(other); }
Result& Result::operator=(Result&& other) noexcept {
 if (this != &other) {
  wipe(); format = std::exchange(other.format, Format::none); width = std::exchange(other.width, 0); height = std::exchange(other.height, 0);
  channels = std::exchange(other.channels, 0); bits = std::exchange(other.bits, 0); raw_flip = std::exchange(other.raw_flip, 0);
  exposure_scale = std::exchange(other.exposure_scale, 1); bytes.swap(other.bytes);
 }
 return *this;
}
Result::~Result() { wipe(); }
void Result::wipe() noexcept {
 detail::wipe_bytes(bytes.data(), bytes.size()); std::vector<std::uint8_t>().swap(bytes);
 format = Format::none; width = height = channels = bits = raw_flip = 0; exposure_scale = 1;
}
Result decode(Mode mode, const std::uint8_t* input, std::size_t byte_length) {
 if (mode != Mode::neutral && mode != Mode::linear_headroom && mode != Mode::highlight_recovery && mode != Mode::embedded)
  throw std::range_error("Native RAW mode is unsupported.");
 if (!input || !byte_length || byte_length > maximum_input_bytes) throw std::range_error("Native RAW encoded input exceeds its fixed bound.");
 try {
  Input captured(input, byte_length);
  if (mode == Mode::linear_headroom || mode == Mode::highlight_recovery) return detail::decode_recovery(mode, captured.bytes.data(), captured.bytes.size());
  LibRaw decoder; fixed_parameters(decoder); require_status(decoder.open_buffer(captured.bytes.data(), captured.bytes.size()), "open");
  source_bounds(decoder, captured.bytes.size()); const int flip = decoder.imgdata.sizes.flip;
  if (flip < 0 || flip > 7) throw std::range_error("Native RAW orientation is invalid.");
  return mode == Mode::neutral ? neutral(decoder, captured.bytes.size(), static_cast<std::uint32_t>(flip))
   : embedded(decoder, static_cast<std::uint32_t>(flip));
 } catch (const std::exception&) { throw; }
 catch (...) { throw std::runtime_error("Native LibRaw raised an unsupported native error."); }
}

} // namespace lightscaper::raw::current_v1
