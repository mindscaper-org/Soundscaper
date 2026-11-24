// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
using Setup = juce::AudioDeviceManager::AudioDeviceSetup;
constexpr int maxDevices = 64;
constexpr int maxHosts = 16;

std::string choiceId(const juce::String& name)
{
	return juce::String::toHexString(name.hashCode64()).paddedLeft('0', 16).toStdString();
}

DeviceChoice choice(const juce::String& name)
{
	juce::String label;
	for (const auto character : name.substring(0, 96))
		label += juce::String::charToString(character < 32 || character == 127 ? ' ' : character);
	return {choiceId(name), label.toStdString()};
}

std::vector<DeviceChoice> choices(const juce::StringArray& names)
{
	std::vector<DeviceChoice> result;
	for (const auto& name : names)
	{
		if (result.size() == maxDevices) break;
		if (name.isNotEmpty()) result.push_back(choice(name));
	}
	return result;
}

juce::AudioIODeviceType& deviceType(juce::AudioDeviceManager& manager, const std::string& id)
{
	const auto& types = manager.getAvailableDeviceTypes();
	for (int index = 0; index < std::min(types.size(), maxHosts); ++index)
		if (auto* type = types[index]; choiceId(type->getTypeName()) == id)
			return *type;
	throw std::invalid_argument("The selected Tracktion audio host is unavailable");
}

juce::String deviceName(const juce::StringArray& names, const std::string& id, int defaultIndex)
{
	if (id.empty())
		return names[defaultIndex];
	for (int index = 0; index < std::min(names.size(), maxDevices); ++index)
		if (choiceId(names[index]) == id) return names[index];
	throw std::invalid_argument("The selected Tracktion audio device is unavailable");
}

juce::String selectedInput(juce::AudioIODeviceType& type, const AudioSetup& requested, const juce::String& outputName)
{
	const auto names = type.getDeviceNames(true);
	const auto separate = type.hasSeparateInputsAndOutputs();
	if (!separate && requested.inputId.empty()) return names.contains(outputName) ? outputName : juce::String{};
	const auto name = deviceName(names, requested.inputId, type.getDefaultDeviceIndex(true));
	if (!separate && name != outputName)
		throw std::invalid_argument("The selected Tracktion audio host requires one device for input and output");
	return name;
}

// Select the target JUCE backend and exact endpoints without opening its defaults first.
bool openDevice(juce::AudioDeviceManager& manager, const juce::String& type, const Setup& setup)
{
	auto xml = manager.createStateXml();
	if (!xml) xml = std::make_unique<juce::XmlElement>("DEVICESETUP");
	xml->removeAttribute("audioDeviceName");
	xml->setAttribute("deviceType", type);
	xml->setAttribute("audioOutputDeviceName", setup.outputDeviceName);
	xml->setAttribute("audioInputDeviceName", setup.inputDeviceName);
	xml->setAttribute("audioDeviceRate", setup.sampleRate);
	xml->setAttribute("audioDeviceBufferSize", setup.bufferSize);
	xml->setAttribute("audioDeviceOutChans", setup.outputChannels.toString(2));
	xml->setAttribute("audioDeviceInChans", setup.inputChannels.toString(2));
	manager.closeAudioDevice();
	const auto error = manager.initialise(setup.inputChannels.countNumberOfSetBits(),
	                                      setup.outputChannels.countNumberOfSetBits(), xml.get(), false);
	auto* device = manager.getCurrentAudioDevice();
	return error.isEmpty() && device != nullptr && device->isOpen() && device->getTypeName() == type
		&& device->getActiveOutputChannels() == setup.outputChannels && device->getActiveInputChannels() == setup.inputChannels;
}

void validateSetup(const AudioSetup& requested)
{
	if (requested.inputChannel < 0 || requested.inputChannel > 63 || requested.outputChannel < 0 || requested.outputChannel > 62)
		throw std::invalid_argument("The Tracktion audio channel is outside the supported range");
	if (requested.sampleRate < 0 || (requested.sampleRate && requested.sampleRate < 22050) || requested.sampleRate > 192000
	    || requested.blockSize < 0 || requested.blockSize > 8192)
		throw std::invalid_argument("The Tracktion audio format is outside the supported range");
}

void checkFormat(juce::AudioIODevice& device, const AudioSetup& requested)
{
	if (requested.sampleRate && !device.getAvailableSampleRates().contains(static_cast<double>(requested.sampleRate)))
		throw std::invalid_argument("The selected Tracktion audio device does not advertise that sample rate");
	if (requested.blockSize && !device.getAvailableBufferSizes().contains(requested.blockSize))
		throw std::invalid_argument("The selected Tracktion audio device does not advertise that buffer size");
}

bool usesRequestedFormat(const Setup& actual, const Setup& wanted)
{
	return actual.sampleRate >= 22050 && actual.sampleRate <= 192000
		&& (!wanted.sampleRate || actual.sampleRate == wanted.sampleRate)
		&& (!wanted.bufferSize || actual.bufferSize == wanted.bufferSize);
}
}

void SessionBehaviour::describeWaveDevices(std::vector<te::WaveDeviceDescription>& descriptions,
                                          juce::AudioIODevice& device, bool input)
{
	descriptions.clear();
	const auto channels = input ? device.getActiveInputChannels() : device.getActiveOutputChannels();
	if (channels.isZero()) return;
	const auto names = input ? device.getInputChannelNames() : device.getOutputChannelNames();
	juce::StringArray selected;
	for (auto index = channels.findNextSetBit(0); index >= 0; index = channels.findNextSetBit(index + 1))
		selected.add(names[index]);

	// The supported JUCE backends deliver the enabled channels in a compact
	// callback array. The hardware indices belong to the device setup only.
	descriptions.emplace_back(selected.joinIntoString(" + "), te::ChannelConfiguration::canonical(channels.countNumberOfSetBits()), true);
}

AudioHosts Session::audioHosts()
{
	auto& s = *state;
	if (s.playback != nullptr) throw std::invalid_argument("Tracktion is already using a hosted device");
	AudioHosts result;
	result.selected = s.systemAudioSetup;
	const auto& types = s.engine.getDeviceManager().deviceManager.getAvailableDeviceTypes();
	for (int index = 0; index < std::min(types.size(), maxHosts); ++index)
	{
		auto* type = types[index];
		type->scanForDevices();
		if (!type->getDeviceNames(false).isEmpty()) result.hosts.push_back(choice(type->getTypeName()));
	}
	return result;
}

AudioDevices Session::audioDevices(const std::string& hostId)
{
	auto& s = *state;
	if (s.playback != nullptr) throw std::invalid_argument("Tracktion is already using a hosted device");
	auto& type = deviceType(s.engine.getDeviceManager().deviceManager, hostId);
	type.scanForDevices();
	return {choices(type.getDeviceNames(true)), choices(type.getDeviceNames(false)), type.hasSeparateInputsAndOutputs()};
}

juce::String Session::State::recordingInputName() const
{
	auto* type = engine.getDeviceManager().deviceManager.getCurrentDeviceTypeObject();
	if (type != nullptr)
	{
		type->scanForDevices();
		const auto input = preferredAudioSetup ? selectedInput(*type, *preferredAudioSetup, systemOutputName)
		                                     : type->getDeviceNames(true)[type->getDefaultDeviceIndex(true)];
		if (input.isNotEmpty()) return input;
	}
	throw std::invalid_argument("The Tracktion recording input is unavailable");
}

void Session::State::initialiseSystemDevices()
{
	if (systemDeviceManagerInitialised) return;
	engine.getDeviceManager().initialise(0, 0);
	systemDeviceManagerInitialised = true;
}

void Session::State::openInputOnly()
{
	if (!preferredAudioSetup) throw std::invalid_argument("The Tracktion default audio output is unavailable");
	const auto& selected = *preferredAudioSetup;
	auto& devices = engine.getDeviceManager();
	auto& manager = devices.deviceManager;
	auto& type = deviceType(manager, selected.hostId);
	if (!type.hasSeparateInputsAndOutputs())
		throw std::invalid_argument("The selected Tracktion audio host requires playback and recording on the same device");
	type.scanForDevices();
	const auto input = selectedInput(type, selected, {});
	const std::unique_ptr<juce::AudioIODevice> probe(input.isNotEmpty() ? type.createDevice({}, input) : nullptr);
	if (!probe || probe->getLastError().isNotEmpty() || selected.inputChannel >= probe->getInputChannelNames().size())
		throw std::invalid_argument("The selected Tracktion recording input or channel is unavailable");
	checkFormat(*probe, selected);
	Setup next;
	next.inputDeviceName = input;
	next.inputChannels.setBit(selected.inputChannel);
	next.sampleRate = selected.sampleRate;
	next.bufferSize = selected.blockSize;
	initialiseSystemDevices();
	if (!openDevice(manager, type.getTypeName(), next) || !usesRequestedFormat(manager.getAudioDeviceSetup(), next))
		throw std::invalid_argument("Tracktion could not open the selected recording input");
	outputWasInterrupted = true;
	systemOutput = false;
	manager.dispatchPendingMessages();
	devices.rescanWaveDeviceList();
	devices.dispatchPendingUpdates();
}

void Session::rememberAudioSetup(AudioSetup requested)
{
	state->requireNoRecording();
	validateSetup(requested);
	if (state->playback != nullptr || state->hasSystemOutput() || isPlaying())
		throw std::invalid_argument("Tracktion already has an active audio setup");
	state->preferredAudioSetup = std::move(requested);
}

AppliedAudioSetup Session::setAudioSetup(AudioSetup requested, AudioSetupMode mode)
{
	auto& s = *state;
	s.requireNoRecording();
	auto& transport = s.edit->getTransport();
	if (s.playback != nullptr || transport.isPlaying())
		throw std::invalid_argument("Stop Tracktion playback before changing audio devices");
	validateSetup(requested);

	auto& devices = s.engine.getDeviceManager();
	auto& manager = devices.deviceManager;
	auto& type = deviceType(manager, requested.hostId);
	type.scanForDevices();
	const auto typeName = type.getTypeName();
	const auto outputName = deviceName(type.getDeviceNames(false), requested.outputId, type.getDefaultDeviceIndex(false));
	if (outputName.isEmpty())
		throw std::invalid_argument("The selected Tracktion audio output is unavailable");
	{
		const auto inputName = mode == AudioSetupMode::validateInput ? selectedInput(type, requested, outputName) : juce::String{};
		const std::unique_ptr<juce::AudioIODevice> probe(type.createDevice(outputName, inputName));
		if (!probe || probe->getLastError().isNotEmpty())
			throw std::invalid_argument("Tracktion could not inspect the selected audio devices");
		if (requested.outputChannel + 1 >= probe->getOutputChannelNames().size()
		    || (inputName.isNotEmpty() && requested.inputChannel >= probe->getInputChannelNames().size()))
			throw std::invalid_argument("The selected Tracktion audio channel is unavailable");
		checkFormat(*probe, requested);
	}

	const auto previous = manager.getAudioDeviceSetup();
	const auto previousHost = manager.getCurrentAudioDeviceType();
	const auto hadOutput = s.systemOutput;
	s.initialiseSystemDevices();

	Setup next;
	next.outputDeviceName = outputName;
	next.outputChannels.setRange(requested.outputChannel, 2, true);
	next.sampleRate = requested.sampleRate;
	next.bufferSize = requested.blockSize;
	const auto opened = openDevice(manager, typeName, next);
	const auto actual = manager.getAudioDeviceSetup();
	if (!opened || !usesRequestedFormat(actual, next))
	{
		manager.closeAudioDevice();
		s.systemOutput = hadOutput && openDevice(manager, previousHost, previous);
		manager.dispatchPendingMessages();
		devices.dispatchPendingUpdates();
		throw std::invalid_argument("Tracktion could not open the selected audio format and routes");
	}

	s.systemOutput = true;
	s.outputWasInterrupted = false;
	s.preferredAudioSetup = requested;
	s.systemAudioSetup = AppliedAudioSetup{std::move(requested), static_cast<int>(std::lround(actual.sampleRate)), actual.bufferSize};
	s.systemOutputName = outputName;
	s.systemHostName = typeName;
	manager.dispatchPendingMessages();
	devices.rescanWaveDeviceList();
	devices.dispatchPendingUpdates();
	transport.ensureContextAllocated();
	return *s.systemAudioSetup;
}
}
