// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <tracktion_graph/tracktion_graph.h>

#include <algorithm>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
juce::File SessionBehaviour::getFileForNewAudioRecording(te::Track&, const juce::String& extension)
{
	return extension == ".wav" ? recordingFile : juce::File{};
}

namespace
{
juce::String defaultInput(juce::AudioDeviceManager& devices)
{
	if (const auto* type = devices.getCurrentDeviceTypeObject())
	{
		const auto names = type->getDeviceNames(true);
		const auto index = type->getDefaultDeviceIndex(true);
		if (juce::isPositiveAndBelow(index, names.size()))
			return names[index];
	}
	return {};
}

void armDefaultInput(te::Edit& edit, te::EditItemID track, juce::String& inputId)
{
	auto& devices = edit.engine.getDeviceManager();
	auto* wave = devices.getDefaultWaveInDevice();
	if (wave == nullptr && devices.getNumWaveInDevices() > 0)
		wave = devices.getWaveInDevice(0);
	if (wave == nullptr)
		throw std::invalid_argument("Tracktion could not route the default recording input");
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

void openSystemInput(te::DeviceManager& devices, juce::AudioDeviceManager::AudioDeviceSetup setup)
{
	setup.inputDeviceName = defaultInput(devices.deviceManager);
	if (setup.inputDeviceName.isEmpty())
		throw std::invalid_argument("The default audio input device is unavailable");
	setup.inputChannels.clear();
	setup.inputChannels.setBit(0);
	setup.useDefaultInputChannels = false;
	const auto error = devices.deviceManager.setAudioDeviceSetup(setup, false);
	auto* device = devices.deviceManager.getCurrentAudioDevice();
	if (error.isNotEmpty() || device == nullptr || device->getActiveInputChannels().isZero())
		throw std::invalid_argument("Tracktion could not open the default recording input");
	devices.deviceManager.dispatchPendingMessages();
	devices.rescanWaveDeviceList();
	devices.setAllWaveInputsToNumChannels(1);
	devices.dispatchPendingUpdates();
}
}

void Session::State::requireNoRecording() const
{
	if (recording)
		throw std::invalid_argument("Finish or discard the Tracktion recording first");
}

bool Session::isRecording() const { return state->recording.has_value(); }

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
	if (recording->outputSetup)
	{
		devices.deviceManager.closeAudioDevice();
		systemOutput = devices.deviceManager.setAudioDeviceSetup(*recording->outputSetup, false).isEmpty()
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
	if (s.playback == nullptr)
	{
		prepareSystemOutput();
		outputSetup = devices.deviceManager.getAudioDeviceSetup();
	}
	else if (!s.hostedMonoInput)
		throw std::invalid_argument("The Tracktion hosted device has no recording input");
	const auto media = s.directory.getChildFile(mediaDirectory);
	if (!media.isDirectory() || media.isSymbolicLink())
		throw std::invalid_argument("The project media directory is unavailable");
	const auto file = media.getChildFile(juce::Uuid().toString() + ".wav");
	if (file.exists() || file.isSymbolicLink())
		throw std::invalid_argument("Tracktion could not reserve a recording name");

	s.recording.emplace(State::Recording{trackId, file, std::move(outputSetup), {}});
	auto& behaviour = static_cast<SessionBehaviour&>(s.engine.getEngineBehaviour());
	behaviour.recordingFile = file;
	try
	{
		if (s.recording->outputSetup) openSystemInput(devices, *s.recording->outputSetup);
		armDefaultInput(*s.edit, target, s.recording->inputId);
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
	s.checkRevision(expected, true);
	if (!s.recording)
		throw std::invalid_argument("There is no active Tracktion recording");
	const auto file = s.recording->file;
	auto& track = s.track(s.recording->track);
	const te::Edit::UndoTransactionInhibitor transaction(*s.edit);
	s.begin("Record audio");
	auto& transport = s.edit->getTransport();
	if (!discard && s.hostedMonoInput)
		if (auto* head = transport.getCurrentPlaybackContext()->getNodePlayHead(); head && head->isPlaying())
		{
			// Tracktion stops at the start of the most recent device block.
			// The hosted caller drains complete capture before stopping.
			const auto end = head->getReferenceSampleRange().getEnd();
			head->setReferenceSampleRange({end, end});
		}
	transport.stop(discard, false, false);
	s.releaseRecordingInput();

	if (!discard && file.existsAsFile() && !file.isSymbolicLink())
	{
		// Tracktion derives the base from an Edit file that might not exist until
		// the first save. Match its generated reference before storing our portable one.
		const auto recordedReference = te::SourceFileReference::findPathFromFile(*s.edit, file, true);
		const auto ownedReference = juce::String(mediaDirectory) + "/" + file.getFileName();
		for (auto* clip : track.getClips())
			if (clip->state[te::IDs::source].toString() == recordedReference
			    || clip->getSourceFileReference().getFile() == file)
			{
				// The insertion owns the undo action and retains this clip state.
				clip->state.setProperty(te::IDs::source, ownedReference, nullptr);
				s.commit();
				return clip->itemID.getRawID();
			}
	}
	s.edit->getUndoManager().undoCurrentTransactionOnly();
	file.deleteFile();
	return std::nullopt;
}
}
