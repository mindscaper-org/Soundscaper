/* SPDX-License-Identifier: AGPL-3.0-only */

#include "juce_audio_adapter.h"
#include "audio_frame_ring.h"

#include <juce_audio_devices/juce_audio_devices.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <sstream>

namespace soundscaper {
namespace {

std::string escaped(const std::string &value)
{
	std::string output;
	output.reserve(value.size() + 2u);
	for (const char character : value) {
		if (character == '"' || character == '\\') output.push_back('\\');
		if (static_cast<unsigned char>(character) >= 0x20u) output.push_back(character);
	}
	return output;
}

void text(char *destination, const std::string &value)
{
	const size_t length = std::min(value.size(), static_cast<size_t>(SOUNDSCAPER_PRO_MAX_TEXT - 1u));
	std::memcpy(destination, value.data(), length);
	destination[length] = '\0';
}

class Session final : public JuceAudioSession, private juce::AudioIODeviceCallback {
public:
	Session(std::unique_ptr<juce::AudioIODevice> opened,
		const soundscaper_pro_audio_request &request, uint32_t callbackFrames, bool useSharedWasapi)
		: device(std::move(opened)), channelCount(request.channel_count), frameCount(request.period_frames),
		deviceFrames(callbackFrames), sampleRate(request.sample_rate), sharedWasapi(useSharedWasapi),
		playbackStartFrames(useSharedWasapi ? 2u * callbackFrames + request.period_frames : request.period_frames),
		captureEnabled(request.direction == 0u || request.direction == 2u),
		playbackEnabled(request.direction == 1u || request.direction == 2u),
		input(captureEnabled ? channelCount : 0u, queueFrames()),
		output(playbackEnabled ? channelCount : 0u, queueFrames()) {}

	~Session() override
	{
		device->stop();
		device->close();
	}

	soundscaper_pro_status read(float **planes, uint32_t channels, uint32_t frames) override
	{
		if (!captureEnabled || !shape(planes, channels, frames)) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		start();
		std::unique_lock<std::mutex> lock(waitMutex);
		const bool ready = captureReady.wait_for(lock, timeout(), [this] {
			return input.availableFrames() >= frameCount || failed.load(std::memory_order_acquire)
				|| stopped.load(std::memory_order_acquire);
		});
		if (!ready || failed.load(std::memory_order_acquire) || stopped.load(std::memory_order_acquire)
			|| !input.pop(planes, channels, frames)) return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
		captureStarted = true;
		return SOUNDSCAPER_PRO_OK;
	}

	soundscaper_pro_status write(
		const float *const *planes, uint32_t channels, uint32_t frames) override
	{
		if (!playbackEnabled || !shape(planes, channels, frames)) return SOUNDSCAPER_PRO_FORMAT_REFUSED;
		if (!output.push(planes, channels, frames)) return fail();
		start();
		if (failed.load(std::memory_order_acquire) || stopped.load(std::memory_order_acquire)) {
			return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
		}
		return SOUNDSCAPER_PRO_OK;
	}

private:
	template <typename Plane> bool shape(Plane planes, uint32_t channels, uint32_t frames) const
	{
		if (planes == nullptr || channels != channelCount || frames != frameCount) return false;
		for (uint32_t channel = 0; channel < channels; ++channel) if (planes[channel] == nullptr) return false;
		return true;
	}

	void audioDeviceIOCallbackWithContext(
		const float *const *inputs, int inputChannels, float *const *outputs,
		int outputChannels, int frames, const juce::AudioIODeviceCallbackContext &) override
	{
		if (frames != static_cast<int>(deviceFrames)) return audioFault(outputs, outputChannels, frames);
		if (captureEnabled && !input.push(inputs, static_cast<uint32_t>(inputChannels), deviceFrames)) {
			audioFault(outputs, outputChannels, frames);
			return;
		}
		if (captureEnabled) captureReady.notify_one();
		if (playbackEnabled) {
			playbackStarted = playbackStarted || output.availableFrames() >= playbackStartFrames;
			if (playbackStarted && output.pop(outputs, static_cast<uint32_t>(outputChannels), deviceFrames)) return;
			if (playbackStarted) failed.store(true, std::memory_order_release);
		}
		for (int channel = 0; channel < outputChannels; ++channel) {
			if (outputs[channel] != nullptr) std::fill_n(outputs[channel], frames, 0.0f);
		}
	}

	void audioDeviceAboutToStart(juce::AudioIODevice *) override { stopped.store(false, std::memory_order_release); }
	void audioDeviceStopped() override { stopped.store(true, std::memory_order_release); captureReady.notify_all(); }
	void audioDeviceError(const juce::String &) override { failed.store(true, std::memory_order_release); captureReady.notify_all(); }

	void start()
	{
		const std::lock_guard<std::mutex> lock(startMutex);
		if (started) return;
		started = true;
		device->start(this);
	}

	soundscaper_pro_status fail()
	{
		failed.store(true, std::memory_order_release);
		captureReady.notify_all();
		return SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
	}

	void audioFault(float *const *outputs, int outputChannels, int frames)
	{
		failed.store(true, std::memory_order_release);
		for (int channel = 0; channel < outputChannels; ++channel) {
			if (outputs[channel] != nullptr) std::fill(outputs[channel], outputs[channel] + std::max(0, frames), 0.0f);
		}
		captureReady.notify_all();
	}

	std::chrono::milliseconds timeout() const
	{
		if (sharedWasapi && !captureStarted) return std::chrono::milliseconds(500);
		const double milliseconds = (sharedWasapi ? 3000.0 : 2000.0)
			* static_cast<double>(std::max(frameCount, deviceFrames)) / sampleRate;
		return std::chrono::milliseconds(static_cast<int>(std::clamp(milliseconds, 10.0, 500.0)));
	}

	uint32_t queueFrames() const
	{
		// Leave room for one callback beyond the playback priming threshold.
		return std::max(16u * frameCount, playbackStartFrames + deviceFrames);
	}

	std::unique_ptr<juce::AudioIODevice> device;
	const uint32_t channelCount;
	const uint32_t frameCount;
	const uint32_t deviceFrames;
	const uint32_t sampleRate;
	const bool sharedWasapi;
	const uint32_t playbackStartFrames;
	const bool captureEnabled;
	const bool playbackEnabled;
	AudioFrameRing input;
	AudioFrameRing output;
	std::atomic<bool> failed{false};
	std::atomic<bool> stopped{false};
	std::mutex startMutex;
	std::mutex waitMutex;
	std::condition_variable captureReady;
	bool started = false;
	bool playbackStarted = false; // Audio callback thread only.
	bool captureStarted = false; // Helper consumer only.
};

/**
 * `AudioDeviceManager::createAudioDeviceTypes` is a protected virtual, so it was
 * never callable the way this host called it, and JUCE 9 made that a hard error
 * rather than a warning. Building the one requested type from the static factory
 * is also the narrower thing to do: enumerating a backend no longer constructs
 * every other backend's device type as a side effect, which on Linux meant an
 * ALSA query could not be answered without JACK being brought up first.
 */
std::unique_ptr<juce::AudioIODeviceType> selectedType(const std::string &backend, [[maybe_unused]] bool exclusive)
{
	std::unique_ptr<juce::AudioIODeviceType> candidate;
#if JUCE_MAC
	if (backend == "coreaudio") candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_CoreAudio());
#elif JUCE_WINDOWS
	if (backend == "wasapi") {
		candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_WASAPI(exclusive
			? juce::WASAPIDeviceMode::exclusive
			: juce::WASAPIDeviceMode::shared));
	}
 #if JUCE_ASIO
	if (backend == "asio") candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_ASIO());
 #endif
#elif JUCE_LINUX
	if (backend == "alsa") candidate.reset(juce::AudioIODeviceType::createAudioIODeviceType_ALSA());
#endif
	return candidate;
}

} // namespace

soundscaper_pro_status enumerateJuceAudio(const std::string &backend, std::string &json)
{
	if (backend == "jack" || backend == "pipewire") return SOUNDSCAPER_PRO_UNSUPPORTED;
	auto type = selectedType(backend, false);
	if (type == nullptr && backend == "wasapi") type = selectedType(backend, true);
	if (type == nullptr) return SOUNDSCAPER_PRO_BACKEND_ABSENT;
	type->scanForDevices();
	std::ostringstream output;
	output << "[";
	bool first = true;
	for (const bool input : { false, true }) {
		for (const auto &name : type->getDeviceNames(input)) {
			if (!first) output << ",";
			first = false;
			output << "{\"handle\":\"" << escaped(name.toStdString())
				<< "\",\"label\":\"" << escaped(name.toStdString())
				<< "\",\"direction\":\"" << (input ? "input" : "output") << "\"}";
		}
	}
	output << "]";
	json = output.str();
	return SOUNDSCAPER_PRO_OK;
}

soundscaper_pro_audio_result openJuceAudio(
	const soundscaper_pro_audio_request &request, std::unique_ptr<JuceAudioSession> &session)
{
	soundscaper_pro_audio_result result{};
	result.status = SOUNDSCAPER_PRO_BACKEND_ABSENT;
	const std::string backend = request.backend == nullptr ? "" : request.backend;
	text(result.backend, backend);
	if (backend == "jack" || backend == "pipewire") {
		result.status = SOUNDSCAPER_PRO_UNSUPPORTED;
		text(result.detail, "PipeWire is supplied by the system-ABI adapter; JACK is discovery-only.");
		return result;
	}
	auto type = selectedType(backend, request.exclusive != 0u);
	if (type == nullptr) {
		text(result.detail, "The requested JUCE audio backend is absent.");
		return result;
	}
	if (backend == "asio" && request.exclusive == 0u) {
		result.status = SOUNDSCAPER_PRO_MODE_REFUSED;
		text(result.detail, "ASIO is an exclusive backend.");
		return result;
	}
	type->scanForDevices();
	const juce::String handle(request.device_handle == nullptr ? "" : request.device_handle);
	const juce::String inputName = request.direction == 0u || request.direction == 2u ? handle : juce::String();
	const juce::String outputName = request.direction == 1u || request.direction == 2u ? handle : juce::String();
	// `createDevice` hands back an owning raw pointer, so it is adopted here
	// rather than at the `Session` that eventually takes it: every refusal below
	// this line returns early, and each one used to drop the device on the floor.
	std::unique_ptr<juce::AudioIODevice> device(type->createDevice(outputName, inputName));
	if (device == nullptr) {
		result.status = SOUNDSCAPER_PRO_DEVICE_UNAVAILABLE;
		text(result.detail, "The requested opaque device handle is unavailable.");
		return result;
	}
	juce::BigInteger inputs;
	juce::BigInteger outputs;
	if (request.direction == 0u || request.direction == 2u) inputs.setRange(0, static_cast<int>(request.channel_count), true);
	if (request.direction == 1u || request.direction == 2u) outputs.setRange(0, static_cast<int>(request.channel_count), true);
	const juce::String error = device->open(inputs, outputs, request.sample_rate, request.period_frames);
	if (error.isNotEmpty()) {
		result.status = SOUNDSCAPER_PRO_FORMAT_REFUSED;
		text(result.detail, error.toStdString());
		return result;
	}
	const auto callbackFrames = device->getCurrentBufferSizeSamples();
	// WASAPI shared mode uses the driver's period. Preserve the helper's exact
	// packet size by regrouping frames locally, with no change to the sample rate.
	const bool sharedWasapi = backend == "wasapi" && request.exclusive == 0u;
	if (device->getCurrentSampleRate() != request.sample_rate || callbackFrames < 1 || callbackFrames > 16384
		|| (!sharedWasapi && static_cast<uint32_t>(callbackFrames) != request.period_frames)) {
		device->close();
		result.status = SOUNDSCAPER_PRO_FORMAT_REFUSED;
		text(result.detail, "The device substituted a sample rate or period.");
		return result;
	}
	session = std::make_unique<Session>(
		std::move(device), request, static_cast<uint32_t>(callbackFrames), sharedWasapi);
	result.status = SOUNDSCAPER_PRO_OK;
	result.sample_rate = request.sample_rate;
	result.period_frames = request.period_frames;
	result.channel_count = request.channel_count;
	result.exclusive = request.exclusive;
	return result;
}

soundscaper_pro_status readJuceAudio(JuceAudioSession &session, float **planes, uint32_t channels, uint32_t frames)
{
	return session.read(planes, channels, frames);
}

soundscaper_pro_status writeJuceAudio(
	JuceAudioSession &session, const float *const *planes, uint32_t channels, uint32_t frames)
{
	return session.write(planes, channels, frames);
}

} // namespace soundscaper
