// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <cmath>
#include <set>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
const juce::Identifier projectSampleRate("soundscaperProjectSampleRate");

void ensureDirectory(const juce::File& directory)
{
	if (!directory.createDirectory().wasOk() || directory.isSymbolicLink())
		throw std::runtime_error("Cannot create a Tracktion directory");
}

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

void endTransaction(te::Edit& edit)
{
	for (auto* track : te::getAudioTracks(edit))
		track->dispatchPendingClipOrdering();
	edit.dispatchPendingUpdatesSynchronously();
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

Session::State::State(const juce::File& directory, const juce::File& stateDirectory, OpenMode mode, int requestedSampleRate)
	: directory(directory), editFile(directory.getChildFile("project.tracktionedit")),
	  engine(std::make_unique<HeadlessSettings>(stateDirectory),
	         nullptr, std::make_unique<SessionBehaviour>())
{
	auto tree = mode == OpenMode::create ? newProject(requestedSampleRate) : openProject();
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

Session::Session(const juce::File& directory, const juce::File& stateDirectory, OpenMode mode, int sampleRate)
	: state(std::make_unique<State>(directory, stateDirectory, mode, sampleRate)) {}

Revision Session::revision() const noexcept
{
	return state->revision;
}

ProjectView Session::snapshot() const
{
	const auto& s = *state;
	auto& history = s.edit->getUndoManager();
	ProjectView view{s.revision, s.sampleRate, history.canUndo(), history.canRedo(), {}};
	for (auto* track : te::getAudioTracks(*s.edit))
	{
		TrackView trackView{track->itemID.getRawID(), track->getName().toStdString(), {}};
		for (auto* clip : track->getClips())
		{
			const auto position = clip->getPosition();
			trackView.clips.push_back({
				clip->itemID.getRawID(), clip->getName().toStdString(),
				tracktion::toSamples(position.getStart(), s.sampleRate),
				tracktion::toSamples(position.getEnd(), s.sampleRate),
				tracktion::toSamples(position.getOffset(), s.sampleRate),
			});
		}
		view.tracks.push_back(std::move(trackView));
	}
	return view;
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
		s.edit->getUndoManager().undoCurrentTransactionOnly();
		throw std::runtime_error("Tracktion refused the audio track");
	}
	track->setName(juce::String::fromUTF8(name.data(), static_cast<int>(name.size())));
	s.commit();
	return track->itemID.getRawID();
}

TrackMix Session::trackMix(Revision expected, TrackId id) const
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& track = s.track(id);
	const auto* volume = track.getVolumePlugin();
	return {volume ? volume->getVolumeDb() : 0.0f, volume ? volume->getPan() : 0.0f,
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
	if (!source.copyFileTo(destination))
		throw std::runtime_error("Cannot copy the audio into the project");

	s.begin("Import audio");
	const auto offsetTime = tracktion::TimeDuration::fromSamples(offset, s.sampleRate);
	// Store the project-owned name directly. Tracktion's general file importer
	// calculates relative paths from the Edit file and can prepend "../" before
	// its first save, when that file does not exist yet.
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

void Session::trim(Revision expected, ClipId id, Frame start, Frame end)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto [track, clip] = s.clip(id);
	const auto current = clip.getPosition();
	const auto range = tracktion::TimeRange(s.position(start), s.position(end));
	if (start >= end || range.getStart() < current.getStart() || range.getEnd() > current.getEnd())
		throw std::invalid_argument("Trim must keep a nonempty portion of the clip");
	if (range == current.time)
		return;
	s.begin("Trim clip");
	clip.setPosition({range, current.offset + (range.getStart() - current.getStart())});
	s.commit();
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
		s.edit->getUndoManager().undoCurrentTransactionOnly();
		throw std::runtime_error("Tracktion refused the clip split");
	}
	s.commit();
	return right->itemID.getRawID();
}

bool Session::undo(Revision expected)
{
	state->checkRevision(expected);
	if (!state->edit->getUndoManager().undo())
		return false;
	state->commit();
	return true;
}

bool Session::redo(Revision expected)
{
	state->checkRevision(expected);
	if (!state->edit->getUndoManager().redo())
		return false;
	state->commit();
	return true;
}

void Session::save(Revision expected)
{
	state->checkRevision(expected);
	te::EditFileOperations files(*state->edit);
	if (!files.writeToFile(state->editFile, false))
		throw std::runtime_error("Cannot save the Tracktion Edit");
}

void Session::archive(Revision expected, const juce::File& output)
{
	auto& s = *state;
	s.checkRevision(expected);
	if (output.exists() || output.isSymbolicLink() || !output.hasFileExtension("zip"))
		throw std::invalid_argument("Archive requires a new ZIP file");

	const juce::TemporaryFile snapshot(".tracktionedit");
	te::EditFileOperations files(*s.edit);
	if (!files.writeToFile(snapshot.getFile(), false))
		throw std::runtime_error("Cannot stage the Tracktion archive Edit");
	juce::ZipFile::Builder archive;
	archive.addFile(snapshot.getFile(), 1, "project.tracktionedit");
	static constexpr char archiveInfo[] = "{\"archive_type\":1}";
	archive.addEntry(std::make_unique<juce::MemoryInputStream>(archiveInfo, sizeof(archiveInfo) - 1, false), 1,
	                 "project_info.json", juce::Time::getCurrentTime());

	// The Edit already refers to owned relative media. Pack those references
	// directly and exclude caches, files left by undo, and unrelated contents.
	std::set<juce::File> sources;
	for (auto* track : te::getAudioTracks(*s.edit))
		for (auto* clip : track->getClips())
			sources.insert(clip->getSourceFileReference().getFile());
	for (const auto& file : sources)
	{
		const auto path = juce::String(mediaDirectory) + "/" + file.getFileName();
		if (ownedMediaFile(s.directory, path) != file)
			throw std::runtime_error("Cannot read the Tracktion archive media");
		archive.addFile(file, 1, path);
	}

	juce::TemporaryFile staging(output);
	{
		auto stream = staging.getFile().createOutputStream();
		if (!stream || !archive.writeToStream(*stream, nullptr))
			throw std::runtime_error("Cannot write the Tracktion archive");
		stream->flush();
		if (stream->getStatus().failed())
			throw std::runtime_error("Cannot finish the Tracktion archive");
	}
	if (!staging.overwriteTargetFileWithTemporary())
		throw std::runtime_error("Cannot publish the Tracktion archive");
}

void Session::render(Revision expected, const juce::File& output, Frame start, Frame end,
                     const std::atomic_bool* cancelled)
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto from = s.position(start);
	const auto until = s.position(end);
	if (end <= start || output.exists() || output.isSymbolicLink() || !output.hasFileExtension("wav"))
		throw std::invalid_argument("Render requires a valid range and a new WAV file");
	const auto isCancelled = [cancelled] { return cancelled != nullptr && cancelled->load(); };
	if (isCancelled())
		throw std::runtime_error("The Tracktion render was cancelled");
	s.edit->flushState();
	const auto renderEdit = s.makeEdit(s.edit->state.createCopy(), te::Edit::forRendering);
	if (renderEdit == nullptr)
		throw std::runtime_error("Cannot detach the Tracktion Edit for rendering");

	juce::TemporaryFile staging(output);
	te::Renderer::Parameters params(*renderEdit);
	params.destFile = staging.getFile();
	params.audioFormat = s.engine.getAudioFileFormatManager().getWavFormat();
	params.time = {from, until};
	params.tracksToDo = te::toBitSet(te::getAllTracks(*renderEdit));
	params.sampleRateForAudio = s.sampleRate;
	params.blockSizeForAudio = 128;
	params.bitDepth = 16;
	params.canRenderInMono = false;
	params.checkNodesForAudio = false;
	params.useMasterPlugins = true;
	auto task = te::render_utils::createRenderTask(params, "Soundscaper render", nullptr, nullptr);
	if (task == nullptr)
		throw std::runtime_error("Tracktion could not prepare the render");
	task->setCancellationCheck(isCancelled);
	while (task->runJob() != juce::ThreadPoolJob::jobHasFinished) {}
	if (isCancelled())
		throw std::runtime_error("The Tracktion render was cancelled");
	if (task->errorMessage.isNotEmpty() || !staging.getFile().existsAsFile()
	    || !staging.overwriteTargetFileWithTemporary())
		throw std::runtime_error("Tracktion could not render the Edit");
}
}
