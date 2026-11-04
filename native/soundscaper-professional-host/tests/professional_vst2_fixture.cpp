/* SPDX-License-Identifier: AGPL-3.0-only */

#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <cstdlib>
#include <cstring>
#include <thread>

class Vst2Fixture final : public juce::AudioProcessor {
public:
	Vst2Fixture() : juce::AudioProcessor(BusesProperties()
		.withInput("Input", juce::AudioChannelSet::stereo(), false)
		.withOutput("Output", juce::AudioChannelSet::stereo(), false))
	{
		// VST3 hosts must activate main buses even without kDefaultActive.
		if (wrapperType != wrapperType_VST3) enableAllBuses();
		addParameter(gain = new juce::AudioParameterFloat(juce::ParameterID{"gain", 1}, "Gain", 0.0F, 1.0F, 0.5F));
		// Legacy plug-ins can expose an automatable parameter with an empty name.
		addParameter(new juce::AudioParameterFloat(juce::ParameterID{"unnamed", 1}, "", 0.0F, 1.0F, 0.0F));
		setLatencySamples(8);
	}
	const juce::String getName() const override { return "SoundscaperVST2Fixture"; }
	void prepareToPlay(double, int) override { delay = {}; position = 0; }
	void releaseResources() override {}
	void processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &) override
	{
		for (int frame = 0; frame < buffer.getNumSamples(); ++frame) {
			for (int channel = 0; channel < buffer.getNumChannels(); ++channel) {
				auto &sample = delay[static_cast<size_t>(channel)][position];
				const float input = buffer.getSample(channel, frame) * gain->get();
				buffer.setSample(channel, frame, sample);
				sample = input;
			}
			position = (position + 1) % 8;
		}
	}
	bool isBusesLayoutSupported(const BusesLayout &layout) const override
	{
		return layout.getMainInputChannelSet() == juce::AudioChannelSet::stereo()
			&& layout.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
	}
	juce::AudioProcessorEditor *createEditor() override { return new juce::GenericAudioProcessorEditor(*this); }
	bool hasEditor() const override { return true; }
	bool acceptsMidi() const override { return false; }
	bool producesMidi() const override { return false; }
	double getTailLengthSeconds() const override { return 0.0; }
	int getNumPrograms() override { return 1; }
	int getCurrentProgram() override { return 0; }
	void setCurrentProgram(int) override {}
	const juce::String getProgramName(int) override { return {}; }
	void changeProgramName(int, const juce::String &) override {}
	void getStateInformation(juce::MemoryBlock &state) override
	{
		if (std::this_thread::get_id() != controlThread) std::abort();
		const float value = gain->get();
		state.replaceAll(&value, sizeof(value));
	}
	void setStateInformation(const void *bytes, int length) override
	{
		if (std::this_thread::get_id() != controlThread) std::abort();
		float value = 0.0F;
		if (length != sizeof(value)) return;
		std::memcpy(&value, bytes, sizeof(value));
		if (std::isfinite(value) && value >= 0.0F && value <= 1.0F) *gain = value;
	}
private:
	// Linux VST2's wrapper owns a separate JUCE GUI thread. State must instead
	// stay on the host control thread that constructed this processor.
	const std::thread::id controlThread = std::this_thread::get_id();
	juce::AudioParameterFloat *gain = nullptr;
	std::array<std::array<float, 8>, 2> delay{};
	size_t position = 0;
};

juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new Vst2Fixture; }
