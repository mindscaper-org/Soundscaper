// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <tracktion_graph/tracktion_graph.h>

#include <algorithm>
#include <stdexcept>

#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
#include "pipewire_device.h"
#endif

namespace soundscaper::tracktion_backend
{
juce::File SessionBehaviour::getFileForNewAudioRecording(te::Track&, const juce::String& extension)
{
	return extension == ".wav" ? recordingFile : juce::File{};
}

namespace
{
void armInput(te::Edit& edit, te::EditItemID track, juce::String& inputId)
{
	auto& devices = edit.engine.getDeviceManager();
	te::WaveInputDevice* wave = nullptr;
	for (auto* input : devices.getWaveInputDevices())
		if (input->getChannels().getNumChannels() == 1)
		{
			wave = input;
			break;
		}
	if (wave == nullptr)
		throw std::invalid_argument("Tracktion could not route the selected recording channel");
	const auto deviceId = wave->getDeviceID();
	wave->setMonitorMode(te::InputDevice::MonitorMode::off);
	wave->setOutputFormat(edit.engine.getAudioFileFormatManager().getWavFormat()->getFormatName());
	wave->setEnabled(true);
	devices.dispatchPendingUpdates();
	edit.getTransport().ensureContextAllocated();
	for (auto* instance : edit.getAllInputDevices())
		for (auto target : instance->getTargets())
			instance->setRecordingEnabled(target, false);
	for (auto* instance : edit.getAllInputDevices())
		if (instance->getInputDevice().getDeviceID() == deviceId)
		{
			if (!instance->setTarget(track, true, nullptr, 0))
				break;
			inputId = deviceId;
			instance->setRecordingEnabled(track, true);
			instance->dispatchPendingRecordingRouting();
			return;
		}
	throw std::invalid_argument("Tracktion could not arm the selected audio track");
}

void openSystemInput(te::DeviceManager& devices, juce::AudioDeviceManager::AudioDeviceSetup setup,
                     const juce::String& name, int channel)
{
	setup.inputDeviceName = name;
	setup.inputChannels.clear();
	setup.inputChannels.setBit(channel);
	setup.useDefaultInputChannels = false;
	const auto error = devices.deviceManager.setAudioDeviceSetup(setup, false);
	auto* device = devices.deviceManager.getCurrentAudioDevice();
	if (error.isNotEmpty() || device == nullptr || device->getActiveInputChannels() != setup.inputChannels
	    || device->getActiveOutputChannels() != setup.outputChannels
	    || device->getCurrentSampleRate() != setup.sampleRate
	    || device->getCurrentBufferSizeSamples() != setup.bufferSize)
		throw std::invalid_argument("Tracktion could not open the selected recording input");
	devices.deviceManager.dispatchPendingMessages();
	devices.rescanWaveDeviceList();
	devices.dispatchPendingUpdates();
}
}

void Session::State::requireNoRecording() const
{
	if (recording)
		throw std::invalid_argument("Finish or discard the Tracktion recording first");
}

bool Session::isRecording() const { return state->recording.has_value(); }

std::optional<InterruptedTake> Session::interruptedTake() const
{
	const auto& recovered = state->recoveredRecording;
	return recovered && recovered->revision == state->revision && !isRecording() ? recovered : std::nullopt;
}

void Session::State::releaseRecordingInput()
{
	const auto target = track(recording->track).itemID;
	for (auto* instance : edit->getAllInputDevices())
		if (instance->getInputDevice().getDeviceID() == recording->inputId)
		{
			instance->setRecordingEnabled(target, false);
			[[maybe_unused]] const auto detached = instance->removeTarget(target, nullptr);
			break;
		}

	auto& behaviour = static_cast<SessionBehaviour&>(engine.getEngineBehaviour());
	behaviour.recordingFile = juce::File{};
	auto& devices = engine.getDeviceManager();
	if (recording->native)
	{
		bool restoreOutput = recording->outputSetup.has_value();
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
		if (pipeWireOutput(devices.deviceManager.getCurrentAudioDevice()) == PipeWireRoute::interrupted)
		{
			restoreOutput = false;
			outputWasInterrupted = true;
		}
#endif
		devices.deviceManager.closeAudioDevice();
		systemOutput = restoreOutput && devices.deviceManager.setAudioDeviceSetup(*recording->outputSetup, false).isEmpty()
			&& devices.deviceManager.getCurrentAudioDevice() != nullptr;
		devices.deviceManager.dispatchPendingMessages();
	}
	devices.dispatchPendingUpdates();
	recording.reset();
}

void Session::startRecording(Revision expected, TrackId trackId, Frame frame)
{
	auto& s = *state;
	s.checkRevision(expected);
	const auto start = s.position(frame);
	const auto target = s.track(trackId).itemID;
	auto& transport = s.edit->getTransport();
	if (transport.isPlaying() || transport.looping || s.edit->recordingPunchInOut)
		throw std::invalid_argument("Stop playback and turn off loop or punch recording before recording a take");
	auto& devices = s.engine.getDeviceManager();
	std::optional<juce::AudioDeviceManager::AudioDeviceSetup> outputSetup;
	juce::String inputName;
	const bool native = s.playback == nullptr;
	if (native)
	{
		try
		{
			prepareSystemOutput();
		}
		catch (const std::invalid_argument&)
		{
			if (!s.preferredAudioSetup) throw;
		}
		if (s.hasSystemOutput())
		{
			outputSetup = devices.deviceManager.getAudioDeviceSetup();
			inputName = s.recordingInputName();
		}
	}
	else if (!s.hostedMonoInput)
		throw std::invalid_argument("The Tracktion hosted device has no recording input");
	const auto media = s.directory.getChildFile(mediaDirectory);
	if (!media.isDirectory() || media.isSymbolicLink())
		throw std::invalid_argument("The project media directory is unavailable");
	const auto file = media.getChildFile(juce::Uuid().toString() + ".wav");
	if (file.exists() || file.isSymbolicLink())
		throw std::invalid_argument("Tracktion could not reserve a recording name");

	s.recording.emplace(State::Recording{trackId, file, native, std::move(outputSetup), {}});
	auto& behaviour = static_cast<SessionBehaviour&>(s.engine.getEngineBehaviour());
	behaviour.recordingFile = file;
	s.recoveredRecording.reset();
	try
	{
		const auto channel = s.preferredAudioSetup ? s.preferredAudioSetup->inputChannel : 0;
		if (s.recording->outputSetup) openSystemInput(devices, *s.recording->outputSetup, inputName, channel);
		else if (native) s.openInputOnly();
		armInput(*s.edit, target, s.recording->inputId);
		s.edit->dispatchPendingUpdatesSynchronously();
		s.begin("Record audio");
		transport.setPosition(start);
		transport.record(false);
		const auto inputIsRecording = std::ranges::any_of(s.edit->getAllInputDevices(), [&](auto* instance)
		{
			return instance->getInputDevice().getDeviceID() == s.recording->inputId
				&& instance->isRecording(target) && instance->getRecordingFile(target) == file;
		});
		if (!transport.isRecording() || !inputIsRecording)
			throw std::invalid_argument("Tracktion could not start recording");
		if (s.hostedMonoInput)
		{
			// The wave input consumes the first captured block before the
			// graph applies the queued position. Align both to the device clock.
			const auto streamTime = devices.getCurrentStreamTime();
			auto* context = transport.getCurrentPlaybackContext();
			context->resyncToGlobalStreamTime({streamTime, streamTime}, s.sampleRate);
			if (auto* head = context->getNodePlayHead())
				head->setPosition(tracktion::toSamples(transport.getPosition(), s.sampleRate));
		}
		watchAudioDevice();
	}
	catch (...)
	{
		if (transport.isPlaying() || transport.isRecording())
			transport.stop(transport.isRecording(), true, false);
		s.releaseRecordingInput();
		file.deleteFile();
		throw;
	}
}

std::optional<ClipId> Session::finishRecording(Revision expected, bool discard)
{
	auto& s = *state;
	if (!discard)
		if (const auto recovered = interruptedTake(); recovered && recovered->previousRevision == expected)
			return recovered->item;
	s.checkRevision(expected, true);
	if (!s.recording)
		throw std::invalid_argument("There is no active Tracktion recording");
	const auto file = s.recording->file;
	auto& track = s.track(s.recording->track);
	const te::Edit::UndoTransactionInhibitor transaction(*s.edit);
	s.begin("Record audio");
	auto& transport = s.edit->getTransport();
	auto alignWithCapture = s.hostedMonoInput;
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	if (s.deviceLossMonitor) s.deviceLossMonitor->stopTimer();
	if (s.recording->native)
		alignWithCapture = quiescePipeWireCapture(s.engine.getDeviceManager().deviceManager.getCurrentAudioDevice());
#endif
	if (!discard && alignWithCapture)
		if (auto* head = transport.getCurrentPlaybackContext()->getNodePlayHead(); head && head->isPlaying())
		{
			// Tracktion stops at the start of the most recent device block.
			// Use the end of the last delivered capture block.
			const auto end = head->getReferenceSampleRange().getEnd();
			head->setReferenceSampleRange({end, end});
		}
	transport.stop(discard, false, false);
	s.releaseRecordingInput();

	if (!discard && file.existsAsFile() && !file.isSymbolicLink())
	{
		for (auto* clip : track.getClips())
			if (clip->getSourceFileReference().getFile() == file)
			{
				s.commit();
				return clip->itemID.getRawID();
			}
	}
	s.edit->getUndoManager().undoCurrentTransactionOnly();
	file.deleteFile();
	return std::nullopt;
}
}
