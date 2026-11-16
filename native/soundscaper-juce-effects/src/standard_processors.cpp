/* SPDX-License-Identifier: AGPL-3.0-only */
#include "standard_processors.h"
#include <functional>

namespace soundscaper::effects {
namespace {
template <typename Dsp> class JuceProcessor final : public StandardProcessor {
public:
	using Configure = std::function<void(Dsp &, const ParameterValues &)>;
	JuceProcessor(const juce::dsp::ProcessSpec &spec, const ParameterValues &values, Configure configure)
		: apply(std::move(configure)), previous(values)
	{
		dsp.prepare(spec); apply(dsp, values); dsp.reset();
	}
	void process(juce::AudioBuffer<float> &audio, const ParameterValues &values) override
	{
		if (values != previous) { apply(dsp, values); previous = values; }
		juce::dsp::AudioBlock<float> block(audio);
		dsp.process(juce::dsp::ProcessContextReplacing<float>(block));
	}
	void reset() override { dsp.reset(); }
private:
	Dsp dsp;
	Configure apply;
	ParameterValues previous;
};

class Delay final : public StandardProcessor {
public:
	Delay(const juce::dsp::ProcessSpec &spec, const ParameterValues &values) : rate(static_cast<float>(spec.sampleRate))
	{
		line.setMaximumDelayInSamples(static_cast<int>(std::ceil(spec.sampleRate * 2)) + 1);
		line.prepare(spec);
		time.reset(spec.sampleRate, 0.01); time.setCurrentAndTargetValue(values[0] * rate / 1000);
		feedback.reset(spec.sampleRate, 0.01); feedback.setCurrentAndTargetValue(values[1] / 100);
		mix.reset(spec.sampleRate, 0.01); mix.setCurrentAndTargetValue(values[2] / 100);
	}
	void process(juce::AudioBuffer<float> &audio, const ParameterValues &values) override
	{
		time.setTargetValue(values[0] * rate / 1000);
		feedback.setTargetValue(values[1] / 100); mix.setTargetValue(values[2] / 100);
		for (int frame = 0; frame < audio.getNumSamples(); ++frame) {
			const float samples = time.getNextValue(), gain = feedback.getNextValue(), wet = mix.getNextValue();
			for (int channel = 0; channel < audio.getNumChannels(); ++channel) {
				const float input = audio.getSample(channel, frame);
				const float delayed = line.popSample(channel, samples);
				line.pushSample(channel, input + delayed * gain);
				audio.setSample(channel, frame, input * (1 - wet) + delayed * wet);
			}
		}
	}
	void reset() override
	{
		line.reset(); time.setCurrentAndTargetValue(time.getTargetValue());
		feedback.setCurrentAndTargetValue(feedback.getTargetValue()); mix.setCurrentAndTargetValue(mix.getTargetValue());
	}
private:
	float rate;
	juce::dsp::DelayLine<float> line;
	juce::SmoothedValue<float> time, feedback, mix;
};

class Waveshaper final : public StandardProcessor {
public:
	Waveshaper(const juce::dsp::ProcessSpec &spec, const ParameterValues &values)
	{
		drive.reset(spec.sampleRate, 0.01); drive.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(values[0]));
		mix.reset(spec.sampleRate, 0.01); mix.setCurrentAndTargetValue(values[1] / 100);
	}
	void process(juce::AudioBuffer<float> &audio, const ParameterValues &values) override
	{
		drive.setTargetValue(juce::Decibels::decibelsToGain(values[0])); mix.setTargetValue(values[1] / 100);
		for (int frame = 0; frame < audio.getNumSamples(); ++frame) {
			const float gain = drive.getNextValue(), wet = mix.getNextValue();
			for (int channel = 0; channel < audio.getNumChannels(); ++channel) {
				const float input = audio.getSample(channel, frame);
				audio.setSample(channel, frame, input * (1 - wet) + shape.processSample(input * gain) * wet);
			}
		}
	}
	void reset() override
	{
		drive.setCurrentAndTargetValue(drive.getTargetValue()); mix.setCurrentAndTargetValue(mix.getTargetValue());
	}
private:
	juce::dsp::WaveShaper<float> shape{[](float value) { return std::tanh(value); }};
	juce::SmoothedValue<float> drive, mix;
};
}

std::unique_ptr<StandardProcessor> makeStandardProcessor(Kind kind, const juce::dsp::ProcessSpec &spec, const ParameterValues &values)
{
	switch (kind) {
	case Kind::reverb:
		return std::make_unique<JuceProcessor<juce::dsp::Reverb>>(spec, values, [](auto &dsp, const auto &v) {
			juce::Reverb::Parameters p;
			p.roomSize = v[0] / 100; p.damping = v[1] / 100; p.wetLevel = v[2] / 100;
			p.dryLevel = 1 - p.wetLevel; p.width = v[3] / 100; p.freezeMode = v[4]; dsp.setParameters(p);
		});
	case Kind::chorus:
		return std::make_unique<JuceProcessor<juce::dsp::Chorus<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setRate(v[0]); dsp.setDepth(v[1] / 100); dsp.setCentreDelay(v[2]);
			dsp.setFeedback(v[3] / 100); dsp.setMix(v[4] / 100);
		});
	case Kind::phaser:
		return std::make_unique<JuceProcessor<juce::dsp::Phaser<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setRate(v[0]); dsp.setDepth(v[1] / 100); dsp.setCentreFrequency(v[2]);
			dsp.setFeedback(v[3] / 100); dsp.setMix(v[4] / 100);
		});
	case Kind::compressor:
		return std::make_unique<JuceProcessor<juce::dsp::Compressor<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setThreshold(v[0]); dsp.setRatio(v[1]); dsp.setAttack(v[2]); dsp.setRelease(v[3]);
		});
	case Kind::noiseGate:
		return std::make_unique<JuceProcessor<juce::dsp::NoiseGate<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setThreshold(v[0]); dsp.setRatio(v[1]); dsp.setAttack(v[2]); dsp.setRelease(v[3]);
		});
	case Kind::limiter:
		return std::make_unique<JuceProcessor<juce::dsp::Limiter<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setThreshold(v[0]); dsp.setRelease(v[1]);
		});
	case Kind::ladderFilter:
		return std::make_unique<JuceProcessor<juce::dsp::LadderFilter<float>>>(spec, values, [rate = spec.sampleRate](auto &dsp, const auto &v) {
			dsp.setMode(static_cast<juce::dsp::LadderFilterMode>(static_cast<int>(std::round(v[0]))));
			dsp.setCutoffFrequencyHz(std::min(v[1], static_cast<float>(rate * 0.45)));
			dsp.setResonance(v[2] / 100); dsp.setDrive(v[3]);
		});
	case Kind::panner:
		return std::make_unique<JuceProcessor<juce::dsp::Panner<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setRule(static_cast<juce::dsp::PannerRule>(static_cast<int>(std::round(v[1])))); dsp.setPan(v[0]);
		});
	case Kind::bias:
		return std::make_unique<JuceProcessor<juce::dsp::Bias<float>>>(spec, values, [](auto &dsp, const auto &v) {
			dsp.setBias(v[0]); dsp.setRampDurationSeconds(0.01);
		});
	case Kind::delay: return std::make_unique<Delay>(spec, values);
	case Kind::waveshaper: return std::make_unique<Waveshaper>(spec, values);
	default: return makeFilterProcessor(kind, spec, values);
	}
}
}
