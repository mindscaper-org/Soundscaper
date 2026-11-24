// SPDX-License-Identifier: AGPL-3.0-only

#include "session_state.h"
#include "pipewire_inventory.h"

#include <algorithm>
#include <array>
#include <atomic>
#include <utility>

extern "C"
{
#include "pipewire_session.h"

uint32_t soundscaper_pipewire_buffered_frames(const soundscaper_pipewire_session*);
uint32_t soundscaper_pipewire_capacity_frames(const soundscaper_pipewire_session*);
uint32_t soundscaper_pipewire_quantum(const soundscaper_pipewire_session*);
int soundscaper_pipewire_disconnected(const soundscaper_pipewire_session*);
uint32_t soundscaper_pipewire_read_interleaved(soundscaper_pipewire_session*, float*, uint32_t);
}

namespace soundscaper::tracktion_backend
{
namespace
{
constexpr auto driverName = "PipeWire";
constexpr int defaultBlock = 256;

struct Endpoint
{
	juce::String name;
	juce::String target;
	int channels = 0;
};

using Stream = std::unique_ptr<soundscaper_pipewire_session, decltype(&soundscaper_pipewire_close)>;

class PipeWireDevice final : public juce::AudioIODevice, private juce::Thread
{
public:
	PipeWireDevice(Endpoint output, Endpoint input)
		: AudioIODevice(output.name.isNotEmpty() ? output.name : input.name, driverName),
		  Thread("Tracktion PipeWire audio"), outputEndpoint(std::move(output)), inputEndpoint(std::move(input))
	{}

	~PipeWireDevice() override { close(); }

	const juce::String& endpointName(bool input) const { return input ? inputEndpoint.name : outputEndpoint.name; }
	juce::StringArray getOutputChannelNames() override { return channelNames(outputEndpoint.channels, "Playback "); }
	juce::StringArray getInputChannelNames() override { return channelNames(inputEndpoint.channels, "Capture "); }
	juce::Array<double> getAvailableSampleRates() override { return {22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000}; }
	juce::Array<int> getAvailableBufferSizes() override { return {64, 128, 256, 512, 1024, 2048, 4096, 8192}; }
	int getDefaultBufferSize() override { return defaultBlock; }
	int getCurrentBufferSizeSamples() override { return blockSize; }
	double getCurrentSampleRate() override { return sampleRate; }
	int getCurrentBitDepth() override { return 32; }
	juce::BigInteger getActiveOutputChannels() const override { return outputMask; }
	juce::BigInteger getActiveInputChannels() const override { return inputMask; }
	int getOutputLatencyInSamples() override
	{
		return outputStream ? blockSize + static_cast<int>(soundscaper_pipewire_quantum(outputStream.get())) : 0;
	}
	int getInputLatencyInSamples() override { return 0; }
	bool isOpen() override { return healthy.load(std::memory_order_acquire); }
	bool isPlaying() override { return isOpen() && isThreadRunning(); }
	juce::String getLastError() override { return error; }

	juce::String open(const juce::BigInteger& inputs, const juce::BigInteger& outputs, double rate, int frames) override
	{
		close();
		error.clear();
		if ((inputs.isZero() && outputs.isZero())
		    || inputs.getHighestBit() >= inputEndpoint.channels || outputs.getHighestBit() >= outputEndpoint.channels
		    || !getAvailableSampleRates().contains(rate) || !getAvailableBufferSizes().contains(frames))
			return error = "PipeWire cannot use the requested audio format or channels";

		sampleRate = static_cast<int>(rate);
		blockSize = frames;
		outputMask = outputs;
		inputMask = inputs;
		const auto inputWidth = inputs.getHighestBit() + 1;
		const auto outputWidth = outputs.getHighestBit() + 1;
		inputInterleaved.resize(static_cast<size_t>(frames * inputWidth));
		inputBuffer.setSize(inputs.countNumberOfSetBits(), frames);
		outputBuffer.setSize(outputWidth, frames);
		packedOutput.clearQuick();
		inputIndices.clearQuick();
		for (int channel = 0; channel < outputWidth; ++channel)
			if (outputs[channel]) packedOutput.add(outputBuffer.getWritePointer(channel));
		for (int channel = 0; channel < inputWidth; ++channel)
			if (inputs[channel]) inputIndices.add(channel);

		if (outputWidth > 0) outputStream = openStream(outputEndpoint, SOUNDSCAPER_DEVICE_OUTPUT, outputWidth);
		if (error.isEmpty() && inputWidth > 0) inputStream = openStream(inputEndpoint, SOUNDSCAPER_DEVICE_INPUT, inputWidth);
		if (error.isNotEmpty())
		{
			close();
			return error;
		}
		healthy.store(true, std::memory_order_release);
		return {};
	}

	void close() override
	{
		stop();
		healthy.store(false, std::memory_order_release);
		inputStream.reset();
		outputStream.reset();
		inputMask.clear();
		outputMask.clear();
	}

	void start(juce::AudioIODeviceCallback* consumer) override
	{
		if (callback == consumer || !isOpen() || consumer == nullptr) return;
		stop();
		callback = consumer;
		callback->audioDeviceAboutToStart(this);
		if (!startThread(Priority::high))
		{
			error = "The Tracktion PipeWire audio thread could not start";
			healthy.store(false, std::memory_order_release);
			stop();
		}
	}

	void stop() override
	{
		signalThreadShouldExit();
		notify();
		waitForThreadToExit(-1);
		if (auto* previous = std::exchange(callback, nullptr)) previous->audioDeviceStopped();
	}

private:
	static juce::StringArray channelNames(int count, const char* prefix)
	{
		juce::StringArray result;
		for (int channel = 0; channel < count; ++channel) result.add(prefix + juce::String(channel + 1));
		return result;
	}

	Stream openStream(const Endpoint& endpoint, soundscaper_device_direction direction, int channels)
	{
		soundscaper_pipewire_session* stream = nullptr;
		soundscaper_audio_granted granted{};
		const auto result = soundscaper_pipewire_open(endpoint.target.toRawUTF8(), direction, 0,
			static_cast<uint32_t>(sampleRate), static_cast<uint32_t>(blockSize), static_cast<uint32_t>(channels),
			&stream, &granted);
		if (result != SOUNDSCAPER_AUDIO_OPEN_OK)
		{
			error = juce::String::fromUTF8(granted.detail);
			if (error.isEmpty()) error = "PipeWire could not open the requested stream";
		}
		return Stream(stream, soundscaper_pipewire_close);
	}

	void run() override
	{
		while (!threadShouldExit())
		{
			const bool outputAvailable = outputStream && !soundscaper_pipewire_disconnected(outputStream.get());
			const auto outputBuffered = outputAvailable ? soundscaper_pipewire_buffered_frames(outputStream.get()) : 0;
			const auto block = static_cast<uint32_t>(blockSize);
			const auto quantum = outputAvailable ? soundscaper_pipewire_quantum(outputStream.get()) : 0;
			const auto capacity = outputAvailable ? soundscaper_pipewire_capacity_frames(outputStream.get()) : 0;
			const auto queueTarget = std::min(capacity, std::max(quantum, block) + block);
			const bool outputNeedsBlock = outputAvailable && outputBuffered + block <= queueTarget;
			if (inputStream)
			{
				const auto readable = soundscaper_pipewire_buffered_frames(inputStream.get());
				const bool inputLost = soundscaper_pipewire_disconnected(inputStream.get())
					|| soundscaper_pipewire_lost_frames(inputStream.get()) != 0;
				if (readable >= static_cast<uint32_t>(blockSize) || (inputLost && readable > 0))
				{
					const auto count = std::min(readable, static_cast<uint32_t>(blockSize));
					processInput(count, outputNeedsBlock);
					continue;
				}
				if (inputLost) break;
			}
			else
			{
				if (!outputAvailable) break;
				if (outputNeedsBlock)
				{
					process(blockSize, true);
					continue;
				}
			}
			wait(1);
		}

		if (!threadShouldExit()) healthy.store(false, std::memory_order_release);
	}

	void processInput(uint32_t requested, bool sendOutput)
	{
		const auto count = soundscaper_pipewire_read_interleaved(inputStream.get(), inputInterleaved.data(), requested);
		if (!count) return;
		const auto width = inputMask.getHighestBit() + 1;
		for (int channel = 0; channel < inputIndices.size(); ++channel)
		{
			auto* samples = inputBuffer.getWritePointer(channel);
			for (uint32_t frame = 0; frame < count; ++frame)
				samples[frame] = inputInterleaved[frame * static_cast<uint32_t>(width) + static_cast<uint32_t>(inputIndices[channel])];
		}
		process(static_cast<int>(count), sendOutput);
	}

	void process(int frames, bool sendOutput)
	{
		outputBuffer.clear(0, frames);
		callback->audioDeviceIOCallbackWithContext(inputBuffer.getArrayOfReadPointers(), inputIndices.size(),
			packedOutput.getRawDataPointer(), packedOutput.size(), frames, {});
		if (sendOutput)
			soundscaper_pipewire_write(outputStream.get(), outputBuffer.getArrayOfReadPointers(), static_cast<uint32_t>(frames), nullptr);
	}

	Endpoint outputEndpoint, inputEndpoint;
	Stream outputStream{nullptr, soundscaper_pipewire_close};
	Stream inputStream{nullptr, soundscaper_pipewire_close};
	juce::AudioBuffer<float> inputBuffer, outputBuffer;
	std::vector<float> inputInterleaved;
	juce::Array<float*> packedOutput;
	juce::Array<int> inputIndices;
	juce::BigInteger outputMask, inputMask;
	juce::AudioIODeviceCallback* callback = nullptr;
	std::atomic<bool> healthy{false};
	juce::String error;
	int sampleRate = 48000;
	int blockSize = defaultBlock;
};

class PipeWireDeviceType final : public juce::AudioIODeviceType
{
public:
	PipeWireDeviceType() : AudioIODeviceType(driverName) {}

	void scanForDevices() override
	{
		std::array<tracktion_pipewire_node, 128> nodes{};
		const auto count = tracktion_pipewire_nodes(nodes.data(), nodes.size());
		std::stable_sort(nodes.begin(), nodes.begin() + static_cast<std::ptrdiff_t>(count), [](const auto& a, const auto& b)
		{
			return a.priority > b.priority;
		});

		inputs.clear();
		outputs.clear();
		for (size_t index = 0; index < count; ++index)
		{
			const auto& node = nodes[index];
			auto& endpoints = node.input ? inputs : outputs;
			const juce::String name = juce::String::fromUTF8(node.name);
			if (endpoints.empty())
				endpoints.push_back(node.input ? Endpoint{"Default input (PipeWire)", "@DEFAULT_SOURCE@", node.channels}
				                               : Endpoint{"Default output (PipeWire)", "@DEFAULT_SINK@", node.channels});
			if (find(endpoints, name) == endpoints.end()) endpoints.push_back({name, name, node.channels});
		}
	}

	juce::StringArray getDeviceNames(bool input) const override
	{
		juce::StringArray result;
		for (const auto& entry : endpoints(input)) result.add(entry.name);
		return result;
	}

	int getDefaultDeviceIndex(bool input) const override { return endpoints(input).empty() ? -1 : 0; }
	bool hasSeparateInputsAndOutputs() const override { return true; }

	int getIndexOfDevice(juce::AudioIODevice* device, bool input) const override
	{
		const auto* pipewire = dynamic_cast<PipeWireDevice*>(device);
		if (!pipewire) return -1;
		const auto& entries = endpoints(input);
		const auto entry = find(entries, pipewire->endpointName(input));
		return entry == entries.end() ? -1 : static_cast<int>(std::distance(entries.begin(), entry));
	}

	juce::AudioIODevice* createDevice(const juce::String& output, const juce::String& input) override
	{
		const auto sink = find(outputs, output);
		const auto source = find(inputs, input);
		if ((!output.isEmpty() && sink == outputs.end()) || (!input.isEmpty() && source == inputs.end())
		    || (sink == outputs.end() && source == inputs.end()))
			return nullptr;
		return new PipeWireDevice(sink != outputs.end() ? *sink : Endpoint{}, source != inputs.end() ? *source : Endpoint{});
	}

private:
	const std::vector<Endpoint>& endpoints(bool input) const { return input ? inputs : outputs; }

	static std::vector<Endpoint>::const_iterator find(const std::vector<Endpoint>& entries, const juce::String& name)
	{
		return std::ranges::find(entries, name, &Endpoint::name);
	}

	std::vector<Endpoint> inputs, outputs;
};
}

void SessionBehaviour::addHostAudioIODeviceTypes(juce::OwnedArray<juce::AudioIODeviceType>& types)
{
	types.add(new PipeWireDeviceType());
}
}
