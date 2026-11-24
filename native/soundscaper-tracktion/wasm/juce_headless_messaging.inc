// SPDX-License-Identifier: AGPL-3.0-only

#include <deque>
#include <mutex>

namespace juce
{
namespace
{
std::mutex wasmMessagesMutex;
std::deque<MessageManager::MessageBase::Ptr> wasmMessages;
bool wasmMessagesOpen = false;
}

void MessageManager::doPlatformSpecificInitialisation()
{
    const std::scoped_lock lock(wasmMessagesMutex);
    wasmMessagesOpen = true;
}
void MessageManager::doPlatformSpecificShutdown()
{
    std::deque<MessageBase::Ptr> abandoned;
    const std::scoped_lock lock(wasmMessagesMutex);
    wasmMessagesOpen = false;
    abandoned.swap(wasmMessages);
}
bool MessageManager::postMessageToSystemQueue (MessageBase* message)
{
    const std::scoped_lock lock(wasmMessagesMutex);
    if (! wasmMessagesOpen) return false;
    wasmMessages.emplace_back(message);
    return true;
}
void MessageManager::broadcastMessage (const String&) {}

bool detail::dispatchNextMessageOnSystemQueue (bool)
{
    MessageManager::MessageBase::Ptr message;
    {
        const std::scoped_lock lock(wasmMessagesMutex);
        if (wasmMessages.empty()) return false;
        message = std::move(wasmMessages.front());
        wasmMessages.pop_front();
    }
    message->messageCallback();
    return true;
}
}
