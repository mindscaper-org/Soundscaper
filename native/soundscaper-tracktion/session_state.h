// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "session.h"

#include <tracktion_engine/tracktion_engine.h>

#include <array>
#include <functional>

namespace soundscaper::tracktion_backend
{
namespace te = tracktion::engine;

inline constexpr auto mediaDirectory = "media";
juce::File ownedMediaFile(const juce::File& directory, const juce::String& reference);
void copyOwnedWave(const juce::File& source, const juce::File& destination, const char* failure);
ClipView summarizeClip(const te::Clip&, int sampleRate);

void registerOfflineEffectPlugin(te::Engine&);
bool hasEnabledOfflineEffect(const te::Edit&);
void requireLiveEffectSupport(const te::Edit&);
std::array<te::AutomatableParameter*, 2> trackAutomationParameters(te::AudioTrack&);

class SessionBehaviour final : public te::EngineBehaviour
{
public:
	bool autoInitialiseDeviceManager() override { return false; }
	bool shouldLoadPlugin(te::ExternalPlugin&) override { return false; }
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	void addHostAudioIODeviceTypes(juce::OwnedArray<juce::AudioIODeviceType>&) override;
#endif
	bool isDescriptionOfWaveDevicesSupported() override { return true; }
	void describeWaveDevices(std::vector<te::WaveDeviceDescription>&, juce::AudioIODevice&, bool input) override;
	juce::File getFileForNewAudioRecording(te::Track&, const juce::String& extension) override;
	juce::File recordingFile;
};

struct Session::State
{
	State(const juce::File& directory, const juce::File& stateDirectory, OpenMode, int sampleRate);
	std::unique_ptr<te::Edit> makeEdit(juce::ValueTree, te::Edit::EditRole);
	juce::ValueTree newProject(int rate);
	juce::ValueTree openProject() const;
	tracktion::TimePosition position(Frame) const;
	te::ClipPosition clipPlacement(const te::Clip&, Frame start) const;
	void checkRevision(Revision, bool finishingRecording = false) const;
	void requireNoRecording() const;
	te::AudioTrack& track(TrackId) const;
	std::pair<te::AudioTrack&, te::Clip&> clip(ClipId) const;
	void begin(const char* name);
	void commit();
	void rollback();
	void deleteRange(RangeDeleteMode, std::optional<TrackId>, Frame start, Frame end, const std::function<void()>& publish = {});

	void releaseRecordingInput();

	struct Recording
	{
		TrackId track;
		juce::File file;
		bool native;
		std::optional<juce::AudioDeviceManager::AudioDeviceSetup> outputSetup;
		juce::String inputId;
	};

	juce::File directory;
	juce::File editFile;
	te::Engine engine;
	std::unique_ptr<te::Edit> edit;
	Revision revision = 0;
	std::optional<Revision> playbackMediaRevision;
	std::vector<te::AudioFile> playbackMedia;
	int sampleRate = 0;
	te::HostedAudioDeviceInterface* playback = nullptr;
	int playbackBlockFrames = 0;
	bool hostedMonoInput = false;
	bool systemOutput = false;
	bool outputWasInterrupted = false;
	bool systemDeviceManagerInitialised = false;
	std::optional<AudioSetup> preferredAudioSetup;
	std::optional<AppliedAudioSetup> systemAudioSetup;
	juce::String systemOutputName, systemHostName;
	void initialiseSystemDevices();
	void openInputOnly();
	juce::String recordingInputName() const;
	bool hasSystemOutput() const;
	std::optional<Recording> recording;
	std::optional<InterruptedTake> recoveredRecording;
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	std::unique_ptr<juce::Timer> deviceLossMonitor;
#endif
};
}
