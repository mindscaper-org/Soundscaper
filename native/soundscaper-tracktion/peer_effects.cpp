// SPDX-License-Identifier: AGPL-3.0-only

#include "peer_effects.h"

#include <array>
#include <bit>
#include <cstring>
#include <limits>
#include <stdexcept>

namespace soundscaper::tracktion_backend
{
namespace
{
static_assert(std::endian::native == std::endian::little);
static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
constexpr int maximumFrames = 128;

juce::DynamicObject::Ptr message(const char* operation, int instance)
{
	const juce::DynamicObject::Ptr result(new juce::DynamicObject());
	result->setProperty("kind", "offlineEffect");
	result->setProperty("operation", operation);
	result->setProperty("instance", instance);
	return result;
}
}

class PeerEffectHost::Instance final : public OfflineEffectInstance
{
public:
	Instance(PeerEffectHost& host, int id, int latency) : owner(host), instance(id), delay(latency) {}
	~Instance() override
	{
		try { owner.exchange(message("close", instance)); }
		catch (...) { /* The trusted broker also releases leases at the end of the render. */ }
	}
	int latencyFrames() const override { return delay; }

	bool process(std::span<float> left, std::span<float> right) override
	{
		if (left.empty() || left.size() > maximumFrames || left.size() != right.size()) return false;
		std::array<float, 2 * maximumFrames> planes;
		const auto planeBytes = left.size_bytes();
		std::memcpy(planes.data(), left.data(), planeBytes);
		std::memcpy(planes.data() + left.size(), right.data(), planeBytes);
		const auto request = message("process", instance);
		request->setProperty("frames", static_cast<int>(left.size()));
		request->setProperty("pcm", juce::Base64::toBase64(planes.data(), 2 * planeBytes));
		const auto answer = owner.exchange(request);
		if (!answer.isString()) return false;
		juce::MemoryOutputStream decoded;
		if (!juce::Base64::convertFromBase64(decoded, answer.toString()) || decoded.getDataSize() != 2 * planeBytes)
			return false;
		const auto* samples = static_cast<const std::byte*>(decoded.getData());
		std::memcpy(left.data(), samples, planeBytes);
		std::memcpy(right.data(), samples + planeBytes, planeBytes);
		return true;
	}

private:
	PeerEffectHost& owner;
	int instance;
	int delay;
};

PeerEffectHost::PeerEffectHost(std::function<juce::var(const juce::var&)> request) : transact(std::move(request)) {}

std::unique_ptr<OfflineEffectInstance> PeerEffectHost::openStereo(const OfflineEffectIdentity& key, int rate, int frames)
{
	if (frames != maximumFrames || instances == std::numeric_limits<int>::max()) return {};
	const auto id = ++instances;
	const auto request = message("open", id);
	request->setProperty("format", juce::String(key.format));
	request->setProperty("stableId", juce::String(key.stableId));
	request->setProperty("sha256", juce::String(key.sha256));
	request->setProperty("sampleRate", rate);
	request->setProperty("maximumFrames", frames);
	const auto latency = exchange(request);
	if (!latency.isInt()) return {};
	return std::make_unique<Instance>(*this, id, static_cast<int>(latency));
}

juce::var PeerEffectHost::exchange(juce::DynamicObject::Ptr request)
{
	// Only detached render jobs call the broker. The ordinary I/O thread is
	// waiting for the message-thread command to finish while this exchange runs.
	std::lock_guard lock(stream);
	if (sequence == std::numeric_limits<int>::max()) throw std::runtime_error("Too many Tracktion effect requests");
	request->setProperty("sequence", ++sequence);
	const auto reply = transact(juce::var(request.get()));
	const auto* object = reply.getDynamicObject();
	if (!object || object->getProperties().size() != 4 || object->getProperty("kind") != "offlineEffectReply"
	    || !object->getProperty("sequence").isInt() || static_cast<int>(object->getProperty("sequence")) != sequence
	    || !object->getProperty("ok").isBool() || !object->hasProperty("value"))
		throw std::runtime_error("Invalid Tracktion effect response");
	if (static_cast<bool>(object->getProperty("ok"))) return object->getProperty("value");
	return {};
}
}
