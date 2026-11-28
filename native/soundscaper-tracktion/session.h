// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "session_device_types.h"
#include "offline_effect.h"
#include "project_archive.h"

#include <atomic>
#include <cstddef>
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
enum class RangeDeleteMode { leaveGap, perClip, track, allTracks };
enum class RangePasteMode { overlap, insertTracks, insertAll };

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

struct IndexedClip
{
	ClipView clip;
	std::size_t index;
};

struct SplitClips
{
	IndexedClip left, right;
};

struct SplitResult
{
	ClipId itemId;
	std::optional<SplitClips> clips;
};

struct PlacedClipResult
{
	ClipId itemId;
	std::optional<IndexedClip> placement;
};

struct TrackSummary
{
	TrackId id;
	std::string name;
	std::size_t clipCount;
};

struct TrackInsertion
{
	TrackSummary track;
	std::size_t index;
};

struct EditHistory
{
	bool canUndo;
	bool canRedo;
};

struct ProjectPage
{
	Revision revision;
	int sampleRate;
	bool canUndo;
	bool canRedo;
	std::size_t total;
	std::vector<TrackSummary> tracks;
};

struct ClipPage
{
	std::size_t total;
	std::vector<ClipView> clips;
};

struct TrackMix
{
	float gainDb;
	float pan;
	bool muted;
	bool solo;
};

enum class TrackParameter { gainDb, pan };

struct AutomationPoint
{
	Frame frame;
	float value, curve;
};

struct AutomationPage
{
	std::size_t total;
	std::vector<AutomationPoint> points;
};

// A host creates and drives the session on the JUCE message thread.
// Paths are supplied by the host after granting access to the project and media.
class Session
{
public:
	Session(const juce::File& directory, const juce::File& stateDirectory, OpenMode, int sampleRate);
	~Session();

	ProjectPage projectPage(std::size_t offset, std::size_t limit) const;
	std::optional<TrackInsertion> trackInsertion(TrackId) const;
	EditHistory editHistory() const;
	ClipPage clipPage(TrackId, std::size_t offset, std::size_t limit) const;
	std::optional<IndexedClip> indexedClip(TrackId, ClipId) const;
	Revision revision() const noexcept;
	TrackId addTrack(Revision, const std::string& name);
	TrackId duplicateTrack(Revision, TrackId);
	TrackMix trackMix(Revision, TrackId) const;
	void setTrackMix(Revision, TrackId, TrackMix);
	AutomationPage trackAutomation(Revision, TrackId, TrackParameter, std::size_t offset, std::size_t limit) const;
	std::size_t setAutomationPoint(Revision, TrackId, TrackParameter, std::optional<std::size_t>, AutomationPoint);
	void removeAutomationPoint(Revision, TrackId, TrackParameter, std::size_t);
	void clearAutomation(Revision, TrackId, TrackParameter);
	std::uint64_t insertOfflineEffect(Revision, TrackId, const OfflineEffectIdentity&);
	void removeOfflineEffect(Revision, TrackId, std::uint64_t slot);
	std::vector<OfflineEffectSlot> offlineEffects(Revision, TrackId) const;
	ClipId insertAudio(Revision, TrackId, const juce::File& source, Frame start, Frame sourceOffset,
	                  std::optional<Frame> frameCount, const std::string& name = {});
	std::optional<IndexedClip> trim(Revision, ClipId, Frame start, Frame end);
	SplitResult split(Revision, ClipId, Frame);
	std::optional<IndexedClip> moveClip(Revision, ClipId, TrackId destination, Frame start);
	PlacedClipResult duplicateClip(Revision, ClipId, TrackId destination, Frame start);
	void deleteClip(Revision, ClipId);
	std::vector<ClipId> deleteRange(Revision, RangeDeleteMode, std::optional<TrackId>, Frame start, Frame end);
	std::vector<ClipId> copyRange(Revision, RangeDeleteMode, std::optional<TrackId>, Frame start, Frame end, const juce::File& clipboard, bool cut);
	void pasteRange(Revision, RangePasteMode, TrackId, Frame start, const juce::File& clipboard);
	bool undo(Revision);
	bool redo(Revision);
	void save(Revision);
	void archive(Revision, const juce::File& output, ProjectArchiveLimits = projectArchiveExportLimits);

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
	std::optional<TrackId> recordingTrack() const;
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

	Frame mixEnd() const;
	void render(Revision, const juce::File& output, Frame start, Frame end,
	            const std::atomic_bool* cancelled = nullptr, OfflineEffectHost* effects = nullptr);

private:
	void watchAudioDevice();
	struct State;
	std::unique_ptr<State> state;
};
}
