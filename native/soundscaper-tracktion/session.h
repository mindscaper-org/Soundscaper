// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace juce
{
class File;
class MidiBuffer;
template <typename Sample> class AudioBuffer;
}

namespace soundscaper::tracktion_backend
{
using Frame = std::int64_t;
using Revision = std::uint64_t;
using ClipId = std::uint64_t;
using TrackId = std::uint64_t;

enum class OpenMode { create, open };

struct ClipView
{
	ClipId id;
	std::string name;
	Frame start;
	Frame end;
	Frame sourceOffset;
};

struct TrackView
{
	TrackId id;
	std::string name;
	std::vector<ClipView> clips;
};

struct ProjectView
{
	Revision revision;
	int sampleRate;
	bool canUndo;
	bool canRedo;
	std::vector<TrackView> tracks;
};

// A host creates and drives the session on the JUCE message thread.
// Paths are supplied by the host after granting access to the project and media.
class Session
{
public:
	Session(const juce::File& directory, const juce::File& stateDirectory, OpenMode, int sampleRate);
	~Session();

	ProjectView snapshot() const;
	TrackId addTrack(Revision, const std::string& name);
	ClipId insertAudio(Revision, TrackId, const juce::File& source, Frame start, Frame sourceOffset, Frame frameCount);
	void trim(Revision, ClipId, Frame start, Frame end);
	ClipId split(Revision, ClipId, Frame);
	bool undo(Revision);
	bool redo(Revision);
	void save(Revision);
	void archive(Revision, const juce::File& output);

	// The host opens its own device and supplies exactly one stereo block at a time.
	// Setup and transport commands run on the message thread. The host stops
	// delivering blocks before tearing down the session.
	void preparePlayback(int blockFrames);
	bool playbackReady() const;
	void play(Frame start);
	void seek(Frame);
	void setLoop(bool enabled, Frame start, Frame end);
	Frame playbackPosition() const;
	void stop();
	bool processPlaybackBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) noexcept;

	void render(Revision, const juce::File& output, Frame start, Frame end,
	            const std::atomic_bool* cancelled = nullptr);

private:
	struct State;
	std::unique_ptr<State> state;
};
}
