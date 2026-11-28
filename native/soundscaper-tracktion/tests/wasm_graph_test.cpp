// SPDX-License-Identifier: AGPL-3.0-only

#include <tracktion_graph/tracktion_graph.h>
#include <tracktion_graph/tracktion_graph/tracktion_TestUtilities.h>
#include <tracktion_graph/tracktion_graph/tracktion_TestNodes.h>

#include <iostream>

namespace
{
class FrameMarker final : public tracktion::graph::Node
{
public:
	tracktion::graph::NodeProperties getNodeProperties() override
	{
		return {.hasAudio = true, .numberOfChannels = 2};
	}

	bool isReadyToProcess() override { return true; }

	void process(ProcessContext& context) override
	{
		auto& audio = context.buffers.audio;
		auto frame = context.referenceSampleRange.getStart();
		for (choc::buffer::FrameCount index = 0; index < context.numSamples; ++index, ++frame)
		{
			const auto sample = static_cast<float>(frame % 64) / 64.0f;
			audio.getSample(0, index) = sample;
			audio.getSample(1, index) = -sample;
		}
	}
};
}

int main()
{
	constexpr choc::buffer::FrameCount blockSize = 128;
	tracktion::graph::NodePlayer player;
	player.setNode(tracktion::graph::makeGainNode(std::make_unique<FrameMarker>(), 0.5f), 48000, blockSize);

	choc::buffer::ChannelArrayBuffer<float> output(choc::buffer::Size::create(2, blockSize));
	tracktion_engine::MidiMessageArray midi;
	for (int64_t start = 17; start < 1041; start += blockSize)
	{
		output.clear();
		if (player.process({blockSize, {start, start + blockSize}, {output.getView(), midi}}) != 0)
			return 1;
		for (choc::buffer::FrameCount index = 0; index < blockSize; ++index)
		{
			const auto value = static_cast<float>((start + index) % 64) / 128.0f;
			if (output.getSample(0, index) != value || output.getSample(1, index) != -value)
				return 1;
		}
	}

	std::cout << "Tracktion's WASM graph rendered 1024 stereo frames exactly.\n";
	return 0;
}
