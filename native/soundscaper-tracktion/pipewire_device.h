// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

namespace juce { class AudioIODevice; }

namespace soundscaper::tracktion_backend
{
enum class PipeWireRoute { inactive, active, interrupted };

PipeWireRoute pipeWireCapture(juce::AudioIODevice*);
PipeWireRoute pipeWireOutput(juce::AudioIODevice*);
bool quiescePipeWireCapture(juce::AudioIODevice*);
}
