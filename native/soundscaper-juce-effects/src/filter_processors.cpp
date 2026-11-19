/* SPDX-License-Identifier: AGPL-3.0-only */
#include "standard_processors.h"
#include <functional>

namespace soundscaper::effects {
namespace {
template <typename Dsp> class TptFilter final : public StandardProcessor {
public:
	TptFilter(const juce::dsp::ProcessSpec &spec, const ParameterValues &values)
		: maximumCutoff(static_cast<float>(spec.sampleRate * 0.45))
	{
		dsp.prepare(spec); configure(values); dsp.reset();
	}
	void process(juce::AudioBuffer<float> &audio, const ParameterValues &values) override
	{
		configure(values);
		juce::dsp::AudioBlock<float> block(audio); dsp.process(juce::dsp::ProcessContextReplacing<float>(block));
	}
	void reset() override { dsp.reset(); }
private:
	void configure(const ParameterValues &v)
	{
		dsp.setType(static_cast<typename Dsp::Type>(static_cast<int>(std::round(v[0]))));
		dsp.setCutoffFrequency(std::min(v[1], maximumCutoff));
		if constexpr (requires { dsp.setResonance(v[2]); }) dsp.setResonance(v[2]);
	}
	float maximumCutoff;
	Dsp dsp;
};

class IirFilter final : public StandardProcessor {
public:
	IirFilter(const juce::dsp::ProcessSpec &spec, const ParameterValues &values) : rate(spec.sampleRate)
	{
		configure(values); dsp.prepare(spec);
	}
	void process(juce::AudioBuffer<float> &audio, const ParameterValues &values) override
	{
		if (values != previous) configure(values);
		juce::dsp::AudioBlock<float> block(audio); dsp.process(juce::dsp::ProcessContextReplacing<float>(block));
	}
	void reset() override { dsp.reset(); }
private:
	void configure(const ParameterValues &v)
	{
		const float cutoff = std::min(v[1], static_cast<float>(rate * 0.45));
		using Coefficients = juce::dsp::IIR::ArrayCoefficients<float>;
		const auto mode = static_cast<int>(std::round(v[0]));
		const auto coefficients = mode == 0 ? Coefficients::makeLowPass(rate, cutoff, v[2])
			: mode == 1 ? Coefficients::makeHighPass(rate, cutoff, v[2]) : Coefficients::makeBandPass(rate, cutoff, v[2]);
		*dsp.state = coefficients; previous = v;
	}
	double rate;
	ParameterValues previous{};
	juce::dsp::ProcessorDuplicator<juce::dsp::IIR::Filter<float>, juce::dsp::IIR::Coefficients<float>> dsp;
};

class FirFilter final : public StandardProcessor {
public:
	FirFilter(const juce::dsp::ProcessSpec &spec, const ParameterValues &values) : rate(spec.sampleRate)
	{
		std::array<float, 65> taps{}; taps[32] = 1;
		dsp.state = new juce::dsp::FIR::Coefficients<float>(taps.data(), taps.size());
		configure(values[0]); dsp.prepare(spec);
	}
	void process(juce::AudioBuffer<float> &audio, const ParameterValues &values) override
	{
		if (values[0] != previousCutoff) configure(values[0]);
		juce::dsp::AudioBlock<float> block(audio); dsp.process(juce::dsp::ProcessContextReplacing<float>(block));
	}
	void reset() override { dsp.reset(); }
private:
	void configure(float value)
	{
		const double cutoff = std::min(static_cast<double>(value), rate * 0.45) / rate;
		auto *taps = dsp.state->getRawCoefficients();
		double sum = 0;
		for (int i = 0; i < 65; ++i) {
			const int offset = i - 32;
			const double sinc = offset == 0 ? 2 * cutoff : std::sin(2 * juce::MathConstants<double>::pi * cutoff * offset)
				/ (juce::MathConstants<double>::pi * offset);
			const double window = 0.54 - 0.46 * std::cos(2 * juce::MathConstants<double>::pi * i / 64);
			taps[i] = static_cast<float>(sinc * window); sum += taps[i];
		}
		for (int i = 0; i < 65; ++i) taps[i] /= static_cast<float>(sum);
		previousCutoff = value;
	}
	double rate;
	float previousCutoff = 0;
	juce::dsp::ProcessorDuplicator<juce::dsp::FIR::Filter<float>, juce::dsp::FIR::Coefficients<float>> dsp;
};
}

std::unique_ptr<StandardProcessor> makeFilterProcessor(Kind kind, const juce::dsp::ProcessSpec &spec, const ParameterValues &values)
{
	switch (kind) {
	case Kind::iirFilter: return std::make_unique<IirFilter>(spec, values);
	case Kind::firFilter: return std::make_unique<FirFilter>(spec, values);
	case Kind::stateVariableFilter: return std::make_unique<TptFilter<juce::dsp::StateVariableTPTFilter<float>>>(spec, values);
	case Kind::firstOrderFilter: return std::make_unique<TptFilter<juce::dsp::FirstOrderTPTFilter<float>>>(spec, values);
	case Kind::linkwitzRileyFilter: return std::make_unique<TptFilter<juce::dsp::LinkwitzRileyFilter<float>>>(spec, values);
	default: throw std::invalid_argument("Unsupported JUCE processor kind");
	}
}
}
