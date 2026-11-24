// SPDX-License-Identifier: AGPL-3.0-only

#include "peer_commands.h"
#include "session.h"

#include <juce_events/juce_events.h>
#include <emscripten.h>

#include <cstdlib>
#include <iostream>
#include <stdexcept>

namespace
{
using namespace soundscaper::tracktion_backend;

constexpr int maximumCommandBytes = 64 * 1024;
std::unique_ptr<Session> session;

juce::var execute(const juce::var& request)
{
	const auto* object = request.getDynamicObject();
	if (!object || !object->getProperty("kind").isString())
		throw std::invalid_argument("The Tracktion command must have a kind");

	const auto kind = object->getProperty("kind").toString();
	if (kind == "create" || kind == "open")
	{
		const auto& project = object->getProperty("project");
		const auto handle = project.toString();
		const auto& rate = object->getProperty("sampleRate");
		const auto create = kind == "create";
		if (!project.isString() || handle.length() != 32 || !handle.containsOnly("0123456789abcdef")
		    || object->getProperties().size() != (create ? 3 : 2) || (create && !rate.isInt()))
			throw std::invalid_argument("The Tracktion project command is invalid");
		auto next = std::make_unique<Session>(juce::File("/projects").getChildFile(handle), juce::File("/runtime"),
		                                      create ? OpenMode::create : OpenMode::open, static_cast<int>(rate));
		if (create) next->save(next->revision());
		juce::DynamicObject::Ptr page = new juce::DynamicObject();
		page->setProperty("kind", "project");
		page->setProperty("offset", 0);
		auto result = dispatch(*next, juce::File("/exchange"), juce::var(page.get()));
		session = std::move(next);
		return result;
	}
	if (kind == "close")
	{
		if (object->getProperties().size() != 1)
			throw std::invalid_argument("The Tracktion close command is invalid");
		session.reset();
		return {};
	}
	if (!session) throw std::invalid_argument("There is no open Tracktion project");
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

int main()
{
	juce::ScopedJuceInitialiser_GUI juceLifetime;
	MAIN_THREAD_ASYNC_EM_ASM({ Module['tracktionReady'](); });
	juce::MessageManager::getInstance()->runDispatchLoop();
	return 0;
}
