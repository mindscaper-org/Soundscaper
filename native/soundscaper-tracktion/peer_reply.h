// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "session.h"

#include <initializer_list>
#include <memory>
#include <utility>
#include <juce_core/juce_core.h>

namespace soundscaper::tracktion_backend::peer_reply
{
inline juce::var record(std::initializer_list<std::pair<const char*, juce::var>> fields)
{
	auto result = std::make_unique<juce::DynamicObject>();
	for (const auto& [key, value] : fields)
		result->setProperty(key, value);
	return juce::var(result.release());
}

inline juce::var number(std::int64_t value)
{
	return juce::var(static_cast<juce::int64>(value));
}

inline juce::var clipReply(const ClipView& clip)
{
	return record({
		{"id", juce::String(std::to_string(clip.id))}, {"name", juce::String(clip.name).substring(0, 128)},
		{"start", number(clip.start)}, {"end", number(clip.end)}, {"sourceOffset", number(clip.sourceOffset)},
	});
}

inline juce::var indexedClipReply(const IndexedClip& clip)
{
	return record({{"clip", clipReply(clip.clip)}, {"index", number(static_cast<std::int64_t>(clip.index))}});
}

inline juce::var indexedClipsReply(const std::vector<IndexedClip>& clips)
{
	juce::Array<juce::var> result;
	for (const auto& clip : clips) result.add(indexedClipReply(clip));
	return juce::var(result);
}

inline juce::var clipIdsReply(const std::vector<ClipId>& ids)
{
	juce::Array<juce::var> result;
	for (const auto id : ids) result.add(juce::String(std::to_string(id)));
	return juce::var(result);
}
}
