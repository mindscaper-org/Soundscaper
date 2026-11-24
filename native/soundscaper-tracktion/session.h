// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "session_device_types.h"
#include "offline_effect.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <optional>
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

struct InterruptedTake
{
	Revision previousRevision;
	Revision revision;
	std::optional<ClipId> item;
};

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

struct TrackMix
{
	float gainDb;
	float pan;
	bool muted;
	bool solo;
};

// A host creates and drives the session on the JUCE message thread.
// Paths are supplied by the host after granting access to the project and media.
class Session
{
public:
	Session(const juce::File& directory, const juce::File& stateDirectory, OpenMode, int sampleRate);
	~Session();

	ProjectView snapshot() const;
	Revision revision() const noexcept;
	TrackId addTrack(Revision, const std::string& name);
	TrackMix trackMix(Revision, TrackId) const;
	void setTrackMix(Revision, TrackId, TrackMix);
	std::uint64_t insertOfflineEffect(Revision, TrackId, const OfflineEffectIdentity&);
	void removeOfflineEffect(Revision, TrackId, std::uint64_t slot);
	std::vector<OfflineEffectSlot> offlineEffects(Revision, TrackId) const;
	ClipId insertAudio(Revision, TrackId, const juce::File& source, Frame start, Frame sourceOffset,
	                  std::optional<Frame> frameCount, const std::string& name = {});
	void trim(Revision, ClipId, Frame start, Frame end);
	ClipId split(Revision, ClipId, Frame);
	bool undo(Revision);
	bool redo(Revision);
	void save(Revision);
	void archive(Revision, const juce::File& output);

	// The host opens its own device and supplies exactly one stereo block at a time.
	// Setup and transport commands run on the message thread. The host stops
	// delivering blocks at the start and end of recording and before teardown.
	void preparePlayback(int blockFrames, bool monoInput = false);
	void prepareSystemOutput();
	AudioHosts audioHosts();
	AudioDevices audioDevices(const std::string& hostId);
	enum class AudioSetupMode { validateInput, outputOnly };
	void rememberAudioSetup(AudioSetup);
	AppliedAudioSetup setAudioSetup(AudioSetup, AudioSetupMode = AudioSetupMode::validateInput);
	bool playbackReady() const;
	bool outputInterrupted() const;
	bool isPlaying() const;
	bool isRecording() const;
	std::optional<InterruptedTake> interruptedTake() const;
	void play(Frame start);
	void seek(Frame);
	void setLoop(bool enabled, Frame start, Frame end);
	Frame playbackPosition() const;
	void stop();
	// A supplied input block may be shorter at the end of a hosted take.
	bool processPlaybackBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&, const float* monoInput = nullptr) noexcept;
	void startRecording(Revision, TrackId, Frame);
	std::optional<ClipId> finishRecording(Revision, bool discard);

	void render(Revision, const juce::File& output, Frame start, Frame end,
	            const std::atomic_bool* cancelled = nullptr, OfflineEffectHost* effects = nullptr);

private:
	void watchAudioDevice();
	struct State;
	std::unique_ptr<State> state;
};
}
