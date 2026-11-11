/* SPDX-License-Identifier: AGPL-3.0-only */
#include <juce_audio_processors/juce_audio_processors.h>
#include <array>

class MidiFixture final : public juce::AudioProcessor {
public:
	MidiFixture() : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}
	const juce::String getName() const override { return "SoundscaperMidiFixture"; }
	void prepareToPlay(double, int) override { voices.fill(0.0f); }
	void releaseResources() override {}
	void processBlock(juce::AudioBuffer<float> &buffer, juce::MidiBuffer &midi) override
	{
		buffer.clear();
		auto event = midi.begin();
		for (int frame = 0; frame < buffer.getNumSamples(); ++frame) {
			while (event != midi.end() && (*event).samplePosition <= frame) {
				const auto message = (*event).getMessage();
				const auto channel = static_cast<size_t>(message.getChannel() - 1);
				if (message.isNoteOn()) voices[channel] = message.getFloatVelocity();
				if (message.isNoteOff() || message.isAllNotesOff() || message.isAllSoundOff()) voices[channel] = 0;
				++event;
			}
			for (int channel = 0; channel < buffer.getNumChannels(); ++channel) buffer.setSample(channel, frame, voices[4]);
		}
	}
	bool isBusesLayoutSupported(const BusesLayout &layout) const override { return layout.getMainOutputChannelSet() == juce::AudioChannelSet::stereo(); }
	juce::AudioProcessorEditor *createEditor() override { return nullptr; }
	bool hasEditor() const override { return false; }
	bool acceptsMidi() const override { return true; }
	bool producesMidi() const override { return false; }
	double getTailLengthSeconds() const override { return 0; }
	int getNumPrograms() override { return 1; }
	int getCurrentProgram() override { return 0; }
	void setCurrentProgram(int) override {}
	const juce::String getProgramName(int) override { return {}; }
	void changeProgramName(int, const juce::String &) override {}
	void getStateInformation(juce::MemoryBlock &state) override { state.setSize(1); *static_cast<char *>(state.getData()) = 1; }
	void setStateInformation(const void *, int) override {}
private:
	std::array<float, 16> voices{};
};
juce::AudioProcessor *JUCE_CALLTYPE createPluginFilter() { return new MidiFixture(); }
