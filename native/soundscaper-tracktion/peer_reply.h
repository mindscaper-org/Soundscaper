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

inline juce::var pageCursor(std::size_t end, std::size_t total)
{
	return end < total ? number(static_cast<std::int64_t>(end)) : juce::var();
}

inline juce::var editHistoryReply(const Session& session)
{
	const auto history = session.editHistory();
	return record({{"canUndo", history.canUndo}, {"canRedo", history.canRedo}});
}

inline juce::var applyHistoryEdit(Session& session, Revision revision, bool redo)
{
	const auto keepsTimeline = session.historyKeepsTimeline(redo);
	const auto changed = redo ? session.redo(revision) : session.undo(revision);
	auto reply = record({{"revision", number(session.revision())}, {"itemId", juce::var()}});
	if (changed && keepsTimeline)
	{
		reply.getDynamicObject()->setProperty("timelineUnchanged", true);
		reply.getDynamicObject()->setProperty("history", editHistoryReply(session));
	}
	return reply;
}

inline juce::var clipReply(const ClipView& clip)
{
	return record({
		{"id", juce::String(std::to_string(clip.id))}, {"name", juce::String(clip.name).substring(0, 128)},
		{"start", number(clip.start)}, {"end", number(clip.end)}, {"sourceOffset", number(clip.sourceOffset)},
	});
}

inline constexpr auto clipPageRowLimit = 256u;

inline juce::var clipPageReply(const ClipPage& page, Revision revision, std::size_t offset)
{
	// Include JSON escaping and separators, leaving room for the 64 KiB frame's envelope.
	constexpr std::size_t rowBudget = 60 * 1024;
	std::size_t bytes = 0;
	juce::MemoryOutputStream encoded;
	juce::Array<juce::var> clips;
	clips.ensureStorageAllocated(static_cast<int>(page.clips.size()));
	for (const auto& clip : page.clips)
	{
		auto row = clipReply(clip);
		encoded.reset();
		juce::JSON::writeToStream(encoded, row, true);
		bytes += encoded.getDataSize() + 2;
		if (bytes > rowBudget) break;
		clips.add(std::move(row));
	}
	const auto next = pageCursor(offset + static_cast<std::size_t>(clips.size()), page.total);
	return record({{"revision", number(revision)}, {"clips", juce::var(clips)}, {"nextOffset", next}});
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
