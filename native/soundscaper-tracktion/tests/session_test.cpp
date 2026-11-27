// SPDX-License-Identifier: AGPL-3.0-only

#include "project_archive.h"
#include "session_test_support.h"
#include "session.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>

#if JUCE_WINDOWS
#include <juce_audio_devices/juce_audio_devices.h>
#include <algorithm>

static_assert(JUCE_ASIO && JUCE_ASIO_USE_EXTERNAL_SDK, "Use the authenticated external ASIO SDK on Windows");
#endif

#include <array>
#include <chrono>
#include <iostream>
#include <thread>
#include <stdexcept>
#include <utility>

using namespace soundscaper::tracktion_backend;
using soundscaper::tracktion_backend::test::readProjectSnapshot;
using soundscaper::tracktion_backend::test::require;
using soundscaper::tracktion_backend::test::writeFixture;

namespace
{
void verifyHostedAutomation(const juce::File& root)
{
	const auto source = root.getChildFile("hosted-automation.wav");
	writeFixture(source, 24'576);
	Session session(root.getChildFile("hosted-automation-project"), root.getChildFile("hosted-automation-state"), OpenMode::create, 48000);
	const auto track = readProjectSnapshot(session).tracks.front().id;
	session.insertAudio(0, track, source, 0, 0, std::nullopt);
	session.preparePlayback(128);
	const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
	while (!session.playbackReady() && std::chrono::steady_clock::now() < deadline)
		std::this_thread::sleep_for(std::chrono::milliseconds(10));
	require(session.playbackReady(), "hosted automation primes its media");
	juce::AudioBuffer<float> block(2, 128);
	juce::MidiBuffer midi;
	session.play(4096);
	require(session.processPlaybackBlock(block, midi), "prepare the existing hosted graph");
	session.stop();
	session.setAutomationPoint(1, track, TrackParameter::gainDb, std::nullopt, {0, 0.0f, 1.0f});
	session.setAutomationPoint(2, track, TrackParameter::gainDb, std::nullopt, {8192, -12.0f, 0.0f});
	session.play(0);
	for (int index = 0; index < 128; ++index)
	{
		require(session.processPlaybackBlock(block, midi), "hosted device processes the automation curve");
		if (index == 32) require(std::abs(block.getSample(0, 0) - 0.375f) < 0.001f, "hosted playback holds gain before the change");
		if (index == 96) require(std::abs(block.getSample(0, 0) - 0.0942f) < 0.001f, "hosted playback follows the edited gain curve");
	}
	session.stop();
	const auto copy = session.duplicateTrack(3, track);
	session.render(4, root.getChildFile("automation-before-undo.wav"), 0, 24'576);
	require(session.undo(4) && readProjectSnapshot(session).tracks.size() == 1, "export leaves duplicate track as the last undo action");
	session.render(5, root.getChildFile("automation-before-redo.wav"), 0, 24'576);
	require(session.redo(5) && readProjectSnapshot(session).tracks.at(1).id == copy, "export preserves the redo of the duplicate track");
}

void verifyRender(const juce::File& file)
{
	juce::WavAudioFormat format;
	std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(file.createInputStream().release(), true));
	require(reader != nullptr, "open rendered PCM");
	require(reader->sampleRate == 48000 && reader->numChannels == 2 && reader->lengthInSamples == 1537,
		"render geometry");
	juce::AudioBuffer<float> pcm(2, 1537);
	require(reader->read(&pcm, 0, pcm.getNumSamples(), 0, true, true), "read rendered PCM");
	for (int frame = 0; frame < pcm.getNumSamples(); ++frame)
	{
		const auto expected = frame < 257 || frame >= 1001 ? 0.0f : frame < 437 ? 0.125f : 0.375f;
		// JUCE scales linear PCM to a float using the signed integer range.
		if (std::abs(pcm.getSample(0, frame) - expected) >= 1.0f / 32768
			|| std::abs(pcm.getSample(1, frame) + expected / 2) >= 1.0f / 32768)
			throw std::runtime_error("PCM mismatch at frame " + std::to_string(frame)
				+ " with expected left " + std::to_string(expected)
				+ ", got left " + std::to_string(pcm.getSample(0, frame))
				+ " and right " + std::to_string(pcm.getSample(1, frame)));
	}
}

void verifyClipPlacement(const juce::File& root)
{
	const auto project = root.getChildFile("placement-project");
	const auto settings = root.getChildFile("placement-settings");
	const auto source = root.getChildFile("placement.wav");
	writeFixture(source);
	ClipId copy;
	{
		Session session(project, settings, OpenMode::create, 48000);
		const auto first = readProjectSnapshot(session).tracks.front().id;
		const auto original = session.insertAudio(0, first, source, 41, 123, 128);
		const auto second = session.addTrack(1, "Destination");
		session.moveClip(2, original, first, 41);
		require(session.revision() == 2, "an unchanged clip placement leaves history alone");
		session.moveClip(2, original, second, 258);
		require(session.undo(3), "undo the cross-track move");
		const auto before = readProjectSnapshot(session);
		require(before.tracks[1].clips.empty() && before.tracks[0].clips.at(0).id == original
			&& before.tracks[0].clips.at(0).start == 41, "undo restores original owner and timeline position");
		require(session.redo(4), "redo the cross-track move");
		const auto after = readProjectSnapshot(session);
		const auto& moved = after.tracks[1].clips.at(0);
		require(after.tracks[0].clips.empty() && moved.id == original && moved.start == 258
			&& moved.end == 386 && moved.sourceOffset == 123, "move preserves clip identity and source interval");
		copy = session.duplicateClip(5, original, second, 451);
		session.deleteClip(6, original);
		const auto erased = readProjectSnapshot(session);
		require(erased.tracks[1].clips.size() == 1 && erased.tracks[1].clips[0].start == 451,
			"delete leaves the following clip in place");
		require(session.undo(7) && readProjectSnapshot(session).tracks[1].clips.size() == 2, "undo restores the deleted clip");
		require(session.redo(8), "redo the clip deletion");
		session.save(9);
	}
	Session reopened(project, settings, OpenMode::open, 0);
	const auto snapshot = readProjectSnapshot(reopened);
	const auto& saved = snapshot.tracks.at(1).clips.at(0);
	require(saved.id == copy && saved.start == 451 && saved.end == 579 && saved.sourceOffset == 123,
		"the copied interval survives reopening");
	require(project.getChildFile("media").getNumberOfChildFiles(juce::File::findFiles) == 1,
		"duplicates share the project-owned media body");
	const auto mix = root.getChildFile("placed.wav");
	reopened.render(0, mix, 0, 600);
	juce::WavAudioFormat format;
	std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(mix.createInputStream().release(), true));
	juce::AudioBuffer<float> pcm(2, 600);
	require(reader && reader->read(&pcm, 0, 600, 0, true, true), "read the placed mix");
	require(pcm.getSample(0, 450) == 0.0f && std::abs(pcm.getSample(0, 451) - 0.125f) < 1.0f / 32768
		&& pcm.getSample(0, 579) == 0.0f, "the placed clip renders at its exact boundaries");
}

void verifyRangeDelete(const juce::File& root)
{
	const auto directory = root.getChildFile("range-project");
	const auto settings = root.getChildFile("range-settings");
	const auto source = root.getChildFile("range.wav");
	writeFixture(source);
	TrackId first;
	{
		Session session(directory, settings, OpenMode::create, 48000);
		first = readProjectSnapshot(session).tracks.front().id;
		const auto original = session.insertAudio(0, first, source, 300, 50, 300);
		session.insertAudio(1, first, source, 420, 0, 60);
		const auto later = session.insertAudio(2, first, source, 700, 0, 50);
		const auto second = session.addTrack(3, "Second track");
		session.insertAudio(4, second, source, 450, 20, 100);
		const auto check = [&](RangeDeleteMode mode, Frame rightStart, Frame laterStart)
		{
			const auto revision = session.revision();
			session.deleteRange(revision, mode, mode == RangeDeleteMode::allTracks ? std::nullopt : std::optional{first}, 400, 500);
			const auto view = readProjectSnapshot(session);
			const auto& main = view.tracks.at(0).clips;
			const auto& auxiliary = view.tracks.at(1).clips.at(0);
			require(view.revision == revision + 1 && main.size() == 3, "range delete is one edit");
			require(main.at(0).id == original && main.at(0).end == 400 && main.at(1).id != original
				&& main.at(1).start == rightStart && main.at(1).end == rightStart + 100 && main.at(1).sourceOffset == 250,
				"range deletion keeps both outside source intervals");
			require(main.at(2).id == later && main.at(2).start == laterStart, "range ripple moves only subsequent clips");
			if (mode == RangeDeleteMode::allTracks)
				require(auxiliary.start == 400 && auxiliary.end == 450 && auxiliary.sourceOffset == 70,
					"all-track ripple keeps the second track's surviving source interval");
			else require(auxiliary.start == 450 && auxiliary.end == 550, "track-local ranges leave other tracks alone");
			require(session.undo(view.revision) && readProjectSnapshot(session).tracks.at(0).clips.at(0).end == 600,
				"one undo restores the original clip");
		};
		check(RangeDeleteMode::leaveGap, 500, 700);
		check(RangeDeleteMode::perClip, 400, 700);
		check(RangeDeleteMode::track, 400, 600);
		check(RangeDeleteMode::allTracks, 400, 600);
		session.deleteRange(session.revision(), RangeDeleteMode::track, first, 301, 302);
		const auto sampleEdit = readProjectSnapshot(session);
		const auto& clips = sampleEdit.tracks.at(0).clips;
		require(clips.at(0).start == 300 && clips.at(0).end == 301 && clips.at(1).start == 301
			&& clips.at(1).end == 599 && clips.at(1).sourceOffset == 52, "one-frame ripple keeps a one-frame fragment");
		require(session.undo(sampleEdit.revision), "undo one-frame range deletion");
		session.save(session.revision());
	}
	const auto file = directory.getChildFile("project.tracktionedit");
	const auto xml = juce::parseXML(file);
	auto* track = xml ? xml->getChildByName("TRACK") : nullptr;
	auto* clip = track ? track->getChildByName("AUDIOCLIP") : nullptr;
	require(clip != nullptr, "open the native range fixture");
	clip->setAttribute("groupID", "9999");
	require(xml->writeTo(file), "write the grouped range fixture");
	Session grouped(directory, settings, OpenMode::open, 0);
	grouped.addTrack(0, "Redo witness");
	require(grouped.undo(1), "prepare existing redo history");
	bool rejected = false;
	try { grouped.deleteRange(2, RangeDeleteMode::track, first, 400, 500); }
	catch (const std::invalid_argument&) { rejected = true; }
	const auto unchanged = readProjectSnapshot(grouped);
	require(rejected && unchanged.revision == 2 && unchanged.tracks.at(0).clips.size() == 3
		&& grouped.redo(2) && readProjectSnapshot(grouped).tracks.size() == 3, "failed range split restores clips and prior redo history");
}

void rejectArchive(const juce::File& archive, const juce::File& target, std::int64_t limit)
{
	bool rejected = false;
	try { extractProjectArchive(archive, target, limit); }
	catch (const std::invalid_argument&) { rejected = true; }
	require(rejected && !target.exists(), "invalid archive must leave no project files");
}

void runSessionTest(const juce::File& root)
{
	const auto workspace = root.getChildFile("project");
	const auto state = root.getChildFile("runtime");
	const auto source = root.getChildFile("source.wav");
	writeFixture(source);

	ClipId original = 0;
	ClipId right = 0;
	{
		Session session(workspace, state, OpenMode::create, 48000);
		const auto empty = readProjectSnapshot(session);
		require(empty.revision == 0 && empty.tracks.front().clips.empty() && !empty.canUndo, "empty Edit");
		original = session.insertAudio(empty.revision, empty.tracks.front().id, source, 257, 131, 744);
		const auto imported = readProjectSnapshot(session);
		require(imported.revision == 1 && imported.tracks.front().clips.size() == 1 && imported.canUndo, "import undo transaction");
		require(imported.tracks.front().clips.front().id == original && imported.tracks.front().clips.front().sourceOffset == 131,
			"import sample geometry");

		bool rejected = false;
		try { session.split(empty.revision, original, 513); }
		catch (const std::invalid_argument&) { rejected = true; }
		require(rejected && readProjectSnapshot(session).revision == 1, "stale mutation must leave the Edit intact");

		session.trim(1, original, 371, 1001);
		const auto trimmed = readProjectSnapshot(session);
		require(trimmed.tracks.front().clips.front().start == 371 && trimmed.tracks.front().clips.front().sourceOffset == 245, "trim preserves source sync");
		require(session.undo(2), "undo trim");
		right = session.split(3, original, 513);
		const auto split = readProjectSnapshot(session);
		require(split.revision == 4 && split.tracks.front().clips.size() == 2 && split.tracks.front().clips[0].end == 513
			&& split.tracks.front().clips[1].start == 513 && split.tracks.front().clips[1].sourceOffset == 387
			&& split.tracks.front().clips[1].id == right, "split preserves sample geometry");
		require(session.undo(4) && readProjectSnapshot(session).tracks.front().clips.size() == 1, "undo split");
		require(session.redo(5) && readProjectSnapshot(session).tracks.front().clips.size() == 2, "redo split");
		const auto auxiliary = session.addTrack(6, "Auxiliary");
		require(readProjectSnapshot(session).tracks[1].id == auxiliary, "new audio track");
		require(session.undo(7) && readProjectSnapshot(session).tracks.size() == 1, "track undo");
		require(session.redo(8) && readProjectSnapshot(session).tracks.size() == 2, "track redo");
		session.save(9);
		require(workspace.getChildFile("project.tracktionedit").existsAsFile(), "native Edit file");
	}

	const auto moved = root.getChildFile("renamed-project");
	std::cout << "Saved Tracktion project with sample-accurate edits." << std::endl;
	juce::File unarchivedProject;
	require(workspace.moveFileTo(moved), "move native project folder");
	require(source.deleteFile(), "remove original source");
	{
		Session reopened(moved, state, OpenMode::open, 0);
		const auto saved = readProjectSnapshot(reopened);
		require(saved.sampleRate == 48000 && saved.tracks.front().clips.size() == 2 && saved.tracks.front().clips[0].id == original
			&& saved.tracks.front().clips[1].id == right && !saved.canUndo, "reopen the native Edit");
		const auto destination = root.getChildFile("render.wav");
		require(saved.tracks.size() == 2 && saved.tracks[1].name == "Auxiliary", "second track survives reopen");
		const std::atomic_bool cancelled { true };
		bool rejected = false;
		try { reopened.render(saved.revision, destination, 0, 1537, &cancelled); }
		catch (const std::runtime_error&) { rejected = true; }
		require(rejected && !destination.existsAsFile(), "cancelled render publishes no output");
		reopened.render(saved.revision, destination, 0, 1537);
		verifyRender(destination);

		reopened.preparePlayback(128);
		const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
		while (!reopened.playbackReady() && std::chrono::steady_clock::now() < deadline)
			std::this_thread::sleep_for(std::chrono::milliseconds(10));
		require(reopened.playbackReady(), "hosted graph primes its sources");
		reopened.play(600);
		juce::AudioBuffer<float> block(2, 128);
		juce::MidiBuffer midi;
		bool heardAudio = false;
		for (int index = 0; index < 3; ++index)
		{
			require(reopened.processPlaybackBlock(block, midi), "hosted device processes a stereo block");
			heardAudio |= block.getMagnitude(0, block.getNumSamples()) > 0.1f;
		}
		require(heardAudio, "Tracktion transport renders from the seek frame");
		reopened.stop();
		reopened.seek(600);
		require(reopened.playbackPosition() == 600, "seek uses the project sample frame");
		reopened.setLoop(true, 450, 975);
		reopened.play(600);
		for (int index = 0; index < 16; ++index)
			require(reopened.processPlaybackBlock(block, midi), "hosted loop processes audio");
		const auto wrappedPosition = reopened.playbackPosition();
		require(wrappedPosition >= 450 && wrappedPosition <= 975, "hosted playhead wraps within the loop");
		reopened.stop();
		std::cout << "Rendered the reopened project and checked hosted playback." << std::endl;
	}
	{
		Session savedProject(moved, state, OpenMode::open, 0);
		const auto archive = root.getChildFile("project.zip");
		savedProject.archive(savedProject.revision(), archive);
		std::cout << "Wrote the Tracktion project ZIP." << std::endl;
		const auto extracted = root.getChildFile("archive-copy");
		rejectArchive(archive, root.getChildFile("oversized-archive"), 64);
		extractProjectArchive(archive, extracted, 4 * 1024 * 1024);
		require(extracted.getChildFile("project.tracktionedit").existsAsFile(), "archive contains the native Edit");
		const auto archiveInfo = juce::JSON::parse(extracted.getChildFile("project_info.json"));
		require(static_cast<int>(archiveInfo.getProperty("archive_type", {})) == 1, "archive retains Tracktion's project metadata");
		const auto archiveMedia = extracted.getChildFile("media").findChildFiles(juce::File::findFiles, false, "*.wav");
		require(archiveMedia.size() == 1, "archive contains exactly the referenced audio");
		unarchivedProject = extracted;
		const auto invalid = root.getChildFile("invalid.zip");
		{
			juce::ZipFile::Builder builder;
			builder.addFile(extracted.getChildFile("project.tracktionedit"), 0, "project.tracktionedit");
			builder.addFile(archiveMedia[0], 0, "../escaped.wav");
			auto output = invalid.createOutputStream();
			require(output != nullptr && builder.writeToStream(*output, nullptr), "write traversal archive fixture");
		}
		rejectArchive(invalid, root.getChildFile("invalid-project"), 4 * 1024 * 1024);
		require(!root.getChildFile("escaped.wav").exists(), "archive cannot write outside its project");
		std::cout << "Extracted and validated the Tracktion project ZIP." << std::endl;
	}
	{
		Session fromArchive(unarchivedProject, state, OpenMode::open, 0);
		const auto view = readProjectSnapshot(fromArchive);
		require(view.tracks.size() == 2 && view.tracks.front().clips.size() == 2,
			"archived project reopens with its edits");
		const auto destination = root.getChildFile("archive-render.wav");
		fromArchive.render(view.revision, destination, 0, 1537);
		verifyRender(destination);
	}
}

void verifyHostedRecording(const juce::File& root)
{
	constexpr int blockFrames = 128;
	constexpr int finalFrames = 37;
	constexpr int fullBlocks = 16;
	constexpr Frame start = 257;
	const auto project = root.getChildFile("hosted-recording");
	Session session(project, root.getChildFile("recording-runtime"), OpenMode::create, 48000);
	const auto track = readProjectSnapshot(session).tracks.front().id;
	session.preparePlayback(blockFrames, true);
	session.startRecording(0, track, start);
	require(session.isRecording(), "hosted input records to the selected track");
	juce::AudioBuffer<float> block(2, blockFrames);
	juce::MidiBuffer midi;
	const auto capturedSample = [](int frame) { return static_cast<float>(frame % 251 - 125) / 512; };
	float input[blockFrames];
	for (int index = 0; index < fullBlocks; ++index)
	{
		for (int i = 0; i < blockFrames; ++i) input[i] = capturedSample(index * blockFrames + i);
		require(session.processPlaybackBlock(block, midi, input), "hosted input accepts PCM");
		require(block.getMagnitude(0, blockFrames) == 0, "hosted microphone has monitoring off");
	}
	block.setSize(2, finalFrames, false, false, true);
	for (int i = 0; i < finalFrames; ++i) input[i] = capturedSample(fullBlocks * blockFrames + i);
	require(session.processPlaybackBlock(block, midi, input), "hosted input accepts a short final block");
	const auto take = session.finishRecording(0, false);
	const auto view = readProjectSnapshot(session);
	require(take.has_value() && view.revision == 1 && view.tracks.front().clips.size() == 1, "hosted take is one Edit mutation");
	const auto clip = view.tracks.front().clips.front();
	if (clip.start != start || clip.end != start + blockFrames * fullBlocks + finalFrames)
		throw std::runtime_error("Hosted take has frame range " + std::to_string(clip.start) + " to " + std::to_string(clip.end));
	const auto media = project.getChildFile("media").findChildFiles(juce::File::findFiles, false, "*.wav");
	require(media.size() == 1, "hosted take is owned project WAV media");
	juce::WavAudioFormat format;
	std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(media[0].createInputStream().release(), true));
	require(reader && reader->numChannels == 1 && reader->lengthInSamples == clip.end - clip.start, "hosted file has exact mono geometry");
	juce::AudioBuffer<float> pcm(1, static_cast<int>(reader->lengthInSamples));
	require(reader->read(&pcm, 0, pcm.getNumSamples(), 0, true, false), "read hosted take WAV samples");
	for (int i = 0; i < pcm.getNumSamples(); ++i)
		require(std::abs(pcm.getSample(0, i) - capturedSample(i)) < 1.0f / 32768, "hosted file preserves input samples");
	require(session.undo(1) && readProjectSnapshot(session).tracks.front().clips.empty(), "undo hosted input take");
	require(session.redo(2), "redo hosted input take");
	const auto redone = readProjectSnapshot(session).tracks.front().clips;
	require(redone.size() == 1 && redone.front().id == *take, "redo restores the same hosted take");
	session.save(3);
	const auto saved = project.getChildFile("project.tracktionedit").loadFileAsString();
	require(saved.contains("source=\"media/" + media[0].getFileName() + "\""), "redo restores the portable recording source reference");
	session.startRecording(3, track, 0);
	require(session.processPlaybackBlock(block, midi, input), "hosted input can record again");
	require(!session.finishRecording(3, true) && session.revision() == 3, "discard hosted input without publishing a revision");
	require(project.getChildFile("media").getNumberOfChildFiles(juce::File::findFiles) == 1, "discard removes just the new hosted media");
}

class EffectFixtureHost final : public OfflineEffectHost
{
public:
	explicit EffectFixtureHost(OfflineEffectIdentity key, bool fails = false) : identity(std::move(key)), failing(fails) {}

	std::unique_ptr<OfflineEffectInstance> openStereo(const OfflineEffectIdentity& key, int rate, int frames) override
	{
		require(key == identity && rate == 48000 && frames == 128, "render must admit the exact effect and geometry");
		++opened;
		return std::make_unique<Instance>(failing);
	}

	int opened = 0;

private:
	struct Instance final : OfflineEffectInstance
	{
		explicit Instance(bool fails) : failing(fails) {}
		int latencyFrames() const override { return static_cast<int>(leftDelay.size()); }
		bool process(std::span<float> left, std::span<float> right) override
		{
			for (std::size_t frame = 0; frame < left.size(); ++frame)
			{
				left[frame] = std::exchange(leftDelay[cursor], left[frame] * 2.0f);
				right[frame] = std::exchange(rightDelay[cursor], right[frame] * 2.0f);
				cursor = (cursor + 1) % leftDelay.size();
			}
			return !failing;
		}
		std::array<float, 32> leftDelay{};
		std::array<float, 32> rightDelay{};
		std::size_t cursor = 0;
		bool failing;
	};

	OfflineEffectIdentity identity;
	bool failing;
};

void verifyOfflineEffect(const juce::File& root)
{
	const auto project = root.getChildFile("offline-effect-project");
	const auto runtime = root.getChildFile("offline-effect-runtime");
	const auto source = root.getChildFile("offline-effect-source.wav");
	writeFixture(source);
	const OfflineEffectIdentity effect{"clap", "org.soundscaper.fixture.deterministic-gain", std::string(64, 'a')};
	TrackId track;
	std::uint64_t slot;
	{
		Session session(project, runtime, OpenMode::create, 48000);
		track = readProjectSnapshot(session).tracks.front().id;
		session.insertAudio(0, track, source, 0, 0, 1024);
		slot = session.insertOfflineEffect(1, track, effect);
		const auto added = session.offlineEffects(2, track);
		require(added.size() == 1 && added.front().id == slot, "Tracktion owns the effect slot ID");
		require(session.undo(2) && session.offlineEffects(3, track).empty(), "undo removes the Tracktion effect");
		require(session.redo(3), "redo the Tracktion effect");
		const auto redone = session.offlineEffects(4, track);
		require(redone.size() == 1 && redone.front().id == slot, "redo restores the same effect ID");
		session.save(4);
	}
	Session reopened(project, runtime, OpenMode::open, 0);
	const auto slots = reopened.offlineEffects(0, track);
	require(slots.size() == 1 && slots.front().id == slot && slots.front().effect == effect,
		"reopening preserves the effect's portable installation identity");
	const auto missing = root.getChildFile("missing-effect.wav");
	bool rejected = false;
	try { reopened.render(0, missing, 0, 1024); }
	catch (const std::invalid_argument&) { rejected = true; }
	require(rejected && !missing.exists(), "an unavailable effect must not silently export a dry mix");

	EffectFixtureHost host(effect);
	const auto output = root.getChildFile("isolated-effect.wav");
	reopened.render(0, output, 0, 1024, nullptr, &host);
	require(host.opened == 1, "one effect processor is opened per detached render");
	juce::WavAudioFormat format;
	std::unique_ptr<juce::AudioFormatReader> reader(format.createReaderFor(output.createInputStream().release(), true));
	juce::AudioBuffer<float> samples(2, 1024);
	require(reader && reader->read(&samples, 0, 1024, 0, true, true), "read the completed effect render");
	constexpr auto pcmTolerance = 2.0f / 32768;
	require(std::abs(samples.getSample(0, 128) - 0.25f) < pcmTolerance
		&& std::abs(samples.getSample(1, 512) + 0.375f) < pcmTolerance, "effect result belongs in the Tracktion mix");
	if (std::abs(samples.getSample(0, 310) - 0.25f) >= pcmTolerance
		|| std::abs(samples.getSample(0, 311) - 0.75f) >= pcmTolerance)
		throw std::runtime_error("Tracktion did not compensate the isolated effect delay around frame 311: "
			+ std::to_string(samples.getSample(0, 310)) + ", " + std::to_string(samples.getSample(0, 311)));
	EffectFixtureHost failedHost(effect, true);
	const auto failed = root.getChildFile("failed-effect.wav");
	rejected = false;
	try { reopened.render(0, failed, 0, 1024, nullptr, &failedHost); }
	catch (const std::invalid_argument&) { rejected = true; }
	require(rejected && !failed.exists(), "failed effect PCM must not be published");
	reopened.removeOfflineEffect(0, track, slot);
	require(reopened.offlineEffects(1, track).empty(), "remove the saved offline effect");
	require(reopened.undo(1), "undo effect removal");
	const auto restored = reopened.offlineEffects(2, track);
	require(restored.size() == 1 && restored.front().id == slot, "undo removal restores the same effect slot");
}
}

int main()
{
	std::cout << "Starting the Tracktion session test." << std::endl;
	juce::ScopedJuceInitialiser_GUI juceLifetime;
	const auto root = juce::File::getSpecialLocation(juce::File::tempDirectory)
		.getNonexistentChildFile("soundscaper-tracktion-test", "", false);
	if (!root.createDirectory().wasOk())
		return 1;
	try
	{
#if JUCE_WINDOWS
		juce::AudioDeviceManager manager;
		require(std::ranges::any_of(manager.getAvailableDeviceTypes(), [](const auto* type)
		{
			return type->getTypeName() == "ASIO" && !type->hasSeparateInputsAndOutputs();
		}), "Windows builds must register the ASIO host in JUCE's device manager");
#endif
		runSessionTest(root);
		verifyClipPlacement(root);
		verifyHostedAutomation(root);
		verifyRangeDelete(root);
		verifyHostedRecording(root);
		verifyOfflineEffect(root);
		root.deleteRecursively();
		std::cout << "Tracktion session editing, rendering and hosted playback passed.\n";
		return 0;
	}
	catch (const std::exception& error)
	{
		std::cerr << error.what() << '\n';
		root.deleteRecursively();
		return 1;
	}
}
