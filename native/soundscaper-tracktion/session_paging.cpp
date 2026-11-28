// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
TrackSummary summarizeTrack(te::AudioTrack& track)
{
	return {track.itemID.getRawID(), track.getName().toStdString(), static_cast<std::size_t>(track.getClips().size())};
}
}

ClipView summarizeClip(const te::Clip& clip, int sampleRate)
{
	const auto position = clip.getPosition();
	return {clip.itemID.getRawID(), clip.getName().toStdString(),
	        tracktion::toSamples(position.getStart(), sampleRate),
	        tracktion::toSamples(position.getEnd(), sampleRate),
	        tracktion::toSamples(position.getOffset(), sampleRate)};
}

std::optional<IndexedClip> describeClipPlacement(const te::AudioTrack& track, te::Clip& clip, int sampleRate)
{
	if (clip.isLinked()) return std::nullopt;
	const auto index = track.getClips().indexOf(&clip);
	if (index < 0) return std::nullopt;
	return IndexedClip{summarizeClip(clip, sampleRate), static_cast<std::size_t>(index)};
}

EditHistory Session::editHistory() const
{
	const auto& history = state->edit->getUndoManager();
	return {history.canUndo(), history.canRedo()};
}

ProjectPage Session::projectPage(std::size_t offset, std::size_t limit) const
{
	const auto& s = *state;
	const auto history = editHistory();
	const auto tracks = te::getAudioTracks(*s.edit);
	const auto total = static_cast<std::size_t>(tracks.size());
	if (offset > total)
		throw std::invalid_argument("The Tracktion track page offset is outside the project");
	const auto count = std::min(limit, total - offset);
	ProjectPage page{s.revision, s.sampleRate, history.canUndo, history.canRedo, total, {}};
	page.tracks.reserve(count);
	for (auto index = offset; index < offset + count; ++index)
		page.tracks.push_back(summarizeTrack(*tracks.getUnchecked(static_cast<int>(index))));
	return page;
}

std::optional<TrackInsertion> Session::trackInsertion(TrackId id) const
{
	const auto tracks = te::getAudioTracks(*state->edit);
	for (int index = 0; index < tracks.size(); ++index)
		if (auto* track = tracks.getUnchecked(index); track->itemID.getRawID() == id)
			return TrackInsertion{summarizeTrack(*track), static_cast<std::size_t>(index)};
	return std::nullopt;
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
		page.clips.push_back(summarizeClip(*clips.getUnchecked(static_cast<int>(index)), s.sampleRate));
	return page;
}

std::optional<IndexedClip> Session::indexedClip(TrackId track, ClipId id) const
{
	const auto& clips = state->track(track).getClips();
	// File import normally appends after the last clip in the selected track.
	for (auto index = clips.size() - 1; index >= 0; --index)
		if (const auto* clip = clips.getUnchecked(index); clip->itemID.getRawID() == id)
			return IndexedClip{summarizeClip(*clip, state->sampleRate), static_cast<std::size_t>(index)};
	return std::nullopt;
}
}
