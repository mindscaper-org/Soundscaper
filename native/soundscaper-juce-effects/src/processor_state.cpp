/* SPDX-License-Identifier: AGPL-3.0-only */
#include "processor.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>

namespace soundscaper::effects {
namespace {
constexpr int magic = 0x534a4531; // SJE1, little endian, version 1
bool validImpulse(const juce::AudioBuffer<float> &samples, double rate)
{
	if ((samples.getNumChannels() != 1 && samples.getNumChannels() != 2)
		|| samples.getNumSamples() < 1 || !std::isfinite(rate) || rate < 8000 || rate > 192000
		|| static_cast<size_t>(samples.getNumChannels()) * samples.getNumSamples() * sizeof(float)
			> maximumImpulseBytes) return false;
	for (int channel = 0; channel < samples.getNumChannels(); ++channel)
		for (int frame = 0; frame < samples.getNumSamples(); ++frame)
			if (!std::isfinite(samples.getSample(channel, frame))) return false;
	return true;
}
}

bool Processor::setImpulse(const juce::AudioBuffer<float> &samples, double sampleRate, const juce::String &name)
{
	std::lock_guard lock(controlMutex);
	if (kind != Kind::convolution || name.getNumBytesAsUTF8() > 1024 || !validImpulse(samples, sampleRate)) return false;
	Impulse next;
	next.samples.makeCopyOf(samples); next.sampleRate = sampleRate; next.name = name;
	if (!publish(next)) return false;
	impulse = std::move(next);
	impulseDuration.store(impulse.samples.getNumSamples() / impulse.sampleRate);
	return true;
}

bool Processor::loadImpulseFile(const juce::File &file, juce::String &error)
{
	if (!file.existsAsFile() || file.getSize() > 64 * 1024 * 1024) {
		error = "Choose a WAV or AIFF impulse response smaller than 64 MiB."; return false;
	}
	juce::AudioFormatManager formats;
	formats.registerFormat(new juce::WavAudioFormat(), true);
	formats.registerFormat(new juce::AiffAudioFormat(), false);
	std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(file));
	if (reader == nullptr || reader->numChannels < 1 || reader->numChannels > 2
		|| reader->lengthInSamples < 1
		|| static_cast<uint64_t>(reader->lengthInSamples) > maximumImpulseBytes / (reader->numChannels * sizeof(float))) {
		error = "Choose a mono or stereo WAV/AIFF impulse response with at most 8 MiB of decoded audio."; return false;
	}
	juce::AudioBuffer<float> samples(static_cast<int>(reader->numChannels), static_cast<int>(reader->lengthInSamples));
	if (!reader->read(&samples, 0, samples.getNumSamples(), 0, true, true)
		|| !setImpulse(samples, reader->sampleRate, file.getFileName())) {
		error = "The impulse response could not be prepared."; return false;
	}
	error.clear(); return true;
}

juce::MemoryBlock Processor::saveState() const
{
	std::lock_guard lock(controlMutex);
	juce::MemoryOutputStream out;
	out.writeInt(magic); out.writeInt(static_cast<int>(kind));
	for (uint32_t index = 0; index < parameterCount(); ++index) out.writeFloat(static_cast<float>(parameter(index)));
	out.writeDouble(impulse.sampleRate);
	out.writeInt(impulse.samples.getNumChannels()); out.writeInt(impulse.samples.getNumSamples());
	const auto name = impulse.name.toUTF8();
	out.writeInt(static_cast<int>(impulse.name.getNumBytesAsUTF8()));
	out.write(name.getAddress(), impulse.name.getNumBytesAsUTF8());
	for (int channel = 0; channel < impulse.samples.getNumChannels(); ++channel)
		for (int frame = 0; frame < impulse.samples.getNumSamples(); ++frame)
			out.writeFloat(impulse.samples.getSample(channel, frame));
	return out.getMemoryBlock();
}

bool Processor::loadState(const void *bytes, size_t length)
{
	std::lock_guard lock(controlMutex);
	const size_t minimum = 28 + parameterCount() * sizeof(float);
	if (bytes == nullptr || length < minimum || length > maximumImpulseBytes + 2048) return false;
	juce::MemoryInputStream in(bytes, length, false);
	if (in.readInt() != magic || in.readInt() != static_cast<int>(kind)) return false;
	ParameterValues values{};
	for (uint32_t index = 0; index < parameterCount(); ++index) {
		values[index] = in.readFloat();
		if (!std::isfinite(values[index]) || values[index] < 0 || values[index] > 1) return false;
	}
	Impulse next;
	next.sampleRate = in.readDouble();
	const int channels = in.readInt(), frames = in.readInt(), nameLength = in.readInt();
	if (!std::isfinite(next.sampleRate) || next.sampleRate < 8000 || next.sampleRate > 192000
		|| frames < 0 || channels < 0 || channels > 2 || nameLength < 0 || nameLength > 1024
		|| (frames == 0 ? channels != 0 : channels == 0)
		|| (kind != Kind::convolution && frames != 0)) return false;
	const auto sampleBytes = static_cast<uint64_t>(channels) * static_cast<uint64_t>(frames) * sizeof(float);
	if (sampleBytes > maximumImpulseBytes
		|| static_cast<uint64_t>(in.getNumBytesRemaining()) != sampleBytes + static_cast<uint64_t>(nameLength)) return false;
	juce::MemoryBlock name(static_cast<size_t>(nameLength));
	if (nameLength > 0 && (in.read(name.getData(), nameLength) != nameLength
		|| !juce::CharPointer_UTF8::isValidString(static_cast<const char *>(name.getData()), nameLength))) return false;
	if (nameLength > 0) next.name = juce::String::fromUTF8(static_cast<const char *>(name.getData()), nameLength);
	if (frames > 0) {
		next.samples.setSize(channels, frames);
		for (int channel = 0; channel < channels; ++channel)
			for (int frame = 0; frame < frames; ++frame) next.samples.setSample(channel, frame, in.readFloat());
		if (!validImpulse(next.samples, next.sampleRate)) return false;
	}
	ParameterValues previous{};
	for (uint32_t index = 0; index < parameterCount(); ++index) {
		previous[index] = static_cast<float>(parameter(index));
		setParameter(index, values[index]);
	}
	if (!publish(next)) {
		for (uint32_t index = 0; index < parameterCount(); ++index) setParameter(index, previous[index]);
		return false;
	}
	impulse = std::move(next);
	impulseDuration.store(impulse.samples.getNumSamples() / impulse.sampleRate);
	return true;
}

double Processor::tailSeconds() const
{
	if (kind == Kind::reverb) return parameter(4) >= 0.5 ? std::numeric_limits<double>::infinity() : 20;
	if (kind == Kind::delay) {
		const auto &spec = effectSpec(kind);
		const double seconds = spec.parameters[0].physical(static_cast<float>(parameter(0))) / 1000;
		const double feedback = spec.parameters[1].physical(static_cast<float>(parameter(1))) / 100;
		return seconds * (feedback > 0 ? std::ceil(std::log(0.001) / std::log(feedback)) : 1);
	}
	if (kind == Kind::firFilter) return rate > 0 ? 64 / rate : 0;
	if (kind != Kind::convolution) return 0;
	const double duration = impulseDuration.load();
	return duration > 0 ? duration + parameter(1) : 0;
}
juce::String Processor::impulseName() const
{
	std::lock_guard lock(controlMutex);
	return impulse.name;
}
}
