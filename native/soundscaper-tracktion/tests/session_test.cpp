// SPDX-License-Identifier: AGPL-3.0-only

#include "project_archive.h"
#include "session.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>

#include <chrono>
#include <iostream>
#include <thread>
#include <stdexcept>

using namespace soundscaper::tracktion_backend;

namespace
{
void require(bool condition, const char* message)
{
	if (!condition)
		throw std::runtime_error(message);
}

void writeFixture(const juce::File& file)
{
	juce::WavAudioFormat format;
	std::unique_ptr<juce::OutputStream> stream = file.createOutputStream();
	const auto options = juce::AudioFormatWriterOptions{}.withSampleRate(48000)
		.withNumChannels(2).withBitsPerSample(16);
	auto writer = format.createWriterFor(stream, options);
	require(writer != nullptr, "create fixture");
	juce::AudioBuffer<float> pcm(2, 1200);
	for (int frame = 0; frame < pcm.getNumSamples(); ++frame)
	{
		const auto value = frame < 311 ? 0.125f : 0.375f;
		pcm.setSample(0, frame, value);
		pcm.setSample(1, frame, -value / 2);
	}
	require(writer->writeFromAudioSampleBuffer(pcm, 0, pcm.getNumSamples()), "write fixture");
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
		const auto empty = session.snapshot();
		require(empty.revision == 0 && empty.tracks.front().clips.empty() && !empty.canUndo, "empty Edit");
		original = session.insertAudio(empty.revision, empty.tracks.front().id, source, 257, 131, 744);
		const auto imported = session.snapshot();
		require(imported.revision == 1 && imported.tracks.front().clips.size() == 1 && imported.canUndo, "import undo transaction");
		require(imported.tracks.front().clips.front().id == original && imported.tracks.front().clips.front().sourceOffset == 131,
			"import sample geometry");

		bool rejected = false;
		try { session.split(empty.revision, original, 513); }
		catch (const std::invalid_argument&) { rejected = true; }
		require(rejected && session.snapshot().revision == 1, "stale mutation must leave the Edit intact");

		session.trim(1, original, 371, 1001);
		const auto trimmed = session.snapshot();
		require(trimmed.tracks.front().clips.front().start == 371 && trimmed.tracks.front().clips.front().sourceOffset == 245, "trim preserves source sync");
		require(session.undo(2), "undo trim");
		right = session.split(3, original, 513);
		const auto split = session.snapshot();
		require(split.revision == 4 && split.tracks.front().clips.size() == 2 && split.tracks.front().clips[0].end == 513
			&& split.tracks.front().clips[1].start == 513 && split.tracks.front().clips[1].sourceOffset == 387
			&& split.tracks.front().clips[1].id == right, "split preserves sample geometry");
		require(session.undo(4) && session.snapshot().tracks.front().clips.size() == 1, "undo split");
		require(session.redo(5) && session.snapshot().tracks.front().clips.size() == 2, "redo split");
		const auto auxiliary = session.addTrack(6, "Auxiliary");
		require(session.snapshot().tracks[1].id == auxiliary, "new audio track");
		require(session.undo(7) && session.snapshot().tracks.size() == 1, "track undo");
		require(session.redo(8) && session.snapshot().tracks.size() == 2, "track redo");
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
		const auto saved = reopened.snapshot();
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
		const auto view = fromArchive.snapshot();
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
	const auto track = session.snapshot().tracks.front().id;
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
	const auto view = session.snapshot();
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
	require(session.undo(1) && session.snapshot().tracks.front().clips.empty(), "undo hosted input take");
	require(session.redo(2), "redo hosted input take");
	const auto redone = session.snapshot().tracks.front().clips;
	require(redone.size() == 1 && redone.front().id == *take, "redo restores the same hosted take");
	session.save(3);
	const auto saved = project.getChildFile("project.tracktionedit").loadFileAsString();
	require(saved.contains("source=\"media/" + media[0].getFileName() + "\""), "redo restores the portable recording source reference");
	session.startRecording(3, track, 0);
	require(session.processPlaybackBlock(block, midi, input), "hosted input can record again");
	require(!session.finishRecording(3, true) && session.revision() == 3, "discard hosted input without publishing a revision");
	require(project.getChildFile("media").getNumberOfChildFiles(juce::File::findFiles) == 1, "discard removes just the new hosted media");
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
		runSessionTest(root);
		verifyHostedRecording(root);
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
