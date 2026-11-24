// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <stdexcept>

namespace soundscaper::tracktion_backend
{
Session::~Session()
{
	if (state->recording)
	{
		state->edit->getTransport().stop(true, true, false);
		state->recording->file.deleteFile();
	}
	if (state->systemOutput)
		state->engine.getDeviceManager().deviceManager.closeAudioDevice();
}

void Session::preparePlayback(int blockFrames)
{
	auto& s = *state;
	if (s.systemOutput || s.playback != nullptr || blockFrames < 32 || blockFrames > 4096)
		throw std::invalid_argument("Tracktion playback requires one device block size from 32 to 4096");
	auto& devices = s.engine.getDeviceManager();
	auto& playback = devices.getHostedAudioDeviceInterface();
	te::HostedAudioDeviceInterface::Parameters format;
	format.sampleRate = s.sampleRate;
	format.blockSize = blockFrames;
	format.inputChannels = 0;
	format.outputChannels = 2;
	playback.initialise(format);
	playback.prepareToPlay(format.sampleRate, format.blockSize);
	devices.dispatchPendingUpdates();
	s.edit->dispatchPendingUpdatesSynchronously();
	s.edit->getTransport().ensureContextAllocated();
	s.playbackBlockFrames = blockFrames;
	s.playback = &playback;
}

void Session::prepareSystemOutput()
{
	auto& s = *state;
	s.requireNoRecording();
	if (s.playback != nullptr)
		throw std::invalid_argument("The Tracktion session already has a hosted device");
	auto& devices = s.engine.getDeviceManager();
	auto* output = devices.deviceManager.getCurrentAudioDevice();
	if (s.systemOutput && output != nullptr && output->isOpen())
		return;
	devices.initialise(0, 2);
	output = devices.deviceManager.getCurrentAudioDevice();
	if (output == nullptr || !output->isOpen() || output->getActiveOutputChannels().countNumberOfSetBits() < 2)
	{
		devices.deviceManager.closeAudioDevice();
		throw std::invalid_argument("Tracktion could not open the default stereo output device");
	}
	s.systemOutput = true;
	devices.dispatchPendingUpdates();
	s.edit->getTransport().ensureContextAllocated();
}

bool Session::playbackReady() const
{
	auto& s = *state;
	auto* output = s.systemOutput ? s.engine.getDeviceManager().deviceManager.getCurrentAudioDevice() : nullptr;
	if (s.playback == nullptr && (output == nullptr || !output->isOpen()))
		return false;
	auto& cache = s.engine.getAudioFileManager().cache;
	for (auto* track : te::getAudioTracks(*s.edit))
		for (auto* clip : track->getClips())
		{
			const auto file = clip->getSourceFileReference().getFile();
			if (!file.existsAsFile() || !cache.hasMappedReader(te::AudioFile(s.engine, file), 0))
				return false;
		}
	return true;
}

bool Session::isPlaying() const { return state->edit->getTransport().isPlaying(); }

void Session::play(Frame start)
{
	auto& s = *state;
	s.requireNoRecording();
	if (s.playback == nullptr && !s.systemOutput)
		throw std::invalid_argument("Prepare the Tracktion playback device before playing");
	auto& transport = s.edit->getTransport();
	transport.setPosition(s.position(start));
	transport.play(false);
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
	state->edit->getTransport().stop(false, false, false);
}

bool Session::processPlaybackBlock(juce::AudioBuffer<float>& audio, juce::MidiBuffer& midi) noexcept
{
	const auto& s = *state;
	audio.clear();
	if (s.playback == nullptr || audio.getNumChannels() != 2 || audio.getNumSamples() != s.playbackBlockFrames)
		return false;
	s.playback->processBlock(audio, midi);
	return true;
}

}
