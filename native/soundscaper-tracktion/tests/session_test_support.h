// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "session.h"

#include <juce_audio_formats/juce_audio_formats.h>

#include <limits>
#include <stdexcept>

namespace soundscaper::tracktion_backend::test
{
struct TrackSnapshot
{
	TrackId id;
	std::string name;
	std::vector<ClipView> clips;
};

struct ProjectSnapshot
{
	Revision revision;
	int sampleRate;
	bool canUndo;
	std::vector<TrackSnapshot> tracks;
};

inline ProjectSnapshot readProjectSnapshot(const Session& session)
{
	constexpr auto all = std::numeric_limits<std::size_t>::max();
	const auto project = session.projectPage(0, all);
	ProjectSnapshot result{project.revision, project.sampleRate, project.canUndo, {}};
	result.tracks.reserve(project.tracks.size());
	for (const auto& track : project.tracks)
		result.tracks.push_back({track.id, track.name, session.clipPage(track.id, 0, all).clips});
	return result;
}

inline void require(bool condition, const char* message)
{
	if (!condition)
		throw std::runtime_error(message);
}

inline void writeFixture(const juce::File& file, int frames = 1200)
{
	juce::WavAudioFormat format;
	std::unique_ptr<juce::OutputStream> stream = file.createOutputStream();
	const auto options = juce::AudioFormatWriterOptions{}.withSampleRate(48000)
		.withNumChannels(2).withBitsPerSample(16);
	auto writer = format.createWriterFor(stream, options);
	require(writer != nullptr, "create fixture");
	juce::AudioBuffer<float> pcm(2, frames);
	for (int frame = 0; frame < pcm.getNumSamples(); ++frame)
	{
		const auto value = frame < 311 ? 0.125f : 0.375f;
		pcm.setSample(0, frame, value);
		pcm.setSample(1, frame, -value / 2);
	}
	require(writer->writeFromAudioSampleBuffer(pcm, 0, pcm.getNumSamples()), "write fixture");
}
}
