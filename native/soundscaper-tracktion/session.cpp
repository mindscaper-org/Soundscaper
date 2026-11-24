// SPDX-License-Identifier: AGPL-3.0-only

#include "session.h"

#include <tracktion_engine/tracktion_engine.h>

#include <cmath>
#include <set>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace te = tracktion::engine;

namespace
{
const juce::Identifier projectSampleRate("soundscaperProjectSampleRate");
constexpr auto mediaDirectory = "media";

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

class HeadlessBehaviour final : public te::EngineBehaviour
{
public:
	bool autoInitialiseDeviceManager() override { return false; }
	bool shouldLoadPlugin(te::ExternalPlugin&) override { return false; }
};

bool admitsSampleRate(int sampleRate)
{
	return sampleRate >= 8000 && sampleRate <= 192000;
}

void endTransaction(te::Edit& edit)
{
	edit.dispatchPendingUpdatesSynchronously();
	edit.getUndoManager().beginNewTransaction();
}
}

struct Session::State
{
	State(const juce::File& directory, const juce::File& stateDirectory, OpenMode mode, int requestedSampleRate)
		: directory(directory), editFile(directory.getChildFile("project.tracktionedit")),
		  engine(std::make_unique<HeadlessSettings>(stateDirectory),
		         nullptr, std::make_unique<HeadlessBehaviour>())
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
		endTransaction(*edit);
		edit->getUndoManager().clearUndoHistory();
	}

	std::unique_ptr<te::Edit> makeEdit(juce::ValueTree tree, te::Edit::EditRole role)
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

	juce::ValueTree newProject(int rate)
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

	juce::ValueTree openProject() const
	{
		if (directory.isSymbolicLink() || editFile.isSymbolicLink() || !editFile.existsAsFile()
		    || editFile.getSize() > 16 * 1024 * 1024)
			throw std::invalid_argument("The Tracktion Edit is missing or too large");
		const auto xml = juce::parseXML(editFile);
		if (xml == nullptr || !xml->hasTagName("EDIT") || !xml->hasAttribute(projectSampleRate.toString()))
			throw std::invalid_argument("The file is not an experimental Soundscaper Tracktion Edit");
		return juce::ValueTree::fromXml(*xml);
	}

	tracktion::TimePosition position(Frame frame) const
	{
		const auto end = tracktion::toSamples(te::Edit::getMaximumEditEnd(), sampleRate);
		if (frame < 0 || frame > end)
			throw std::invalid_argument("Timeline frame is outside the Edit");
		return tracktion::TimePosition::fromSamples(frame, sampleRate);
	}

	void checkRevision(Revision expected) const
	{
		if (expected != revision)
			throw std::invalid_argument("The Tracktion Edit revision has changed");
	}

	te::AudioTrack& track(TrackId id) const
	{
		for (auto* track : te::getAudioTracks(*edit))
			if (track->itemID.getRawID() == id)
				return *track;
		throw std::invalid_argument("Unknown Tracktion audio track");
	}

	std::pair<te::AudioTrack&, te::Clip&> clip(ClipId id) const
	{
		for (auto* track : te::getAudioTracks(*edit))
			for (auto* item : track->getClips())
				if (item->itemID.getRawID() == id)
					return {*track, *item};
		throw std::invalid_argument("Unknown Tracktion clip");
	}

	void begin(const char* name)
	{
		edit->getUndoManager().beginNewTransaction(name);
	}

	void commit()
	{
		endTransaction(*edit);
		++revision;
	}

	juce::File directory;
	juce::File editFile;
	te::Engine engine;
	std::unique_ptr<te::Edit> edit;
	Revision revision = 0;
	int sampleRate = 0;
	te::HostedAudioDeviceInterface* playback = nullptr;
	int playbackBlockFrames = 0;
};

Session::Session(const juce::File& directory, const juce::File& stateDirectory, OpenMode mode, int sampleRate)
	: state(std::make_unique<State>(directory, stateDirectory, mode, sampleRate)) {}

Session::~Session() = default;

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

ClipId Session::insertAudio(Revision expected, TrackId trackId, const juce::File& source, Frame start, Frame offset, Frame count)
{
	auto& s = *state;
	s.checkRevision(expected);
	auto& track = s.track(trackId);
	const auto from = s.position(start);
	const auto maxFrame = tracktion::toSamples(te::Edit::getMaximumEditEnd(), s.sampleRate);
	if (count <= 0 || count > maxFrame - start || offset < 0 || !source.existsAsFile() || source.isSymbolicLink())
		throw std::invalid_argument("Invalid audio import or clip range");

	juce::WavAudioFormat format;
	std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(source.createInputStream().release(), true));
	if (reader == nullptr || reader->sampleRate != s.sampleRate || reader->numChannels < 1
	    || reader->numChannels > 2 || offset > reader->lengthInSamples
	    || count > reader->lengthInSamples - offset)
		throw std::invalid_argument("Import requires project-rate mono or stereo WAV with the requested source range");
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
	auto* clip = track.insertClipWithState(clipState, source.getFileNameWithoutExtension(),
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

	const choc::file::TempFile snapshot(choc::file::TempFile::createRandomFilename("soundscaper_tracktion_archive", ""));
	const juce::File folder(snapshot.file.string());
	const auto media = folder.getChildFile(mediaDirectory);
	ensureDirectory(media);

	// Only active media references travel. In particular the archive excludes
	// the runtime's caches, files left by undo, and unrelated folder contents.
	std::set<juce::File> sources;
	for (auto* track : te::getAudioTracks(*s.edit))
		for (auto* clip : track->getClips())
			sources.insert(clip->getSourceFileReference().getFile());
	for (const auto& file : sources)
		if (!file.existsAsFile() || !file.copyFileTo(media.getChildFile(file.getFileName())))
			throw std::runtime_error("Cannot stage the Tracktion archive media");

	te::EditFileOperations files(*s.edit);
	if (!files.writeToFile(folder.getChildFile("project.tracktionedit"), false))
		throw std::runtime_error("Cannot stage the Tracktion archive Edit");

	auto project = s.engine.getProjectManager().createNewProject(folder);
	if (project == nullptr || !project->isFolderBased())
		throw std::runtime_error("Cannot stage the Tracktion archive project");
	juce::TemporaryFile staging(output);
	te::ArchiveJob archive(te::ArchiveJob::Source{project.get()}, staging.getFile(),
	                       te::ArchiveJob::CompressionLevel::fastest);
	if (!archive.runSynchronously() || !staging.overwriteTargetFileWithTemporary())
		throw std::runtime_error("Cannot publish the Tracktion archive");
}

void Session::preparePlayback(int blockFrames)
{
	auto& s = *state;
	if (s.playback != nullptr || blockFrames < 32 || blockFrames > 4096)
		throw std::invalid_argument("Tracktion playback requires one device block size from 32 to 4096");
	auto& devices = s.engine.getDeviceManager();
	auto& playback = devices.getHostedAudioDeviceInterface();
	te::HostedAudioDeviceInterface::Parameters format;
	format.sampleRate = s.sampleRate;
	format.blockSize = blockFrames;
	format.inputChannels = 0;
	format.outputChannels = 2;
	playback.initialise(format);
	playback.prepareToPlay(format.sampleRate, format.blockSize);
	devices.dispatchPendingUpdates();
	s.edit->dispatchPendingUpdatesSynchronously();
	s.edit->getTransport().ensureContextAllocated();
	s.playbackBlockFrames = blockFrames;
	s.playback = &playback;
}

bool Session::playbackReady() const
{
	auto& s = *state;
	if (s.playback == nullptr)
		return false;
	auto& cache = s.engine.getAudioFileManager().cache;
	for (auto* track : te::getAudioTracks(*s.edit))
		for (auto* clip : track->getClips())
		{
			const auto file = clip->getSourceFileReference().getFile();
			if (!file.existsAsFile() || !cache.hasMappedReader(te::AudioFile(s.engine, file), 0))
				return false;
		}
	return true;
}

void Session::play(Frame start)
{
	auto& s = *state;
	if (s.playback == nullptr)
		throw std::invalid_argument("Prepare the Tracktion playback device before playing");
	auto& transport = s.edit->getTransport();
	transport.setPosition(s.position(start));
	transport.play(false);
}

void Session::seek(Frame frame)
{
	state->edit->getTransport().setPosition(state->position(frame));
}

void Session::setLoop(bool enabled, Frame start, Frame end)
{
	auto& transport = state->edit->getTransport();
	if (enabled)
	{
		const auto from = state->position(start);
		const auto until = state->position(end);
		if (start >= end)
			throw std::invalid_argument("Loop must contain at least one frame");
		transport.setLoopRange({from, until});
	}
	transport.looping = enabled;
}

Frame Session::playbackPosition() const
{
	const auto& transport = state->edit->getTransport();
	auto* context = transport.getCurrentPlaybackContext();
	const auto position = transport.isPlaying() && context != nullptr
		? context->getAudibleTimelineTime()
		: transport.getPosition();
	return tracktion::toSamples(position, state->sampleRate);
}

void Session::stop()
{
	state->edit->getTransport().stop(false, false, false);
}

bool Session::processPlaybackBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) noexcept
{
	const auto& s = *state;
	audio.clear();
	if (s.playback == nullptr || audio.getNumChannels() != 2 || audio.getNumSamples() != s.playbackBlockFrames)
		return false;
	s.playback->processBlock(audio, midi);
	return true;
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
