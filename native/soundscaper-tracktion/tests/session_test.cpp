// SPDX-License-Identifier: AGPL-3.0-only

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
	}
}
}

int main()
{
	juce::ScopedJuceInitialiser_GUI juceLifetime;
	const auto root = juce::File::getSpecialLocation(juce::File::tempDirectory)
		.getNonexistentChildFile("soundscaper-tracktion-test", "", false);
	if (!root.createDirectory().wasOk())
		return 1;
	try
	{
		runSessionTest(root);
		root.deleteRecursively();
		return 0;
	}
	catch (const std::exception& error)
	{
		std::cerr << error.what() << '\n';
		root.deleteRecursively();
		return 1;
	}
}
