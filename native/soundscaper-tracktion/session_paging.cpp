// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
ProjectPage Session::projectPage(std::size_t offset, std::size_t limit) const
{
	const auto& s = *state;
	const auto& history = s.edit->getUndoManager();
	const auto tracks = te::getAudioTracks(*s.edit);
	const auto total = static_cast<std::size_t>(tracks.size());
	if (offset > total)
		throw std::invalid_argument("The Tracktion track page offset is outside the project");
	const auto count = std::min(limit, total - offset);
	ProjectPage page{s.revision, s.sampleRate, history.canUndo(), history.canRedo(), total, {}};
	page.tracks.reserve(count);
	for (auto index = offset; index < offset + count; ++index)
	{
		auto* track = tracks.getUnchecked(static_cast<int>(index));
		page.tracks.push_back({track->itemID.getRawID(), track->getName().toStdString(),
		                       static_cast<std::size_t>(track->getClips().size())});
	}
	return page;
}

ClipPage Session::clipPage(TrackId id, std::size_t offset, std::size_t limit) const
{
	const auto& s = *state;
	auto* track = te::findAudioTrackForID(*s.edit, te::EditItemID::fromRawID(id));
	constexpr auto error = "The Tracktion clip page does not belong to this project";
	if (!track) throw std::invalid_argument(error);
	const auto& clips = track->getClips();
	const auto total = static_cast<std::size_t>(clips.size());
	if (offset > total) throw std::invalid_argument(error);
	const auto count = std::min(limit, total - offset);
	ClipPage page{total, {}};
	page.clips.reserve(count);
	for (auto index = offset; index < offset + count; ++index)
	{
		auto* clip = clips.getUnchecked(static_cast<int>(index));
		const auto position = clip->getPosition();
		page.clips.push_back({clip->itemID.getRawID(), clip->getName().toStdString(),
		                      tracktion::toSamples(position.getStart(), s.sampleRate),
		                      tracktion::toSamples(position.getEnd(), s.sampleRate),
		                      tracktion::toSamples(position.getOffset(), s.sampleRate)});
	}
	return page;
}
}
