/* SPDX-License-Identifier: AGPL-3.0-only */
#include <algorithm>
#include <exception>
#include <memory>
#include <string>
#include <vector>
#include "ear/ear.hpp"

namespace {
std::unique_ptr<ear::GainCalculatorDirectSpeakers> direct;
std::unique_ptr<ear::GainCalculatorObjects> objects;
std::vector<std::string> names;
std::vector<float> gains, diffuse;
char label[64] = {}, pack[64] = {};
std::string error;
const char* layouts[] = {"0+2+0", "0+5+0", "2+5+0", "4+5+0", "0+7+0", "4+7+0"};
}

extern "C" {
int ear_initialize(int layout_index) {
  try {
    if (layout_index < 0 || layout_index >= 6) return -1;
    auto layout = ear::getLayout(layouts[layout_index]);
    direct.reset(new ear::GainCalculatorDirectSpeakers(layout));
    objects.reset(new ear::GainCalculatorObjects(layout));
    names = layout.channelNames();
    gains.resize(names.size());
    diffuse.resize(names.size());
    return static_cast<int>(names.size());
  } catch (const std::exception& e) { error = e.what(); return -1; }
}
const char* ear_speaker_name(int index) { return names.at(index).c_str(); }
char* ear_label_pointer() { return label; }
char* ear_pack_pointer() { return pack; }
float* ear_gains_pointer() { return gains.data(); }
const char* ear_error() { return error.c_str(); }
int ear_direct(double azimuth, double elevation, int lfe) {
  try {
    ear::DirectSpeakersTypeMetadata metadata;
    metadata.position = ear::PolarSpeakerPosition(azimuth, elevation, 1.0);
    metadata.speakerLabels = {std::string(label)};
    if (pack[0]) metadata.audioPackFormatID = std::string(pack);
    if (lfe) metadata.channelFrequency.lowPass = 120.0;
    direct->calculate(metadata, gains);
    return 0;
  } catch (const std::exception& e) { error = e.what(); return -1; }
}
int ear_object(double azimuth, double elevation, double distance) {
  try {
    ear::ObjectsTypeMetadata metadata;
    metadata.position = ear::PolarPosition(azimuth, elevation, distance);
    objects->calculate(metadata, gains, diffuse);
    return 0;
  } catch (const std::exception& e) { error = e.what(); return -1; }
}
void ear_close() { direct.reset(); objects.reset(); }
}
