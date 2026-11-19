/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include "catalog.h"
#include <juce_dsp/juce_dsp.h>
#include <memory>

namespace soundscaper::effects {
class StandardProcessor {
public:
	virtual ~StandardProcessor() = default;
	virtual void process(juce::AudioBuffer<float> &, const ParameterValues &) = 0;
	virtual void reset() = 0;
};
std::unique_ptr<StandardProcessor> makeStandardProcessor(Kind, const juce::dsp::ProcessSpec &, const ParameterValues &);
std::unique_ptr<StandardProcessor> makeFilterProcessor(Kind, const juce::dsp::ProcessSpec &, const ParameterValues &);
inline ParameterValues physicalValues(Kind kind, const ParameterValues &normalized)
{
	ParameterValues values{};
	const auto &spec = effectSpec(kind);
	for (uint32_t i = 0; i < spec.parameterCount; ++i) values[i] = spec.parameters[i].physical(normalized[i]);
	return values;
}
}
