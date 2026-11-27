// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
juce::File ownedMediaFile(const juce::File& directory, const juce::String& reference)
{
	const auto relative = reference.replaceCharacter('\\', '/');
	if (!relative.startsWith("media/"))
		return {};
	const auto name = relative.substring(6);
	if (name.length() != 36 || !name.endsWith(".wav") || !name.dropLastCharacters(4).containsOnly("0123456789abcdef"))
		return {};
	const auto media = directory.getChildFile(mediaDirectory);
	const auto file = media.getChildFile(name);
	if (media.isSymbolicLink() || file.isSymbolicLink() || !file.existsAsFile())
		return {};
	return file;
}

namespace
{
const juce::Identifier projectSampleRate("soundscaperProjectSampleRate");

void ensureDirectory(const juce::File& directory)
{
	if (!directory.createDirectory().wasOk() || directory.isSymbolicLink())
		throw std::runtime_error("Cannot create a Tracktion directory");
}

#if JUCE_LINUX && ! JUCE_WASM
bool copyCompleteWave(const juce::File& source, const juce::File& destination)
{
	// JUCE's Linux copy counts input bytes even when a destination write fails.
	const auto input = source.createInputStream();
	if (!input) return false;
	const auto bytes = input->getTotalLength();
	if (bytes <= 0) return false;
	juce::TemporaryFile staging(destination, juce::TemporaryFile::useHiddenFile);
	{
		juce::FileOutputStream output(staging.getFile(), 0);
		if (output.failedToOpen()) return false;
		constexpr int blockBytes = 256 * 1024;
		juce::HeapBlock<char> buffer(blockBytes);
		for (auto remaining = bytes; remaining > 0;)
		{
			const auto count = input->read(buffer.getData(), static_cast<int>(std::min<juce::int64>(remaining, blockBytes)));
			if (count <= 0 || !output.write(buffer.getData(), static_cast<std::size_t>(count))) return false;
			remaining -= count;
		}
		output.flush();
		if (output.getStatus().failed()) return false;
	}
	return source.getSize() == bytes && staging.getFile().getSize() == bytes && staging.overwriteTargetFileWithTemporary();
}
#endif

class HeadlessSettings final : public te::PropertyStorage
{
public:
	explicit HeadlessSettings(const juce::File& directory)
		: te::PropertyStorage("Soundscaper Tracktion"), directory(directory)
	{
		ensureDirectory(directory);
	}

	juce::File getAppPrefsFolder() override { return directory; }

private:
	juce::File directory;
};

bool admitsSampleRate(int sampleRate)
{
	return sampleRate >= 8000 && sampleRate <= 192000;
}

void dispatchEditChanges(te::Edit& edit)
{
	edit.getTrackList().dispatchPendingOrdering();
	for (auto* track : te::getAudioTracks(edit))
	{
		track->dispatchPendingClipOrdering();
		// A hosted block can arrive before Tracktion's deferred automation timer.
		if (auto* volume = track->getVolumePlugin()) volume->updateStreamIterators();
	}
	edit.dispatchPendingUpdatesSynchronously();
}

void endTransaction(te::Edit& edit)
{
	dispatchEditChanges(edit);
	edit.getUndoManager().beginNewTransaction();
}

class TrackMixChange final : public juce::UndoableAction
{
public:
	TrackMixChange(te::Edit& owner, te::EditItemID id, TrackMix before, TrackMix after)
		: edit(owner), trackId(id), original(before), updated(after) {}

	bool perform() override { return apply(updated); }
	bool undo() override { return apply(original); }

private:
	bool apply(TrackMix mix)
	{
		auto* track = dynamic_cast<te::AudioTrack*>(te::findTrackForID(edit, trackId));
		if (!track) return false;
		if (auto* volume = track->getVolumePlugin())
		{
			// This action owns the transaction. Update the parameter cache without
			// asking JUCE to record another action on the same UndoManager.
			volume->volume.setValue(te::decibelsToVolumeFaderPosition(mix.gainDb), nullptr);
			volume->pan.setValue(mix.pan, nullptr);
			volume->volParam->updateFromAttachedValue();
			volume->panParam->updateFromAttachedValue();
		}
		track->setMute(mix.muted);
		track->setSolo(mix.solo);
		return true;
	}

	te::Edit& edit;
	te::EditItemID trackId;
	TrackMix original;
	TrackMix updated;
};
}

void copyOwnedWave(const juce::File& source, const juce::File& destination, const char* failure)
{
#if JUCE_LINUX && ! JUCE_WASM
	if (!copyCompleteWave(source, destination)) throw std::invalid_argument(failure);
#else
	if (!source.copyFileTo(destination)) throw std::runtime_error(failure);
#endif
}

Session::State::State(const juce::File& directory, const juce::File& stateDirectory, OpenMode mode, int requestedSampleRate)
	: directory(directory), editFile(directory.getChildFile("project.tracktionedit")),
	  engine(std::make_unique<HeadlessSettings>(stateDirectory),
	         nullptr, std::make_unique<SessionBehaviour>())
{
	registerOfflineEffectPlugin(engine);
	auto tree = mode == OpenMode::create ? newProject(requestedSampleRate) : openProject();
	// Include the scene container when Tracktion sorts the Edit's children on
	// load. Otherwise the first track edit may move it in an undo transaction.
	tree.getOrCreateChildWithName(te::IDs::SCENES, nullptr);
	sampleRate = static_cast<int>(tree[projectSampleRate]);
	if (!admitsSampleRate(sampleRate))
		throw std::invalid_argument("The project sample rate is invalid");
	edit = makeEdit(std::move(tree), te::Edit::forEditing);
	if (edit == nullptr)
		throw std::runtime_error("Cannot create the Tracktion Edit");
	edit->alwaysUseRelativePaths = true;
	for (auto* track : te::getAudioTracks(*edit))
		for (auto* clip : track->getClips())
			if (dynamic_cast<te::WaveAudioClip*>(clip) == nullptr
			    || !clip->getSourceFileReference().getFile().existsAsFile())
				throw std::invalid_argument("The project contains missing or unsupported clip media");
	// Tracktion can first request its scene list from an asynchronous callback.
	// Initialise it here before clearing the Edit's setup transactions.
	static_cast<void>(edit->getSceneList());
	endTransaction(*edit);
	edit->getUndoManager().clearUndoHistory();
}

std::unique_ptr<te::Edit> Session::State::makeEdit(juce::ValueTree tree, te::Edit::EditRole role)
{
	return te::Edit::createEdit({
		.engine = engine,
		.editState = std::move(tree),
		.editProjectItemID = te::ProjectItemID::createNewID(te::ProjectID{}),
		.role = role,
		.editFileRetriever = [file = editFile] { return file; },
		.filePathResolver = [folder = directory](const juce::String& reference)
		{
			return ownedMediaFile(folder, reference);
		},
		.defaultMasterVolumedB = 0.0f,
	});
}

juce::ValueTree Session::State::newProject(int rate)
{
	if (!admitsSampleRate(rate))
		throw std::invalid_argument("The project sample rate is invalid");
	ensureDirectory(directory);
	if (directory.getNumberOfChildFiles(juce::File::findFilesAndDirectories) != 0)
		throw std::invalid_argument("A new Tracktion project requires an empty directory");
	ensureDirectory(directory.getChildFile(mediaDirectory));
	auto tree = te::createEmptyEdit(engine);
	tree.setProperty(projectSampleRate, rate, nullptr);
	return tree;
}

juce::ValueTree Session::State::openProject() const
{
	if (directory.isSymbolicLink() || editFile.isSymbolicLink() || !editFile.existsAsFile()
	    || editFile.getSize() > 16 * 1024 * 1024)
		throw std::invalid_argument("The Tracktion Edit is missing or too large");
	const auto xml = juce::parseXML(editFile);
	if (xml == nullptr || !xml->hasTagName("EDIT") || !xml->hasAttribute(projectSampleRate.toString()))
		throw std::invalid_argument("The file is not an experimental Soundscaper Tracktion Edit");
	return juce::ValueTree::fromXml(*xml);
}

tracktion::TimePosition Session::State::position(Frame frame) const
{
	const auto end = tracktion::toSamples(te::Edit::getMaximumEditEnd(), sampleRate);
	if (frame < 0 || frame > end)
		throw std::invalid_argument("Timeline frame is outside the Edit");
	return tracktion::TimePosition::fromSamples(frame, sampleRate);
}

te::ClipPosition Session::State::clipPlacement(const te::Clip& clip, Frame start) const
{
	const auto from = position(start);
	const auto current = clip.getPosition();
	const auto duration = tracktion::toSamples(current.getEnd(), sampleRate)
	                    - tracktion::toSamples(current.getStart(), sampleRate);
	return {{from, position(start + duration)}, current.offset};
}

void Session::State::checkRevision(Revision expected, bool finishingRecording) const
{
	if (expected != revision)
		throw std::invalid_argument("The Tracktion Edit revision has changed");
	if (!finishingRecording)
		requireNoRecording();
}

te::AudioTrack& Session::State::track(TrackId id) const
{
	for (auto* track : te::getAudioTracks(*edit))
		if (track->itemID.getRawID() == id)
			return *track;
	throw std::invalid_argument("Unknown Tracktion audio track");
}

std::pair<te::AudioTrack&, te::Clip&> Session::State::clip(ClipId id) const
{
	for (auto* track : te::getAudioTracks(*edit))
		for (auto* item : track->getClips())
			if (item->itemID.getRawID() == id)
				return {*track, *item};
	throw std::invalid_argument("Unknown Tracktion clip");
}

void Session::State::begin(const char* name)
{
	edit->getUndoManager().beginNewTransaction(name);
}

void Session::State::commit()
{
	endTransaction(*edit);
	++revision;
}

void Session::State::rollback()
{
	dispatchEditChanges(*edit);
	edit->getUndoManager().undoCurrentTransactionOnly();
	endTransaction(*edit);
}

Session::Session(const juce::File& directory, const juce::File& stateDirectory, OpenMode mode, int sampleRate)
	: state(std::make_unique<State>(directory, stateDirectory, mode, sampleRate)) {}

Revision Session::revision() const noexcept
{
	return state->revision;
}

TrackId Session::addTrack(Revision expected, const std::string& name)
{
	auto& s = *state;
	s.checkRevision(expected);
	if (name.empty() || name.size() > 128)
		throw std::invalid_argument("Track name must contain 1 to 128 bytes");
	s.begin("Add audio track");
	const auto track = s.edit->insertNewAudioTrack(te::TrackInsertPoint::getEndOfTracks(*s.edit), nullptr);
	if (track == nullptr)
	{
		s.rollback();
		throw std::invalid_argument("Tracktion refused the audio track");
	}
	track->setName(juce::String::fromUTF8(name.data(), static_cast<int>(name.size())));
	s.commit();
	return track->itemID.getRawID();
}

TrackId Session::duplicateTrack(Revision expected, TrackId id)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& source = s.track(id);
	s.edit->flushState();
	te::Clipboard::Tracks clipboard;
	clipboard.tracks.push_back(source.state);
	te::EditInsertPoint insertion(*s.edit);
	te::Clipboard::ContentType::EditPastingOptions options(*s.edit, insertion);
	options.startTrack = &source;
	const auto previousNext = source.state.getSibling(1);
	s.begin("Duplicate audio track");
	try
	{
		if (!clipboard.pasteIntoEdit(options)) throw std::invalid_argument("Tracktion refused the track duplicate");
		const auto next = source.state.getSibling(1);
		auto* duplicate = next != previousNext ? te::findTrackForState(*s.edit, next) : nullptr;
		if (!duplicate) throw std::invalid_argument("Tracktion refused the track duplicate");
		const juce::String suffix = " copy";
		duplicate->setName(source.getName().substring(0, 64 - suffix.length()) + suffix);
		s.commit();
		return duplicate->itemID.getRawID();
	}
	catch (...) { s.rollback(); throw; }
}

TrackMix Session::trackMix(Revision expected, TrackId id) const
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& track = s.track(id);
	const auto* volume = track.getVolumePlugin();
	return {volume ? te::volumeFaderPositionToDB(volume->volParam->getCurrentExplicitValue()) : 0.0f,
	        volume ? volume->panParam->getCurrentExplicitValue() : 0.0f,
	        track.isMuted(false), track.isSolo(false)};
}

void Session::setTrackMix(Revision expected, TrackId id, TrackMix mix)
{
	if (!std::isfinite(mix.gainDb) || mix.gainDb < -100.0f || mix.gainDb > 6.0f
	    || !std::isfinite(mix.pan) || mix.pan < -1.0f || mix.pan > 1.0f)
		throw std::invalid_argument("Tracktion mixer gain or pan is out of range");
	if (std::abs(mix.pan) <= 0.005f) mix.pan = 0.0f;
	const auto current = trackMix(expected, id);
	const auto gainChanged = std::abs(current.gainDb - mix.gainDb) > 0.0001f;
	const auto panChanged = current.pan != mix.pan;
	if (!gainChanged && !panChanged && current.muted == mix.muted && current.solo == mix.solo) return;
	auto& s = *state;
	auto& track = s.track(id);
	auto* volume = track.getVolumePlugin();
	if (!volume && (gainChanged || panChanged))
		throw std::invalid_argument("This Tracktion track has no volume and pan plugin");
	s.begin("Adjust track mix");
	if (!s.edit->getUndoManager().perform(new TrackMixChange(*s.edit, track.itemID, current, mix)))
		throw std::runtime_error("Cannot apply the Tracktion track mix");
	s.commit();
}

ClipId Session::insertAudio(Revision expected, TrackId trackId, const juce::File& source, Frame start,
                           Frame offset, std::optional<Frame> requestedCount, const std::string& name)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& track = s.track(trackId);
	const auto from = s.position(start);
	const auto maxFrame = tracktion::toSamples(te::Edit::getMaximumEditEnd(), s.sampleRate);
	if (offset < 0 || name.size() > 512
	    || !source.existsAsFile() || source.isSymbolicLink())
		throw std::invalid_argument("Invalid audio import or clip range");

	juce::WavAudioFormat format;
	std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(source.createInputStream().release(), true));
	if (reader == nullptr || reader->sampleRate != s.sampleRate || reader->numChannels < 1
	    || reader->numChannels > 2 || offset > reader->lengthInSamples)
		throw std::invalid_argument("Import requires project-rate mono or stereo WAV with the requested source range");
	const auto available = reader->lengthInSamples - offset;
	const auto count = requestedCount.value_or(available);
	if (count <= 0 || count > available || count > maxFrame - start)
		throw std::invalid_argument("The source interval is outside the Tracktion Edit");
	reader.reset();

	const auto media = s.directory.getChildFile(mediaDirectory);
	if (!media.isDirectory() || media.isSymbolicLink())
		throw std::runtime_error("The project media directory is unavailable");
	const auto destination = media.getChildFile(juce::Uuid().toString() + ".wav");
	copyOwnedWave(source, destination, "Cannot copy the audio into the project");

	s.begin("Import audio");
	const auto offsetTime = tracktion::TimeDuration::fromSamples(offset, s.sampleRate);
	juce::ValueTree clipState(te::IDs::AUDIOCLIP);
	clipState.setProperty(te::IDs::source, juce::String(mediaDirectory) + "/" + destination.getFileName(), nullptr);
	const auto clipName = name.empty() ? source.getFileNameWithoutExtension() : juce::String::fromUTF8(name.data(), static_cast<int>(name.size()));
	auto* clip = track.insertClipWithState(clipState, clipName,
		te::TrackItem::Type::wave, {{from, s.position(start + count)}, offsetTime}, false, false);
	if (clip == nullptr)
	{
		s.edit->getUndoManager().undoCurrentTransactionOnly();
		destination.deleteFile();
		throw std::runtime_error("Tracktion refused the audio clip");
	}
	s.commit();
	return clip->itemID.getRawID();
}

std::optional<TrimmedClip> Session::trim(Revision expected, ClipId id, Frame start, Frame end)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto [track, clip] = s.clip(id);
	const auto current = clip.getPosition();
	const auto range = tracktion::TimeRange(s.position(start), s.position(end));
	if (start >= end || range.getStart() < current.getStart() || range.getEnd() > current.getEnd())
		throw std::invalid_argument("Trim must keep a nonempty portion of the clip");
	if (range == current.time)
		return std::nullopt;
	s.begin("Trim clip");
	clip.setPosition({range, current.offset + (range.getStart() - current.getStart())});
	s.commit();
	if (clip.isLinked()) return std::nullopt;
	const auto index = track.getClips().indexOf(&clip);
	if (index < 0) return std::nullopt;
	return TrimmedClip{summarizeClip(clip, s.sampleRate), static_cast<std::size_t>(index)};
}

ClipId Session::split(Revision expected, ClipId id, Frame frame)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto [track, clip] = s.clip(id);
	const auto position = s.position(frame);
	if (position <= clip.getPosition().getStart() || position >= clip.getPosition().getEnd())
		throw std::invalid_argument("Split must be inside the clip");
	s.begin("Split clip");
	auto* right = track.splitClip(clip, position);
	if (right == nullptr)
	{
		s.rollback();
		throw std::invalid_argument("Tracktion refused the clip split");
	}
	s.commit();
	return right->itemID.getRawID();
}

void Session::moveClip(Revision expected, ClipId id, TrackId destination, Frame start)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto [source, clip] = s.clip(id);
	auto& target = s.track(destination);
	const auto placement = s.clipPlacement(clip, start);
	const auto sameTrack = &source == &target;
	if (sameTrack && placement.getStart() == clip.getPosition().getStart()) return;
	const auto item = clip.itemID;
	s.begin("Move clip");
	if (!sameTrack) clip.moveTo(target);
	auto* moved = target.findClipForID(item);
	if (!moved)
	{
		s.edit->getUndoManager().undoCurrentTransactionOnly();
		throw std::invalid_argument("Tracktion refused the destination track");
	}
	moved->setPosition(placement);
	s.commit();
}

ClipId Session::duplicateClip(Revision expected, ClipId id, TrackId destination, Frame start)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& clip = s.clip(id).second;
	auto& target = s.track(destination);
	const auto placement = s.clipPlacement(clip, start);
	s.begin("Duplicate clip");
	auto* duplicate = te::insertClipCopy(target, te::ClipCopy::fromClip(clip).withNewItemID(*s.edit));
	if (!duplicate)
	{
		s.edit->getUndoManager().undoCurrentTransactionOnly();
		throw std::invalid_argument("Tracktion refused the clip duplicate");
	}
	duplicate->setPosition(placement);
	s.commit();
	return duplicate->itemID.getRawID();
}

void Session::deleteClip(Revision expected, ClipId id)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& clip = s.clip(id).second;
	s.begin("Delete clip and leave gap");
	clip.removeFromParent();
	s.commit();
}

bool Session::undo(Revision expected)
{
	state->checkRevision(expected);
	if (!state->edit->getUndoManager().undo()) return false;
	if (isPlaying() && hasEnabledOfflineEffect(*state->edit)) stop();
	state->commit();
	return true;
}

bool Session::redo(Revision expected)
{
	state->checkRevision(expected);
	if (!state->edit->getUndoManager().redo()) return false;
	if (isPlaying() && hasEnabledOfflineEffect(*state->edit)) stop();
	state->commit();
	return true;
}

void Session::save(Revision expected)
{
	state->checkRevision(expected);
	te::EditFileOperations files(*state->edit);
	if (!files.writeToFile(state->editFile, false))
		throw std::invalid_argument("Cannot save the Tracktion Edit");
}

}
