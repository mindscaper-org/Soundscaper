// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
std::vector<ClipId> Session::deleteRange(Revision expected, RangeDeleteMode mode, std::optional<TrackId> trackId, Frame start, Frame end)
{
	state->checkRevision(expected);
	return state->deleteRange(mode, trackId, start, end);
}

std::vector<ClipId> Session::State::deleteRange(RangeDeleteMode mode, std::optional<TrackId> trackId, Frame start, Frame end,
                                              const std::function<void()>& publish)
{
	auto& s = *this;
	const auto allTracks = mode == RangeDeleteMode::allTracks;
	const auto rippleTrack = allTracks || mode == RangeDeleteMode::track;
	if (trackId.has_value() == allTracks || start >= end)
		throw std::invalid_argument("Choose a nonempty time range and its Tracktion track scope");
	const tracktion::TimeRange range{s.position(start), s.position(end)};
	const auto targets = allTracks ? te::getAudioTracks(*s.edit) : juce::Array<te::AudioTrack*>{ &s.track(*trackId) };
	const auto sample = [&s](auto position) { return tracktion::toSamples(position, s.sampleRate); };
	te::Clip::Array removed, intersecting, subsequent;
	std::vector<te::AutomatableParameter*> automation;
	for (auto* track : targets)
	{
		if (rippleTrack)
			for (auto* parameter : trackAutomationParameters(*track))
				if (parameter && parameter->getCurve().getNumPoints() > 0
				    && parameter->getCurve().getLength() >= toDuration(range.getStart()))
					automation.push_back(parameter);
		for (auto* clip : track->getClips())
		{
			const auto position = clip->getPosition();
			const auto first = sample(position.getStart());
			const auto last = sample(position.getEnd());
			if (last <= start) continue;
			if (first >= end)
			{
				if (rippleTrack) subsequent.add(clip);
			}
			else if (first >= start && last <= end) removed.add(clip);
			else intersecting.add(clip);
		}
	}
	if (removed.isEmpty() && intersecting.isEmpty() && subsequent.isEmpty() && automation.empty()) return {};

	std::vector<ClipId> removedIds;
	// A bounded reply can replace the clip pages when all changes are whole-clip deletions on one track.
	constexpr auto removalReplyLimit = 256;
	if (!allTracks && intersecting.isEmpty() && subsequent.isEmpty() && automation.empty()
	    && removed.size() <= removalReplyLimit
	    && std::none_of(removed.begin(), removed.end(), [](const auto* clip) { return clip->isLinked(); }))
	{
		removedIds.reserve(static_cast<std::size_t>(removed.size()));
		for (const auto* clip : removed) removedIds.push_back(clip->itemID.getRawID());
	}

	s.begin("Delete time range");
	try
	{
		// Free any occupied clip slots before Tracktion splits spanning clips.
		for (auto* clip : removed) clip->removeFromParent();
		for (auto* clip : intersecting)
		{
			const auto previous = clip->getPosition();
			const auto first = sample(previous.getStart());
			const auto hasRight = sample(previous.getEnd()) > end;
			const auto split = first < start && hasRight;
			const auto fragments = te::deleteRegion(*clip, range);
			if (split && fragments.size() != 1)
				throw std::invalid_argument("Tracktion could not split a clip in the selected time range");
			if (hasRight && mode != RangeDeleteMode::leaveGap)
			{
				auto& right = split ? *fragments.getFirst() : *clip;
				right.setPosition(s.clipPlacement(right, rippleTrack ? start : std::max(first, start)));
			}
		}
		for (auto* clip : subsequent)
			clip->setPositionForSampleMove(s.clipPlacement(*clip, sample(clip->getPosition().getStart()) - (end - start)));
		for (auto* parameter : automation)
			parameter->getCurve().removePointsAndCloseGap(*parameter, te::EditTimeRange(range), &s.edit->getUndoManager());
		if (publish) publish();
		s.commit();
	}
	catch (...)
	{
		s.rollback();
		throw;
	}
	return removedIds;
}
}
