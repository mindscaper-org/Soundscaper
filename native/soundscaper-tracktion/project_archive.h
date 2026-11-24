// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <cstdint>

namespace juce { class File; }

namespace soundscaper::tracktion_backend
{
// The caller supplies a fresh directory under its own project staging root.
void extractProjectArchive(const juce::File& archive, const juce::File& directory, std::int64_t expandedByteLimit);
}
