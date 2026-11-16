/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>

namespace soundscaper::effects {
constexpr size_t maximumParameters = 8;
using ParameterValues = std::array<float, maximumParameters>;
struct ParameterSpec {
	const char *name;
	const char *unit;
	float minimum, maximum, initial;
	bool logarithmic;
	std::array<const char *, 7> choices{};
	uint32_t choiceCount = 0;
	float physical(float value) const
	{
		return logarithmic ? minimum * std::pow(maximum / minimum, value) : minimum + value * (maximum - minimum);
	}
	float normalized(float value) const
	{
		return logarithmic ? std::log(value / minimum) / std::log(maximum / minimum) : (value - minimum) / (maximum - minimum);
	}
};
}
#include "effect_catalog.generated.h"
