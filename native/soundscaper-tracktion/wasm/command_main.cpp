// SPDX-License-Identifier: AGPL-3.0-only

#include "peer_commands.h"
#include "project_archive.h"
#include "session.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_events/juce_events.h>
#include <emscripten.h>

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <mutex>
#include <stdexcept>

namespace
{
using namespace soundscaper::tracktion_backend;

constexpr int maximumCommandBytes = 64 * 1024;
constexpr std::int64_t maximumExpandedArchiveBytes = 64 * 1024 * 1024;
constexpr auto blockFrames = 128;
std::mutex playbackMutex;
bool playbackPrepared = false;
std::unique_ptr<Session> session;

juce::var execute(const juce::var& request)
{
	const auto* object = request.getDynamicObject();
	if (!object || !object->getProperty("kind").isString())
		throw std::invalid_argument("The Tracktion command must have a kind");

	const auto kind = object->getProperty("kind").toString();
	if (kind == "create" || kind == "open" || kind == "openArchive")
	{
		const auto& project = object->getProperty("project");
		const auto handle = project.toString();
		const auto& rate = object->getProperty("sampleRate");
		const auto create = kind == "create";
		const auto archives = kind == "openArchive";
		if (!project.isString() || handle.length() != 32 || !handle.containsOnly("0123456789abcdef")
		    || object->getProperties().size() != (create || archives ? 3 : 2) || (create && !rate.isInt()))
			throw std::invalid_argument("The Tracktion project command is invalid");
		const auto directory = juce::File("/projects").getChildFile(handle);
		if (archives)
		{
			const auto& value = object->getProperty("asset");
			const auto asset = value.toString();
			if (!value.isString() || asset.length() != 32 || !asset.containsOnly("0123456789abcdef"))
				throw std::invalid_argument("The Tracktion archive handle is invalid");
			const auto archive = juce::File("/exchange/input").getChildFile(asset + ".zip");
			extractProjectArchive(archive, directory, maximumExpandedArchiveBytes);
		}
		auto next = std::make_unique<Session>(directory, juce::File("/runtime"),
		                                      create ? OpenMode::create : OpenMode::open, static_cast<int>(rate));
		if (create) next->save(next->revision());
		juce::DynamicObject::Ptr page = new juce::DynamicObject();
		page->setProperty("kind", "project");
		page->setProperty("offset", 0);
		auto result = dispatch(*next, juce::File("/exchange"), juce::var(page.get()));
		const std::scoped_lock lock(playbackMutex);
		playbackPrepared = false;
		session = std::move(next);
		return result;
	}
	if (kind == "close")
	{
		if (object->getProperties().size() != 1)
			throw std::invalid_argument("The Tracktion close command is invalid");
		const std::scoped_lock lock(playbackMutex);
		playbackPrepared = false;
		session.reset();
		return {};
	}
	if (!session) throw std::invalid_argument("There is no open Tracktion project");
	if (kind == "prepareOutput")
	{
		if (object->getProperties().size() != 1)
			throw std::invalid_argument("The Tracktion playback command is invalid");
		{
			const std::scoped_lock lock(playbackMutex);
			if (!playbackPrepared) session->preparePlayback(blockFrames);
			playbackPrepared = true;
		}
		juce::DynamicObject::Ptr status = new juce::DynamicObject();
		status->setProperty("kind", "transportStatus");
		return dispatch(*session, juce::File("/exchange"), juce::var(status.get()));
	}
	return dispatch(*session, juce::File("/exchange"), request);
}

void respond(int id, const juce::String& body)
{
	juce::DynamicObject::Ptr reply = new juce::DynamicObject();
	try
	{
		juce::var request;
		if (!juce::JSON::parse(body, request).wasOk())
			throw std::invalid_argument("The Tracktion command is malformed");
		reply->setProperty("value", execute(request));
	}
	catch (const std::invalid_argument& error)
	{
		reply->setProperty("error", "request");
		reply->setProperty("detail", error.what());
	}
	catch (const std::exception& error)
	{
		std::cerr << error.what() << '\n';
		reply->setProperty("error", "session");
		reply->setProperty("detail", "The Tracktion session could not complete the operation");
	}
	const auto result = juce::JSON::toString(juce::var(reply.get()), true);
	const auto size = result.getNumBytesAsUTF8() + 1;
	auto* bytes = static_cast<char*>(std::malloc(size));
	if (bytes != nullptr) result.copyToUTF8(bytes, size);
	// The runtime thread owns the JavaScript worker and frees this copy.
	MAIN_THREAD_ASYNC_EM_ASM({ Module['tracktionCompleted']($0, $1); }, id, bytes);
}
}

extern "C" EMSCRIPTEN_KEEPALIVE int soundscaper_submit(int id, const char* bytes, int size)
{
	if (id <= 0 || !bytes || size <= 0 || size > maximumCommandBytes) return 0;
	const auto body = juce::String::fromUTF8(bytes, size);
	return juce::MessageManager::callAsync([id, body] { respond(id, body); });
}

extern "C" EMSCRIPTEN_KEEPALIVE int soundscaper_read_playback(float* output)
{
	const std::unique_lock lock(playbackMutex, std::try_to_lock);
	if (!output || !lock.owns_lock() || !session || !playbackPrepared) return 0;
	static juce::AudioBuffer<float> audio(2, blockFrames);
	static juce::MidiBuffer midi;
	midi.clear();
	if (!session->processPlaybackBlock(audio, midi)) return 0;
	for (int channel = 0; channel < 2; ++channel)
		std::copy_n(audio.getReadPointer(channel), blockFrames, output + channel * blockFrames);
	return 1;
}

int main()
{
	juce::ScopedJuceInitialiser_GUI juceLifetime;
	MAIN_THREAD_ASYNC_EM_ASM({ Module['tracktionReady'](); });
	juce::MessageManager::getInstance()->runDispatchLoop();
	return 0;
}
