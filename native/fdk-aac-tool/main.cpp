// SPDX-License-Identifier: MIT

#include "aacdecoder_lib.h"
#include "aacenc_lib.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>

namespace {
constexpr int packetFrames = 1024;
constexpr int maxChannels = 6;
constexpr int maxAdtsBytes = 8191;
constexpr int unsupported = 3;
constexpr int failed = 2;

struct File {
    FILE *handle;
    ~File() { if (handle) std::fclose(handle); }
    bool finish() {
        FILE *output = handle;
        handle = nullptr;
        return std::fclose(output) == 0;
    }
};

struct Encoder {
    HANDLE_AACENCODER handle = nullptr;
    ~Encoder() { if (handle) aacEncClose(&handle); }
};

struct Decoder {
    HANDLE_AACDECODER handle = aacDecoder_Open(TT_MP4_ADTS, 1);
    ~Decoder() { if (handle) aacDecoder_Close(handle); }
};

bool writeBounded(FILE *file, const void *data, size_t size, uint64_t &remaining) {
    if (size > remaining || std::fwrite(data, 1, size, file) != size) return false;
    remaining -= size;
    return true;
}

int encode(FILE *input, FILE *output, int rate, int channels, int bitrate, uint64_t remaining) {
    constexpr CHANNEL_MODE modes[] = { MODE_INVALID, MODE_1, MODE_2, MODE_1_2,
        MODE_1_2_1, MODE_1_2_2, MODE_1_2_2_1 };
    Encoder encoder;
    if (aacEncOpen(&encoder.handle, 0, channels) != AACENC_OK) return failed;
    const auto configure = [&](AACENC_PARAM setting, UINT value) {
        return aacEncoder_SetParam(encoder.handle, setting, value) == AACENC_OK;
    };
    if (!configure(AACENC_AOT, AOT_AAC_LC) || !configure(AACENC_SAMPLERATE, rate)
        || !configure(AACENC_CHANNELMODE, modes[channels]) || !configure(AACENC_CHANNELORDER, 1)
        || !configure(AACENC_BITRATE, bitrate) || !configure(AACENC_TRANSMUX, TT_MP4_ADTS)
        || !configure(AACENC_AFTERBURNER, 1)
        || aacEncEncode(encoder.handle, nullptr, nullptr, nullptr, nullptr) != AACENC_OK) return unsupported;

    AACENC_InfoStruct info{};
    if (aacEncInfo(encoder.handle, &info) != AACENC_OK || info.frameLength != packetFrames) return failed;
    std::array<float, packetFrames * maxChannels> samples{};
    std::array<INT_PCM, packetFrames * maxChannels> pcm{};
    std::array<unsigned char, maxAdtsBytes> packet{};
    void *in = pcm.data();
    void *out = packet.data();
    INT inId = IN_AUDIO_DATA, outId = OUT_BITSTREAM_DATA;
    INT inSize = sizeof(pcm), outSize = packet.size(), inElement = sizeof(INT_PCM), outElement = 1;
    AACENC_BufDesc source{1, &in, &inId, &inSize, &inElement};
    AACENC_BufDesc destination{1, &out, &outId, &outSize, &outElement};
    for (;;) {
        const size_t bytes = std::fread(samples.data(), 1, packetFrames * channels * sizeof(float), input);
        if (std::ferror(input) || bytes % (channels * sizeof(float)) != 0) return failed;
        const size_t count = bytes / sizeof(float);
        std::transform(samples.begin(), samples.begin() + count, pcm.begin(), [](float sample) {
            if (!std::isfinite(sample)) return INT_PCM{0};
            return static_cast<INT_PCM>(std::clamp(sample * 32768.0f, -32768.0f, 32767.0f));
        });
        AACENC_InArgs arguments{};
        arguments.numInSamples = count == 0 ? -1 : static_cast<int>(count);
        AACENC_OutArgs result{};
        const AACENC_ERROR status = aacEncEncode(encoder.handle, &source, &destination, &arguments, &result);
        if (status == AACENC_ENCODE_EOF) break;
        if (status != AACENC_OK || (count != 0 && result.numInSamples != arguments.numInSamples)
            || result.numOutBytes < 0 || result.numOutBytes > outSize
            || !writeBounded(output, packet.data(), result.numOutBytes, remaining)) return failed;
    }
    std::printf("%u\n", info.nDelay);
    return 0;
}

int decode(FILE *input, FILE *output, int rate, int channels, uint64_t remaining) {
    Decoder decoder;
    if (!decoder.handle || aacDecoder_SetParam(decoder.handle, AAC_PCM_LIMITER_ENABLE, 0) != AAC_DEC_OK
        || aacDecoder_SetParam(decoder.handle, AAC_PCM_OUTPUT_CHANNEL_MAPPING, 1) != AAC_DEC_OK) return failed;
    std::array<UCHAR, maxAdtsBytes> packet{};
    std::array<INT_PCM, packetFrames * maxChannels> pcm{};
    std::array<float, packetFrames * maxChannels> samples{};
    for (;;) {
        auto count = std::fread(packet.data(), 1, 7, input);
        if (count == 0 && std::feof(input)) return 0;
        if (count != 7 || packet[0] != 0xff || (packet[1] & 0xf6) != 0xf0
            || (packet[2] >> 6) != 1 || (packet[6] & 3) != 0) return unsupported;
        UINT size = ((packet[3] & 3u) << 11) | (packet[4] << 3) | (packet[5] >> 5);
        if (size < 7 || std::fread(packet.data() + 7, 1, size - 7, input) != size - 7) return unsupported;
        UCHAR *data = packet.data();
        UINT remainingInput = size;
        if (aacDecoder_Fill(decoder.handle, &data, &size, &remainingInput) != AAC_DEC_OK
            || remainingInput != 0
            || aacDecoder_DecodeFrame(decoder.handle, pcm.data(), pcm.size(), 0) != AAC_DEC_OK) return unsupported;
        const CStreamInfo *geometry = aacDecoder_GetStreamInfo(decoder.handle);
        if (!geometry || geometry->aot != AOT_AAC_LC || geometry->sampleRate != rate
            || geometry->numChannels != channels || geometry->frameSize != packetFrames
            || geometry->outputDelay != 0 || geometry->extAot == AOT_SBR || geometry->extAot == AOT_PS) return unsupported;
        const auto sampleCount = packetFrames * channels;
        std::transform(pcm.begin(), pcm.begin() + sampleCount, samples.begin(), [](INT_PCM sample) {
            return sample / 32768.0f;
        });
        if (!writeBounded(output, samples.data(), sampleCount * sizeof(float), remaining)) return failed;
    }
}

uint64_t positive(const char *text, uint64_t maximum) {
    if (*text == '\0' || std::strspn(text, "0123456789") != std::strlen(text)) return 0;
    const auto number = std::strtoull(text, nullptr, 10);
    return number <= maximum ? number : 0;
}
}

int main(int argc, char **argv) {
    static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
    static_assert(sizeof(INT_PCM) == 2);
    const bool encoding = argc == 8 && std::strcmp(argv[1], "encode") == 0;
    const bool decoding = argc == 7 && std::strcmp(argv[1], "decode") == 0;
    if (!encoding && !decoding) {
        std::fputs("Usage: fdk-aac-tool encode rate channels bitrate max-bytes pcm-f32le adts\n"
                   "       fdk-aac-tool decode rate channels max-bytes adts pcm-f32le\n", stderr);
        return failed;
    }
    const auto rate = positive(argv[2], 96000), channels = positive(argv[3], maxChannels);
    const auto bitrate = encoding ? positive(argv[4], 320000) : 1;
    const auto limit = positive(argv[argc - 3], UINT64_C(1000000000));
    if (rate < 8000 || channels == 0 || bitrate == 0 || limit == 0) return failed;
    File input{std::fopen(argv[argc - 2], "rb")};
    if (!input.handle) return failed;
    File output{std::fopen(argv[argc - 1], "wb")};
    if (!output.handle) return failed;
    const int result = encoding ? encode(input.handle, output.handle, rate, channels, bitrate, limit)
                                : decode(input.handle, output.handle, rate, channels, limit);
    return output.finish() ? result : failed;
}
