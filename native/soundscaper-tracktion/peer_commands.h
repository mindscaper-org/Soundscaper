// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <juce_core/juce_core.h>

namespace soundscaper::tracktion_backend
{
class Session;
juce::var dispatch(Session&, const juce::File& exchange, const juce::var& request);
}
