/* SPDX-License-Identifier: AGPL-3.0-only */
#include "processor.h"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <new>
#include <stdexcept>

using namespace soundscaper::effects;
thread_local bool rendering = false;
thread_local size_t allocations = 0;
void *operator new(std::size_t size)
{
	if (rendering) ++allocations;
	if (auto *memory = std::malloc(size == 0 ? 1 : size)) return memory;
	throw std::bad_alloc();
}
void *operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void *memory) noexcept { std::free(memory); }
void operator delete[](void *memory) noexcept { std::free(memory); }
void operator delete(void *memory, std::size_t) noexcept { std::free(memory); }
void operator delete[](void *memory, std::size_t) noexcept { std::free(memory); }
void require(bool ok, const char *message) { if (!ok) throw std::runtime_error(message); }
void physical(Processor &processor, uint32_t index, float value)
{
	require(processor.setParameter(index, effectSpec(processor.kind).parameters[index].normalized(value)), "physical parameter");
}
void render(Processor &processor, juce::AudioBuffer<float> &audio)
{
	rendering = true;
	const bool result = processor.process(audio);
	rendering = false;
	require(result, "render failed");
	for (int channel = 0; channel < audio.getNumChannels(); ++channel)
		for (int frame = 0; frame < audio.getNumSamples(); ++frame)
			require(std::isfinite(audio.getSample(channel, frame)), "non-finite output");
}
void catalogue()
{
	require(effectCatalog.size() == 18, "complete catalogue");
	for (const auto &effect : effectCatalog) {
		std::cout << effect.name << '\n';
		for (const double rate : {8000.0, 48000.0, 96000.0, 192000.0}) {
			Processor processor(effect.kind);
			require(processor.prepare(rate, 256), "prepare catalogue");
			const auto saved = processor.saveState();
			for (uint32_t index = 0; index < effect.parameterCount; ++index) {
				for (double value : {0.0, 0.37, 1.0}) {
					require(processor.setParameter(index, value), "parameter extremes");
					juce::AudioBuffer<float> audio(2, 17);
					for (int block = 0; block < 24; ++block) {
						for (int channel = 0; channel < 2; ++channel)
							for (int frame = 0; frame < 17; ++frame)
								audio.setSample(channel, frame, static_cast<float>(0.1 * std::sin((block * 17 + frame) * 0.1)));
						render(processor, audio);
					}
				}
				require(processor.setParameter(index, effect.parameters[index].normalized(effect.parameters[index].initial)), "restore parameter");
			}
			require(processor.loadState(saved.getData(), saved.getSize()), "restore catalogue state");
			require(processor.saveState() == saved, "state round trip");
			require(processor.reset(), "seek reset");
			juce::AudioBuffer<float> silence(2, 256); silence.clear(); render(processor, silence);
			if (effect.kind != Kind::bias) require(silence.getMagnitude(0, 256) < 1e-5f, "reset leaked previous history");
		}
	}
	require(allocations == 0, "C++ allocation in audio callback");
}
void oracles()
{
	juce::AudioBuffer<float> audio(2, 256);
	Processor delay(Kind::delay);
	physical(delay, 0, 1); physical(delay, 1, 50); physical(delay, 2, 100);
	require(delay.prepare(8000, 256), "prepare delay");
	audio.clear(); audio.setSample(0, 0, 1); render(delay, audio);
	require(std::abs(audio.getSample(0, 8) - 1) < 1e-5f && std::abs(audio.getSample(0, 16) - 0.5f) < 1e-5f
		&& audio.getSample(0, 0) == 0 && audio.getMagnitude(1, 0, 256) == 0, "delay timing, feedback and channel isolation");
	Processor bias(Kind::bias); physical(bias, 0, 0.25f); require(bias.prepare(48000, 256), "prepare bias");
	audio.clear(); render(bias, audio); require(std::abs(audio.getSample(0, 100) - 0.25f) < 1e-5f, "bias amplitude");
	Processor shape(Kind::waveshaper); physical(shape, 0, 0); require(shape.prepare(48000, 256), "prepare waveshaper");
	audio.clear(); audio.setSample(0, 0, 0.5f); render(shape, audio);
	require(std::abs(audio.getSample(0, 0) - std::tanh(0.5f)) < 1e-5f, "tanh transfer function");
	Processor panner(Kind::panner); physical(panner, 0, -1); require(panner.prepare(48000, 256), "prepare panner");
	for (int channel = 0; channel < 2; ++channel) for (int frame = 0; frame < 256; ++frame) audio.setSample(channel, frame, 1);
	render(panner, audio); require(audio.getSample(0, 255) > 0.9f && audio.getSample(1, 255) == 0, "pan left");
	Processor fir(Kind::firFilter); require(fir.prepare(48000, 256), "prepare FIR");
	audio.clear(); audio.setSample(0, 0, 1); render(fir, audio);
	float sum = 0; for (int i = 0; i < 65; ++i) { sum += audio.getSample(0, i);
		require(std::abs(audio.getSample(0, i) - audio.getSample(0, 64 - i)) < 1e-6f, "linear phase FIR"); }
	require(std::abs(sum - 1) < 1e-5f && fir.latencyFrames() == 32, "FIR DC gain and latency");
	for (Kind kind : {Kind::compressor, Kind::noiseGate, Kind::limiter}) {
		Processor dynamics(kind); require(dynamics.prepare(48000, 256), "prepare dynamics");
		for (int block = 0; block < 1000; ++block) {
			for (int channel = 0; channel < 2; ++channel) for (int i = 0; i < 256; ++i) audio.setSample(channel, i, kind == Kind::noiseGate ? 0.0001f : 1);
			render(dynamics, audio);
		}
		require(audio.getMagnitude(0, 256) < (kind == Kind::noiseGate ? 1e-6f : kind == Kind::limiter ? 0.95f : 0.5f), "dynamics steady-state attenuation");
	}
}
int main()
{
	try { catalogue(); oracles(); std::cout << "Catalogue, realtime, state, reset and independent PCM oracles passed\n"; return 0; }
	catch (const std::exception &error) { std::cerr << error.what() << '\n'; return 1; }
}
