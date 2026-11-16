/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <juce_dsp/juce_dsp.h>
#include <array>
#include <atomic>
#include <memory>
#include <mutex>

namespace soundscaper::effects {
enum class Kind : uint32_t { gain = 1, convolution = 2 };
constexpr size_t maximumImpulseBytes = 8 * 1024 * 1024;

struct Impulse {
	juce::AudioBuffer<float> samples;
	double sampleRate = 48000;
	juce::String name;
};

class PreparedEngine;

/** Control methods run on the plug-in main thread; process() owns DSP histories. */
class Processor final {
public:
	explicit Processor(Kind kind);
	~Processor();
	bool prepare(double sampleRate, uint32_t maximumFrames);
	void release();
	bool reset();
	bool process(juce::AudioBuffer<float> &audio);
	bool setParameter(uint32_t index, double normalized);
	double parameter(uint32_t index) const;
	uint32_t parameterCount() const { return kind == Kind::gain ? 1 : 3; }
	bool setImpulse(const juce::AudioBuffer<float> &, double, const juce::String &);
	bool loadImpulseFile(const juce::File &, juce::String &error);
	juce::MemoryBlock saveState() const;
	bool loadState(const void *, size_t);
	juce::String impulseName() const;
	double tailSeconds() const;
	void collectRetired();
	const Kind kind;

private:
	bool publish(const Impulse &);
	void retire(PreparedEngine *);
	std::array<std::atomic<float>, 3> parameters;
	std::atomic<double> impulseDuration{0};
	Impulse impulse;
	double rate = 0;
	uint32_t ceiling = 0;
	std::atomic<PreparedEngine *> pending{nullptr};
	std::atomic<PreparedEngine *> retired{nullptr};
	PreparedEngine *current = nullptr;
	PreparedEngine *fading = nullptr;
	juce::AudioBuffer<float> previousOutput;
	uint32_t fadePosition = 0;
	bool processed = false;
	mutable std::recursive_mutex controlMutex;
};
}
