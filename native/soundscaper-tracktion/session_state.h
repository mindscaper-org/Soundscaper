// SPDX-License-Identifier: AGPL-3.0-only

#pragma once

#include "session.h"

#include <tracktion_engine/tracktion_engine.h>

namespace soundscaper::tracktion_backend
{
namespace te = tracktion::engine;

inline constexpr auto mediaDirectory = "media";

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
	void checkRevision(Revision, bool finishingRecording = false) const;
	void requireNoRecording() const;
	te::AudioTrack& track(TrackId) const;
	std::pair<te::AudioTrack&, te::Clip&> clip(ClipId) const;
	void begin(const char* name);
	void commit();

	void releaseRecordingInput();

	struct Recording
	{
		TrackId track;
		juce::File file;
		std::optional<juce::AudioDeviceManager::AudioDeviceSetup> outputSetup;
		juce::String inputId;
	};

	juce::File directory;
	juce::File editFile;
	te::Engine engine;
	std::unique_ptr<te::Edit> edit;
	Revision revision = 0;
	int sampleRate = 0;
	te::HostedAudioDeviceInterface* playback = nullptr;
	int playbackBlockFrames = 0;
	bool hostedMonoInput = false;
	bool systemOutput = false;
	bool systemDeviceManagerInitialised = false;
	std::optional<AppliedAudioSetup> systemAudioSetup;
	juce::String systemInputName, systemOutputName, systemHostName;
	bool hasSystemOutput() const;
	std::optional<Recording> recording;
};
}
