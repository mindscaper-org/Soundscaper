// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
void Session::deleteRange(Revision expected, RangeDeleteMode mode, std::optional<TrackId> trackId, Frame start, Frame end)
{
	state->checkRevision(expected);
	state->deleteRange(mode, trackId, start, end);
}

void Session::State::deleteRange(RangeDeleteMode mode, std::optional<TrackId> trackId, Frame start, Frame end,
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
	for (auto* track : targets)
	{
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
	if (removed.isEmpty() && intersecting.isEmpty() && subsequent.isEmpty()) return;

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
			clip->setPosition(s.clipPlacement(*clip, sample(clip->getPosition().getStart()) - (end - start)));
		if (publish) publish();
		s.commit();
	}
	catch (...)
	{
		s.rollback();
		throw;
	}
}
}
