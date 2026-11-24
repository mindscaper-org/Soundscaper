// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

namespace juce { class AudioIODevice; }

namespace soundscaper::tracktion_backend
{
enum class PipeWireCapture { inactive, active, interrupted };

PipeWireCapture pipeWireCapture(juce::AudioIODevice*);
bool quiescePipeWireCapture(juce::AudioIODevice*);
}
