// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <cstdint>
#include <limits>

namespace juce { class File; }

namespace soundscaper::tracktion_backend
{
struct ProjectArchiveLimits
{
	std::int64_t expandedBytes = std::numeric_limits<std::int64_t>::max();
	std::int64_t zipBytes = std::numeric_limits<std::int64_t>::max();
};

// The browser's renderer and worker share the matching ZIP input cap.
inline constexpr ProjectArchiveLimits browserProjectArchiveLimits{64 * 1024 * 1024, 65 * 1024 * 1024};
#if defined(__EMSCRIPTEN__)
inline constexpr auto projectArchiveExportLimits = browserProjectArchiveLimits;
#else
inline constexpr ProjectArchiveLimits projectArchiveExportLimits;
#endif

// The caller supplies a fresh directory under its own project staging root.
void extractProjectArchive(const juce::File& archive, const juce::File& directory, ProjectArchiveLimits limits);
}
