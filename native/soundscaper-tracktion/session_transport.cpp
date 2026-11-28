// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <functional>
#include <iostream>
#include <set>
#include <stdexcept>

#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
#include "pipewire_device.h"
#endif

namespace soundscaper::tracktion_backend
{
namespace
{
class DeviceLossMonitor final : public juce::Timer
{
public:
	explicit DeviceLossMonitor(std::function<void()> poll) : inspect(std::move(poll)) {}

private:
	void timerCallback() override { inspect(); }
	std::function<void()> inspect;
};
}

Session::~Session()
{
	if (state->deviceLossMonitor) state->deviceLossMonitor->stopTimer();
	if (state->recording)
	{
		state->edit->getTransport().stop(true, true, false);
		state->recording->file.deleteFile();
	}
	if (state->systemDeviceManagerInitialised)
		state->engine.getDeviceManager().deviceManager.closeAudioDevice();
}

void Session::preparePlayback(int blockFrames, bool monoInput)
{
	auto& s = *state;
	if (s.systemOutput || s.playback != nullptr || blockFrames < 32 || blockFrames > 4096)
		throw std::invalid_argument("Tracktion playback requires one device block size from 32 to 4096");
	auto& devices = s.engine.getDeviceManager();
	auto& playback = devices.getHostedAudioDeviceInterface();
	te::HostedAudioDeviceInterface::Parameters format;
	format.sampleRate = s.sampleRate;
	format.blockSize = blockFrames;
	format.inputChannels = monoInput ? 1 : 0;
	format.outputChannels = 2;
	playback.initialise(format);
	playback.prepareToPlay(format.sampleRate, format.blockSize);
	for (auto* input : devices.getWaveInputDevices())
		input->setMonitorMode(te::InputDevice::MonitorMode::off);
	devices.dispatchPendingUpdates();
	s.edit->dispatchPendingUpdatesSynchronously();
	s.edit->getTransport().ensureContextAllocated();
	s.playbackBlockFrames = blockFrames;
	s.hostedMonoInput = monoInput;
	s.playback = &playback;
}

bool Session::State::hasSystemOutput() const
{
	auto& manager = engine.getDeviceManager().deviceManager;
	auto* device = manager.getCurrentAudioDevice();
	if (!systemOutput || device == nullptr || !device->isOpen()) return false;
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	if (pipeWireOutput(device) == PipeWireRoute::interrupted) return false;
#endif
	if (!systemAudioSetup) return true;
	const auto& applied = *systemAudioSetup;
	const auto setup = manager.getAudioDeviceSetup();
	return device->getTypeName() == systemHostName && setup.outputDeviceName == systemOutputName
		&& setup.sampleRate == applied.actualSampleRate && setup.bufferSize == applied.actualBlockSize
		&& setup.outputChannels.countNumberOfSetBits() == 2
		&& setup.outputChannels.findNextSetBit(0) == applied.setup.outputChannel
		&& setup.outputChannels[applied.setup.outputChannel + 1];
}

void Session::prepareSystemOutput()
{
	auto& s = *state;
	s.requireNoRecording();
	if (s.playback != nullptr)
		throw std::invalid_argument("The Tracktion session already has a hosted device");
	auto& devices = s.engine.getDeviceManager();
	if (s.hasSystemOutput())
		return;
	if (s.preferredAudioSetup)
	{
		setAudioSetup(*s.preferredAudioSetup, AudioSetupMode::outputOnly);
		return;
	}
	devices.initialise(0, 2);
	devices.setMidiDeviceScanIntervalSeconds(0);
	s.systemDeviceManagerInitialised = true;
	auto* output = devices.deviceManager.getCurrentAudioDevice();
	if (output == nullptr || !output->isOpen() || output->getActiveOutputChannels().countNumberOfSetBits() < 2)
	{
		devices.deviceManager.closeAudioDevice();
		throw std::invalid_argument("Tracktion could not open the default stereo output device");
	}
	s.systemOutput = true;
	s.outputWasInterrupted = false;
	devices.dispatchPendingUpdates();
	s.edit->getTransport().ensureContextAllocated();
}

bool Session::playbackReady() const
{
	auto& s = *state;
	if (s.playback == nullptr && !s.hasSystemOutput())
		return false;
	if (s.playbackMediaRevision != s.revision)
	{
		std::set<juce::String> references;
		std::set<juce::File> files;
		te::Clip::Array restoredSources;
		for (auto* track : te::getAudioTracks(*s.edit))
			for (auto* clip : track->getClips())
			{
				const auto& reference = clip->getSourceFileReference();
				if (references.insert(reference.source.get()).second)
				{
					auto file = reference.getFile();
					if (file == juce::File{}) return false;
					const auto [source, inserted] = files.insert(std::move(file));
					if (inserted && ownedMediaFile(s.directory, juce::String(mediaDirectory) + "/" + source->getFileName()) != *source)
						return false;
				}
				if (clip->getCurrentSourceFile() == juce::File{}) restoredSources.add(clip);
			}
		// Undo can initialise a clip while its source is absent, leaving the playback graph silent after the file returns.
		if (!restoredSources.isEmpty())
		{
			for (auto* clip : restoredSources)
			{
				clip->sourceMediaChanged();
				if (clip->getCurrentSourceFile() == juce::File{}) return false;
			}
			s.edit->restartPlayback();
			s.edit->dispatchPendingUpdatesSynchronously();
		}
		s.playbackMedia.clear();
		s.playbackMedia.reserve(files.size());
		for (const auto& file : files) s.playbackMedia.emplace_back(s.engine, file);
		s.playbackMediaRevision = s.revision;
	}
	if (s.playbackMedia.empty()) return true;
	// Paths and hashes are fixed for this revision, but files can disappear or
	// become symlinks without an Edit. Check the common directory once per poll.
	if (s.directory.getChildFile(mediaDirectory).isSymbolicLink()) return false;
	auto& cache = s.engine.getAudioFileManager().cache;
	return std::ranges::all_of(s.playbackMedia, [&](const auto& source)
	{
		const auto& file = source.getFile();
		return !file.isSymbolicLink() && file.existsAsFile() && cache.hasMappedReader(source, 0);
	});
}

bool Session::isPlaying() const { return state->edit->getTransport().isPlaying(); }

bool Session::outputInterrupted() const
{
	const auto& s = *state;
	if (s.outputWasInterrupted) return true;
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	auto& manager = s.engine.getDeviceManager().deviceManager;
	return pipeWireOutput(manager.getCurrentAudioDevice()) == PipeWireRoute::interrupted;
#else
	return false;
#endif
}

void Session::watchAudioDevice()
{
	auto& s = *state;
	if (s.playback != nullptr) return;
	if (!isRecording())
	{
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
		auto* device = s.engine.getDeviceManager().deviceManager.getCurrentAudioDevice();
		if (pipeWireOutput(device) == PipeWireRoute::inactive && pipeWireCapture(device) == PipeWireRoute::inactive) return;
#else
		return;
#endif
	}
	if (!s.deviceLossMonitor)
		s.deviceLossMonitor = std::make_unique<DeviceLossMonitor>([this]
		{
			auto& s = *state;
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
			auto* device = s.engine.getDeviceManager().deviceManager.getCurrentAudioDevice();
			if (pipeWireOutput(device) == PipeWireRoute::interrupted)
			{
				s.outputWasInterrupted = true;
				if (!isRecording() && isPlaying())
				{
					const auto frame = std::max(Frame{}, playbackPosition());
					stop();
					s.edit->getTransport().setPosition(tracktion::TimePosition::fromSamples(frame, s.sampleRate));
				}
			}
#endif
			if (!isRecording())
			{
				if (!isPlaying())
				{
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
					setPipeWirePlaybackActive(device, false);
#endif
					s.deviceLossMonitor->stopTimer();
				}
				return;
			}
			// The engine may stop on a disk write failure while the session still owns the take.
			auto interrupted = !s.edit->getTransport().isRecording();
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
			interrupted = interrupted || pipeWireCapture(device) == PipeWireRoute::interrupted;
#endif
			if (!interrupted) return;
			const auto before = s.revision;
			try
			{
				const auto item = finishRecording(before, false);
				s.recoveredRecording = InterruptedTake{before, s.revision, item};
			}
			catch (const std::exception& error)
			{
				std::cerr << "Could not recover the interrupted Tracktion recording. " << error.what() << '\n';
			}
		});
	s.deviceLossMonitor->startTimer(40);
}

void Session::play(Frame start)
{
	auto& s = *state;
	s.requireNoRecording();
	requireLiveEffectSupport(*s.edit);
	if (s.playback == nullptr && !s.hasSystemOutput())
		throw std::invalid_argument("Prepare the Tracktion playback device before playing");
	auto& transport = s.edit->getTransport();
	transport.setPosition(s.position(start));
	transport.play(false);
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	setPipeWirePlaybackActive(s.engine.getDeviceManager().deviceManager.getCurrentAudioDevice(), transport.isPlaying());
#endif
	watchAudioDevice();
}

void Session::seek(Frame frame)
{
	state->requireNoRecording();
	state->edit->getTransport().setPosition(state->position(frame));
}

void Session::setLoop(bool enabled, Frame start, Frame end)
{
	state->requireNoRecording();
	auto& transport = state->edit->getTransport();
	if (enabled)
	{
		const auto from = state->position(start);
		const auto until = state->position(end);
		if (start >= end)
			throw std::invalid_argument("Loop must contain at least one frame");
		transport.setLoopRange({from, until});
	}
	transport.looping = enabled;
}

Frame Session::playbackPosition() const
{
	const auto& transport = state->edit->getTransport();
	auto* context = transport.getCurrentPlaybackContext();
	const auto position = transport.isPlaying() && context != nullptr
		? context->getAudibleTimelineTime()
		: transport.getPosition();
	return tracktion::toSamples(position, state->sampleRate);
}

void Session::stop()
{
	state->requireNoRecording();
	if (state->deviceLossMonitor) state->deviceLossMonitor->stopTimer();
	state->edit->getTransport().stop(false, false, false);
#if defined(SOUNDSCAPER_TRACKTION_PIPEWIRE)
	setPipeWirePlaybackActive(state->engine.getDeviceManager().deviceManager.getCurrentAudioDevice(), false);
#endif
}

bool Session::processPlaybackBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi, const float* monoInput) noexcept
{
	const auto& s = *state;
	audio.clear();
	const auto frames = audio.getNumSamples();
	if (s.playback == nullptr || audio.getNumChannels() != 2 || frames <= 0 || frames > s.playbackBlockFrames
	    || (monoInput ? !s.hostedMonoInput : frames != s.playbackBlockFrames))
		return false;
	if (monoInput) audio.copyFrom(0, 0, monoInput, frames);
	s.playback->processBlock(audio, midi);
	return true;
}

}
