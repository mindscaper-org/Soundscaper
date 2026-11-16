/* SPDX-License-Identifier: AGPL-3.0-only */
#include "processor.h"
#include <cmath>

namespace soundscaper::effects {
namespace {
constexpr uint32_t crossfadeFrames = 2048;
float decibels(float normalized) { return -60.0f + normalized * 72.0f; }
}

class PreparedEngine {
public:
	PreparedEngine(Kind kindValue, const Impulse &ir, double rate, uint32_t maximumFrames,
		float mix, float preDelay, float gainValue) : kind(kindValue), hasImpulse(ir.samples.getNumSamples() > 0)
	{
		juce::dsp::ProcessSpec spec{rate, maximumFrames, 2};
		gain.setGainDecibels(decibels(gainValue));
		gain.prepare(spec);
		gain.setRampDurationSeconds(0.01);
		if (kind == Kind::gain) return;
		if (hasImpulse) {
			convolution = std::make_unique<juce::dsp::Convolution>(juce::dsp::Convolution::NonUniform{256});
			juce::AudioBuffer<float> copy; copy.makeCopyOf(ir.samples);
			convolution->loadImpulseResponse(std::move(copy), ir.sampleRate,
				juce::dsp::Convolution::Stereo::yes, juce::dsp::Convolution::Trim::no,
				juce::dsp::Convolution::Normalise::no);
		}
		// prepare() installs the initial IR synchronously, including offline restores.
		if (convolution) convolution->prepare(spec);
		dry.setSize(2, static_cast<int>(maximumFrames));
		delay.setMaximumDelayInSamples(static_cast<int>(std::ceil(rate)) + 1);
		delay.prepare(spec);
		wet.reset(rate, 0.01); wet.setCurrentAndTargetValue(mix);
		predelay.reset(rate, 0.01); predelay.setCurrentAndTargetValue(preDelay * static_cast<float>(rate));
		sampleRate = static_cast<float>(rate);
	}

	void process(juce::AudioBuffer<float> &audio, float mix, float preDelay, float gainValue)
	{
		juce::dsp::AudioBlock<float> block(audio);
		if (kind == Kind::convolution && hasImpulse) {
			const int frames = audio.getNumSamples();
			for (int channel = 0; channel < 2; ++channel) dry.copyFrom(channel, 0, audio, channel, 0, frames);
			convolution->process(juce::dsp::ProcessContextReplacing<float>(block));
			wet.setTargetValue(mix);
			predelay.setTargetValue(preDelay * sampleRate);
			for (int frame = 0; frame < frames; ++frame) {
				const float amount = wet.getNextValue();
				const float delayFrames = predelay.getNextValue();
				for (int channel = 0; channel < 2; ++channel) {
					delay.pushSample(channel, audio.getSample(channel, frame));
					const float delayed = delay.popSample(channel, delayFrames);
					audio.setSample(channel, frame, dry.getSample(channel, frame) * (1 - amount) + delayed * amount);
				}
			}
		}
		gain.setGainDecibels(decibels(gainValue));
		gain.process(juce::dsp::ProcessContextReplacing<float>(block));
	}
	PreparedEngine *nextRetired = nullptr;
	void reset() { if (convolution) convolution->reset(); delay.reset(); gain.reset(); }

private:
	Kind kind;
	bool hasImpulse;
	float sampleRate = 48000;
	juce::dsp::Gain<float> gain;
	std::unique_ptr<juce::dsp::Convolution> convolution;
	juce::dsp::DelayLine<float> delay;
	juce::SmoothedValue<float> wet, predelay;
	juce::AudioBuffer<float> dry;
};

Processor::Processor(Kind kindValue) : kind(kindValue)
{
	parameters[0].store(kind == Kind::gain ? 60.0f / 72.0f : 0.25f);
	parameters[1].store(0);
	parameters[2].store(60.0f / 72.0f);
}
Processor::~Processor() { release(); }

bool Processor::setParameter(uint32_t index, double value)
{
	if (index >= parameterCount() || !std::isfinite(value) || value < 0 || value > 1) return false;
	parameters[index].store(static_cast<float>(value), std::memory_order_relaxed);
	return true;
}
double Processor::parameter(uint32_t index) const
{
	return index < parameterCount() ? parameters[index].load(std::memory_order_relaxed) : 0;
}

bool Processor::prepare(double sampleRate, uint32_t maximumFrames)
{
	std::lock_guard lock(controlMutex);
	if (!std::isfinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000
		|| maximumFrames == 0 || maximumFrames > 65536) return false;
	release(); rate = sampleRate; ceiling = maximumFrames;
	previousOutput.setSize(2, static_cast<int>(ceiling));
	return publish(impulse);
}

bool Processor::publish(const Impulse &ir)
{
	collectRetired();
	if (rate == 0) return true;
	try {
		auto engine = std::make_unique<PreparedEngine>(kind, ir, rate, ceiling,
			static_cast<float>(parameter(0)), static_cast<float>(parameter(1)),
			static_cast<float>(parameter(kind == Kind::gain ? 0 : 2)));
		delete pending.exchange(engine.release(), std::memory_order_acq_rel);
		return true;
	} catch (...) { return false; }
}

void Processor::release()
{
	std::lock_guard lock(controlMutex);
	delete pending.exchange(nullptr); delete current; delete fading;
	current = nullptr; fading = nullptr;
	collectRetired(); rate = 0; ceiling = 0; processed = false;
}

void Processor::retire(PreparedEngine *engine)
{
	if (engine == nullptr) return;
	auto *head = retired.load(std::memory_order_relaxed);
	do { engine->nextRetired = head; }
	while (!retired.compare_exchange_weak(head, engine, std::memory_order_release, std::memory_order_relaxed));
}
void Processor::collectRetired()
{
	auto *engine = retired.exchange(nullptr, std::memory_order_acquire);
	while (engine != nullptr) { auto *next = engine->nextRetired; delete engine; engine = next; }
}

bool Processor::reset()
{
	if (rate == 0) return false;
	if (current != nullptr) current->reset();
	retire(fading); fading = nullptr; processed = false;
	return true;
}

bool Processor::process(juce::AudioBuffer<float> &audio)
{
	if (audio.getNumChannels() != 2 || audio.getNumSamples() < 1
		|| static_cast<uint32_t>(audio.getNumSamples()) > ceiling) return false;
	if (auto *replacement = pending.exchange(nullptr, std::memory_order_acquire)) {
		retire(fading); fading = processed ? current : nullptr;
		if (!processed) retire(current);
		current = replacement; fadePosition = 0;
	}
	if (current == nullptr) return false;
	juce::ScopedNoDenormals noDenormals;
	const auto mix = static_cast<float>(parameter(0));
	const auto preDelay = static_cast<float>(parameter(1));
	const auto gainValue = static_cast<float>(parameter(kind == Kind::gain ? 0 : 2));
	if (fading != nullptr) {
		previousOutput.setSize(2, audio.getNumSamples(), false, false, true);
		for (int channel = 0; channel < 2; ++channel)
			previousOutput.copyFrom(channel, 0, audio, channel, 0, audio.getNumSamples());
		fading->process(previousOutput, mix, preDelay, gainValue);
	}
	current->process(audio, mix, preDelay, gainValue);
	if (fading != nullptr) {
		for (int frame = 0; frame < audio.getNumSamples(); ++frame) {
			const float amount = std::min(1.0f, static_cast<float>(++fadePosition) / crossfadeFrames);
			for (int channel = 0; channel < 2; ++channel)
				audio.setSample(channel, frame, audio.getSample(channel, frame) * amount
					+ previousOutput.getSample(channel, frame) * (1 - amount));
		}
		if (fadePosition >= crossfadeFrames) { retire(fading); fading = nullptr; }
	}
	processed = true;
	return true;
}
}
