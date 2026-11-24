// SPDX-License-Identifier: AGPL-3.0-only

#include "peer_commands.h"
#include "peer_effects.h"
#include "session.h"

#include <juce_events/juce_events.h>

#include <array>
#include <charconv>
#include <cstdio>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <thread>

#if defined(_WIN32)
#include <fcntl.h>
#include <io.h>
#include <windows.h>
#else
#include <unistd.h>
#endif

namespace
{
using namespace soundscaper::tracktion_backend;

constexpr std::array<std::uint8_t, 4> magic{'S', 'C', 'T', '1'};
constexpr unsigned int maximumBytes = 64 * 1024;
using Header = std::array<std::uint8_t, 8>;

std::FILE* protectReplyStream()
{
	if (std::fflush(stdout) != 0)
		return nullptr;
#if defined(_WIN32)
	if (_setmode(_fileno(stdin), _O_BINARY) == -1 || _setmode(_fileno(stdout), _O_BINARY) == -1)
		return nullptr;
	const auto descriptor = _dup(_fileno(stdout));
	if (descriptor < 0)
		return nullptr;
	auto* result = _fdopen(descriptor, "wb");
	if (result == nullptr) { _close(descriptor); return nullptr; }
	if (_dup2(_fileno(stderr), _fileno(stdout)) != 0
	    || !SetStdHandle(STD_OUTPUT_HANDLE, GetStdHandle(STD_ERROR_HANDLE)))
#else
	const auto descriptor = dup(fileno(stdout));
	if (descriptor < 0)
		return nullptr;
	auto* result = fdopen(descriptor, "wb");
	if (result == nullptr) { close(descriptor); return nullptr; }
	if (dup2(fileno(stderr), fileno(stdout)) < 0)
#endif
	{
		std::fclose(result);
		return nullptr;
	}
	return result;
}

std::optional<std::string> readFrame()
{
	Header header{};
	const auto count = std::fread(header.data(), 1, header.size(), stdin);
	if (count == 0 && std::feof(stdin))
		return {};
	if (count != header.size() || !std::equal(magic.begin(), magic.end(), header.begin()))
		throw std::runtime_error("The Tracktion command frame header is invalid");
	unsigned int length = 0;
	for (unsigned int i = 0; i < 4; ++i)
		length |= static_cast<unsigned int>(header[4 + i]) << (8 * i);
	if (length == 0 || length > maximumBytes)
		throw std::runtime_error("The Tracktion command frame length is invalid");
	std::string body(length, '\0');
	if (std::fread(body.data(), 1, length, stdin) != length)
		throw std::runtime_error("The Tracktion command frame is incomplete");
	return body;
}

void writeFrame(std::FILE* output, const juce::String& body)
{
	const auto length = body.getNumBytesAsUTF8();
	if (length == 0 || length > maximumBytes)
		throw std::runtime_error("The Tracktion response is oversized");
	Header header{};
	std::copy(magic.begin(), magic.end(), header.begin());
	for (unsigned int i = 0; i < 4; ++i)
		header[4 + i] = static_cast<std::uint8_t>((length >> (8 * i)) & 255u);
	if (std::fwrite(header.data(), 1, header.size(), output) != header.size()
	    || std::fwrite(body.toRawUTF8(), 1, length, output) != length
	    || std::fflush(output) != 0)
		throw std::runtime_error("Cannot write the Tracktion response");
}

juce::String respond(Session& session, const juce::File& exchange, const juce::File& clipboard, const std::string& body, std::FILE* output)
{
	auto answer = std::make_unique<juce::DynamicObject>();
	try
	{
		juce::var request;
		if (!juce::JSON::parse(juce::String::fromUTF8(body.data(), static_cast<int>(body.size())), request).wasOk())
			throw std::invalid_argument("The Tracktion command is malformed");
		PeerEffectHost effects([output](const juce::var& event)
		{
			writeFrame(output, juce::JSON::toString(event, true));
			const auto reply = readFrame();
			juce::var decoded;
			if (!reply || !juce::JSON::parse(juce::String::fromUTF8(reply->data(), static_cast<int>(reply->size())), decoded).wasOk())
				throw std::runtime_error("The Tracktion effect response is unavailable");
			return decoded;
		});
		answer->setProperty("value", dispatch(session, exchange, clipboard, request, &effects));
		answer->setProperty("ok", true);
	}
	catch (const std::invalid_argument& error)
	{
		answer->setProperty("ok", false);
		answer->setProperty("error", "request");
		answer->setProperty("detail", error.what());
	}
	catch (const std::exception& error)
	{
		std::cerr << error.what() << '\n';
		answer->setProperty("ok", false);
		answer->setProperty("error", "session");
		answer->setProperty("detail", "The Tracktion session could not complete the operation");
	}
	return juce::JSON::toString(juce::var(answer.release()), true);
}

int runPeer(std::FILE* output, const juce::File& project, const juce::File& state, const juce::File& exchange,
            const juce::File& clipboard, OpenMode mode, int rate)
{
	juce::ScopedJuceInitialiser_GUI juceLifetime;
	Session session(project, state, mode, rate);
	auto& messages = *juce::MessageManager::getInstance();
	int status = 0;
	std::jthread io([&]
	{
		try
		{
			while (const auto body = readFrame())
			{
				const auto answer = juce::MessageManager::callSync([&] { return respond(session, exchange, clipboard, *body, output); });
				if (!answer)
					throw std::runtime_error("The Tracktion message thread stopped");
				writeFrame(output, *answer);
			}
		}
		catch (const std::exception& error)
		{
			std::cerr << error.what() << '\n';
			status = 1;
		}
		messages.stopDispatchLoop();
	});
	messages.runDispatchLoop();
	io.join();
	return status;
}

juce::File absolutePath(const char* value)
{
	const juce::String path = juce::String::fromUTF8(value);
	if (!juce::File::isAbsolutePath(path))
		throw std::invalid_argument("The Tracktion peer requires absolute launch directories");
	return juce::File(path);
}
}

int main(int argc, char** argv)
{
	if (argc != 6 && argc != 7)
		return 2;
	const std::string_view mode(argv[1]);
	if (mode != "create" && mode != "open")
		return 2;
	const std::string_view rateText(argv[5]);
	int rate = 0;
	const auto end = rateText.data() + rateText.size();
	const auto converted = std::from_chars(rateText.data(), end, rate);
	if (converted.ec != std::errc() || converted.ptr != end
	    || (mode == "open" && rate != 0) || (mode == "create" && (rate < 8000 || rate > 192000)))
		return 2;

	std::unique_ptr<std::FILE, int (*)(std::FILE*)> output(protectReplyStream(), std::fclose);
	if (!output)
		return 2;
	try
	{
		const auto exchange = absolutePath(argv[4]);
		const auto clipboard = argc == 7 ? absolutePath(argv[6]) : exchange.getChildFile("clipboard");
		return runPeer(output.get(), absolutePath(argv[2]), absolutePath(argv[3]), exchange, clipboard,
		               mode == "create" ? OpenMode::create : OpenMode::open, rate);
	}
	catch (const std::exception& error)
	{
		std::cerr << error.what() << '\n';
		return 1;
	}
}
