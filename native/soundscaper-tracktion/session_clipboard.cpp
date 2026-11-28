// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"
#include "staged_file_output.h"

#include <algorithm>
#include <map>
#include <set>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
constexpr auto selectionName = "selection.xml";
constexpr auto metadataLimit = 16 * 1024 * 1024;
constexpr auto pasteReplyLimit = 32;

bool stageSelection(const juce::ValueTree& selection, const juce::File& file)
{
	const auto xml = selection.createXml();
	if (!xml) return false;
	StagedFileOutput output(file, metadataLimit);
	if (!output.ready()) return false;
	xml->writeTo(output, {});
	return output.complete();
}

struct ClipboardGeneration
{
	juce::File directory;
	bool published = false;
	~ClipboardGeneration() { if (!published) directory.deleteRecursively(); }
};

bool generationName(const juce::String& name)
{
	return name.length() == 32 && name.containsOnly("0123456789abcdef");
}

Frame frameField(const juce::ValueTree& state, const juce::Identifier& name)
{
	return static_cast<juce::int64>(state[name]);
}

juce::String mediaReference(const juce::File& file)
{
	return juce::String(mediaDirectory) + "/" + file.getFileName();
}

struct PasteClip
{
	juce::ValueTree state;
	juce::File source;
	int lane;
	Frame first, last, sourceTrim;
};
}

std::vector<ClipId> Session::copyRange(Revision expected, RangeDeleteMode mode, std::optional<TrackId> trackId,
                                     Frame start, Frame end, const juce::File& clipboard, bool cut)
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto allTracks = mode == RangeDeleteMode::allTracks;
	if (trackId.has_value() == allTracks || start >= end)
		throw std::invalid_argument("Choose a nonempty time range and its Tracktion track scope");
	static_cast<void>(s.position(start));
	static_cast<void>(s.position(end));
	const auto targets = allTracks ? te::getAudioTracks(*s.edit) : juce::Array<te::AudioTrack*>{ &s.track(*trackId) };
	const auto generation = juce::Uuid().toString();
	juce::ValueTree selection("SOUNDSCAPERCLIPBOARD");
	selection.setProperty("generation", generation, nullptr);
	selection.setProperty("rate", s.sampleRate, nullptr);
	selection.setProperty("frames", static_cast<juce::int64>(end - start), nullptr);
	std::map<juce::String, juce::String> references;
	std::set<juce::File> sources;
	for (auto* track : targets)
	{
		juce::ValueTree lane("LANE");
		lane.setProperty("name", track->getName(), nullptr);
		for (auto* clip : track->getClips())
		{
			const auto position = clip->getPosition();
			const auto origin = tracktion::toSamples(position.getStart(), s.sampleRate);
			const auto first = std::max(start, origin);
			const auto last = std::min(end, tracktion::toSamples(position.getEnd(), s.sampleRate));
			if (first >= last) continue;
			const auto& sourceRef = clip->getSourceFileReference();
			const auto [reference, inserted] = references.try_emplace(sourceRef.source.get());
			if (inserted)
			{
				const auto file = sourceRef.getFile();
				reference->second = mediaReference(file);
				if (file == juce::File{} || ownedMediaFile(s.directory, reference->second) != file)
					throw std::invalid_argument("The Tracktion clipboard requires project-owned audio");
				sources.insert(file);
			}
			juce::ValueTree item("ITEM");
			item.setProperty("first", static_cast<juce::int64>(first - start), nullptr);
			item.setProperty("last", static_cast<juce::int64>(last - start), nullptr);
			item.setProperty("trim", static_cast<juce::int64>(first - origin), nullptr);
			auto clipState = te::ClipCopy::fromClip(*clip).getState();
			clipState.setProperty(te::IDs::source, reference->second, nullptr);
			item.addChild(clipState, -1, nullptr);
			lane.addChild(item, -1, nullptr);
		}
		selection.addChild(lane, -1, nullptr);
	}
	if (sources.empty()) throw std::invalid_argument("The selected time range contains no audio");
	if (clipboard.isSymbolicLink() || (clipboard.exists() && !clipboard.isDirectory()))
		throw std::invalid_argument("The Tracktion clipboard directory is invalid");
	ClipboardGeneration snapshot{clipboard.getChildFile(generation)};
	const auto media = snapshot.directory.getChildFile(mediaDirectory);
	if (!media.createDirectory().wasOk()) throw std::invalid_argument("Cannot create Tracktion clipboard storage");
	for (const auto& source : sources)
	{
		if (ownedMediaFile(s.directory, mediaReference(source)) != source)
			throw std::invalid_argument("The Tracktion clipboard requires project-owned audio");
		copyOwnedWave(source, media.getChildFile(source.getFileName()), "Cannot preserve Tracktion clipboard media");
	}
	const juce::TemporaryFile staged(clipboard.getChildFile(selectionName));
	if (!stageSelection(selection, staged.getFile()))
		throw std::invalid_argument("The Tracktion clipboard selection could not be staged");
	const auto publish = [&]
	{
		if (!staged.overwriteTargetFileWithTemporary())
			throw std::invalid_argument("Cannot publish the Tracktion clipboard");
		snapshot.published = true;
	};
	std::vector<ClipId> removedIds;
	if (cut) removedIds = s.deleteRange(mode, trackId, start, end, publish);
	else publish();
	for (const auto& old : clipboard.findChildFiles(juce::File::findDirectories, false))
		if (old != snapshot.directory && generationName(old.getFileName()) && !old.isSymbolicLink()) old.deleteRecursively();
	return removedIds;
}

std::vector<IndexedClip> Session::pasteRange(Revision expected, RangePasteMode mode, TrackId trackId, Frame start, const juce::File& clipboard)
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto at = s.position(start);
	const auto file = clipboard.getChildFile(selectionName);
	if (clipboard.isSymbolicLink() || file.isSymbolicLink() || !file.existsAsFile() || file.getSize() > metadataLimit)
		throw std::invalid_argument("There is no Tracktion clipboard selection");
	const auto xml = juce::parseXML(file);
	if (!xml || !xml->hasTagName("SOUNDSCAPERCLIPBOARD")) throw std::invalid_argument("Invalid Tracktion clipboard selection");
	const auto selection = juce::ValueTree::fromXml(*xml);
	const auto generation = selection["generation"].toString();
	const int rate = selection["rate"];
	const auto duration = frameField(selection, "frames");
	if (!generationName(generation) || rate < 8000 || rate > 192000 || duration <= 0
	    || duration > tracktion::toSamples(te::Edit::getMaximumEditEnd(), rate))
		throw std::invalid_argument("Invalid Tracktion clipboard timing");
	const auto mediaRoot = clipboard.getChildFile(generation);
	if (mediaRoot.isSymbolicLink()) throw std::invalid_argument("Invalid Tracktion clipboard media directory");
	const auto translate = [&](Frame frame)
	{
		return tracktion::toSamples(tracktion::TimeDuration::fromSamples(frame, rate), s.sampleRate);
	};
	const auto width = translate(duration);
	if (width <= 0) throw std::invalid_argument("The Tracktion clipboard is shorter than one destination sample");
	static_cast<void>(s.position(start + width));
	std::vector<PasteClip> clips;
	for (int lane = 0; lane < selection.getNumChildren(); ++lane)
		for (const auto& item : selection.getChild(lane))
		{
			const auto first = frameField(item, "first");
			const auto last = frameField(item, "last");
			const auto trim = frameField(item, "trim");
			auto clip = item.getChild(0);
			const auto source = ownedMediaFile(mediaRoot, clip.getProperty(te::IDs::source).toString());
			if (!clip.hasType(te::IDs::AUDIOCLIP) || !source.existsAsFile()
			    || first < 0 || last > duration || trim < 0 || trim > tracktion::toSamples(te::Edit::getMaximumEditEnd(), rate)
			    || first >= last || translate(first) >= translate(last))
				throw std::invalid_argument("Invalid Tracktion clipboard clip or source interval");
			clips.push_back({clip.createCopy(), source, lane, translate(first), translate(last), trim});
		}
	if (clips.empty()) throw std::invalid_argument("There is no Tracktion clipboard audio");

	auto tracks = te::getAudioTracks(*s.edit);
	const auto firstTrack = tracks.indexOf(&s.track(trackId));
	const auto trackEnd = firstTrack + selection.getNumChildren();
	const auto media = s.requireMediaDirectory();
	std::map<juce::File, juce::File> adopted;
	std::vector<juce::File> addedFiles;
	const auto reportPlacements = mode == RangePasteMode::overlap && selection.getNumChildren() == 1 && clips.size() <= pasteReplyLimit;
	te::Clip::Array inserted;
	bool editing = false;
	try
	{
		for (auto& clip : clips)
		{
			auto found = adopted.find(clip.source);
			if (found == adopted.end())
			{
				auto target = media.getChildFile(clip.source.getFileName());
				if (target.isSymbolicLink() || !target.hasIdenticalContentTo(clip.source))
				{
					while (target.exists() || target.isSymbolicLink()) target = media.getChildFile(juce::Uuid().toString() + ".wav");
					addedFiles.push_back(target);
					copyOwnedWave(clip.source, target, "Cannot adopt the clipboard media");
				}
				found = adopted.emplace(clip.source, target).first;
			}
			clip.state.setProperty(te::IDs::source, mediaReference(found->second), nullptr);
		}
		s.begin("Paste time range");
		editing = true;
		while (tracks.size() < trackEnd)
		{
			auto track = s.edit->insertNewAudioTrack(te::TrackInsertPoint::getEndOfTracks(*s.edit), nullptr);
			if (!track) throw std::invalid_argument("Tracktion could not add a clipboard track");
			track->setName(selection.getChild(tracks.size() - firstTrack)["name"].toString());
			tracks.add(track.get());
		}
		if (mode != RangePasteMode::overlap)
		{
			const auto all = mode == RangePasteMode::insertAll;
			for (int index = all ? 0 : firstTrack; index < (all ? tracks.size() : trackEnd); ++index)
			{
				auto& track = *tracks[index];
				te::Clip::Array tails;
				for (auto* clip : track.getClips())
					if (tracktion::toSamples(clip->getPosition().getEnd(), s.sampleRate) > start) tails.add(clip);
				for (auto* clip : tails)
				{
					const auto first = tracktion::toSamples(clip->getPosition().getStart(), s.sampleRate);
					auto* right = first < start ? track.splitClip(*clip, at) : clip;
					if (!right) throw std::invalid_argument("Tracktion could not split a clip at the paste position");
					right->setPosition(s.clipPlacement(*right, std::max(first, start) + width));
				}
				for (auto* parameter : trackAutomationParameters(track))
				{
					if (!parameter || parameter->getCurve().getNumPoints() == 0) continue;
					auto& curve = parameter->getCurve();
					const auto last = tracktion::toSamples(curve.getLength(), s.sampleRate);
					if (last < start) continue;
					static_cast<void>(s.position(last + width));
					curve.insertSpace(*parameter, at, tracktion::TimeDuration::fromSamples(width, s.sampleRate));
				}
			}
		}
		for (auto& clip : clips)
		{
			const auto copy = te::ClipCopy::fromClipboardState(clip.state, false).withNewItemID(*s.edit);
			auto* item = te::insertClipCopy(*tracks[firstTrack + clip.lane], copy);
			if (!item) throw std::invalid_argument("Tracktion could not insert a clipboard clip");
			const auto offset = item->getPosition().offset + tracktion::TimeDuration::fromSamples(clip.sourceTrim, rate);
			item->setPosition({{s.position(start + clip.first), s.position(start + clip.last)}, offset});
			if (reportPlacements) inserted.add(item);
		}
		s.commit();
	}
	catch (...)
	{
		if (editing) s.rollback();
		for (const auto& added : addedFiles) added.deleteFile();
		throw;
	}

	// The transaction dispatches Tracktion's pending clip ordering before we read the final indices.
	std::vector<IndexedClip> placements;
	placements.reserve(static_cast<std::size_t>(inserted.size()));
	for (auto* item : inserted)
	{
		auto placement = describeClipPlacement(*tracks[firstTrack], *item, s.sampleRate);
		if (!placement) return {};
		placements.push_back(std::move(*placement));
	}
	std::ranges::sort(placements, {}, &IndexedClip::index);
	return placements;
}
}
