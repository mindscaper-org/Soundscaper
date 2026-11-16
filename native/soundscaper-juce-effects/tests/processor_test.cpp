/* SPDX-License-Identifier: AGPL-3.0-only */

#include "processor.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <cstdlib>
#include <new>

thread_local bool processing = false;
thread_local size_t realtimeAllocations = 0;
void *operator new(std::size_t size)
{
	if (processing) ++realtimeAllocations;
	if (auto *memory = std::malloc(size == 0 ? 1 : size)) return memory;
	throw std::bad_alloc();
}
void *operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void *memory) noexcept { std::free(memory); }
void operator delete[](void *memory) noexcept { std::free(memory); }
void operator delete(void *memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void *memory, std::size_t) noexcept { std::free(memory); }

using namespace soundscaper::effects;

void require(bool value, const char *message)
{
	if (!value) throw std::runtime_error(message);
}

int main()
{
	try {
		Processor gain(Kind::gain);
		require(gain.setParameter(0, 0.5), "gain parameter"); // -24 dB
		require(gain.prepare(48000, 256), "prepare gain");
		juce::AudioBuffer<float> audio(2, 256);
		for (int channel = 0; channel < 2; ++channel)
			for (int frame = 0; frame < 256; ++frame) audio.setSample(channel, frame, 1.0f);
		require(gain.process(audio), "process gain");
		require(std::abs(audio.getSample(0, 0) - std::pow(10.0f, -24.0f / 20.0f)) < 1e-6f, "gain amplitude");
		require(!gain.setParameter(0, NAN) && !gain.setParameter(0, 1.01), "invalid parameter");

		Processor reverb(Kind::convolution);
		require(reverb.setParameter(0, 1.0), "wet mix");
		juce::AudioBuffer<float> ir(2, 600);
		ir.clear();
		ir.setSample(0, 0, 0.5f); ir.setSample(0, 300, 0.25f);
		ir.setSample(1, 0, -0.5f); ir.setSample(1, 511, 0.125f);
		require(reverb.setImpulse(ir, 48000, "Test room"), "load impulse");
		require(reverb.prepare(48000, 256), "prepare convolution");
		const auto state = reverb.saveState();
		Processor restored(Kind::convolution);
		require(restored.prepare(48000, 256), "prepare restored");
		require(restored.loadState(state.getData(), state.getSize()), "restore embedded IR after activation");
		for (int block = 0; block < 3; ++block) {
			audio.setSize(2, block == 2 ? 88 : 256, false, false, true);
			audio.clear();
			if (block == 0) { audio.setSample(0, 0, 1); audio.setSample(1, 0, 1); }
			require(restored.process(audio), "restored convolution");
			for (int frame = 0; frame < audio.getNumSamples(); ++frame) {
				const int absolute = block * 256 + frame;
				const float left = absolute == 0 ? 0.5f : absolute == 300 ? 0.25f : 0;
				const float right = absolute == 0 ? -0.5f : absolute == 511 ? 0.125f : 0;
				require(std::abs(audio.getSample(0, frame) - left) < 1e-5f, "left IR and tail");
				require(std::abs(audio.getSample(1, frame) - right) < 1e-5f, "right IR and tail");
			}
		}
		require(!gain.loadState(state.getData(), state.getSize()), "cross-effect state rejected");
		require(!restored.loadState(state.getData(), state.getSize() - 1), "truncated state rejected");
		require(restored.saveState() == state, "failed restore preserves state");
		require(restored.reset(), "seek/reset");
		audio.clear(); audio.setSample(0, 0, 1);
		require(restored.process(audio) && std::abs(audio.getSample(0, 0) - 0.5f) < 1e-5f, "reset retains IR");
		juce::AudioBuffer<float> mono(1, 1); mono.setSample(0, 0, 1);
		Processor delayed(Kind::convolution);
		require(delayed.setParameter(0, 1) && delayed.setParameter(1, 2.0 / 48000), "pre-delay controls");
		require(delayed.setImpulse(mono, 48000, "Mono") && delayed.prepare(48000, 256), "mono IR");
		audio.clear(); audio.setSample(0, 0, 1); audio.setSample(1, 0, 1);
		processing = true;
		const bool delayedResult = delayed.process(audio);
		processing = false;
		require(delayedResult && std::abs(audio.getSample(0, 2) - 1) < 1e-5f
			&& std::abs(audio.getSample(1, 2) - 1) < 1e-5f && std::abs(audio.getSample(0, 0)) < 1e-5f, "stereo mono-IR and pre-delay");
		require(restored.setImpulse(mono, 48000, "Replacement"), "prepare IR replacement");
		for (int block = 0; block < 30; ++block) {
			for (int channel = 0; channel < 2; ++channel)
				for (int frame = 0; frame < audio.getNumSamples(); ++frame) audio.setSample(channel, frame, 1);
			processing = true;
			const bool result = restored.process(audio);
			processing = false;
			require(result, "IR crossfade");
		}
		require(std::abs(audio.getSample(0, 0) - 1) < 1e-5f, "IR crossfade completes");
		require(realtimeAllocations == 0, "audio processing allocated C++ objects");
		const auto file = juce::File::createTempFile(".wav");
		juce::WavAudioFormat wav;
		std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream>(file);
		auto writer = wav.createWriterFor(stream, juce::AudioFormatWriterOptions()
			.withSampleRate(48000).withNumChannels(1).withBitsPerSample(16));
		mono.setSample(0, 0, 0.5f);
		require(writer && writer->writeFromAudioSampleBuffer(mono, 0, 1), "write independent WAV fixture");
		writer.reset();
		Processor fileReverb(Kind::convolution); juce::String error;
		require(fileReverb.setParameter(0, 1) && fileReverb.loadImpulseFile(file, error), "load WAV impulse");
		require(file.deleteFile(), "remove original IR file");
		const auto embedded = fileReverb.saveState();
		Processor reopened(Kind::convolution);
		require(reopened.prepare(96000, 256) && reopened.loadState(embedded.getData(), embedded.getSize()), "restore WAV IR at another context rate");
		audio.clear(); audio.setSample(0, 0, 1);
		require(reopened.process(audio) && audio.getMagnitude(0, audio.getNumSamples()) > 0.1f,
			"embedded IR survives deletion and sample-rate conversion");
		std::cout << "JUCE gain, embedded stereo IR, tail, restore and reset passed\n";
		return 0;
	} catch (const std::exception &error) {
		std::cerr << error.what() << '\n';
		return 1;
	}
}
