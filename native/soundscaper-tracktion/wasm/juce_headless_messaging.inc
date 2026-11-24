// SPDX-License-Identifier: AGPL-3.0-only

#include <deque>
#include <condition_variable>
#include <mutex>

namespace juce
{
namespace
{
std::mutex wasmMessagesMutex;
std::condition_variable wasmMessageAvailable;
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
    wasmMessageAvailable.notify_all();
}
bool MessageManager::postMessageToSystemQueue (MessageBase* message)
{
    const std::scoped_lock lock(wasmMessagesMutex);
    if (! wasmMessagesOpen) return false;
    wasmMessages.emplace_back(message);
    wasmMessageAvailable.notify_one();
    return true;
}
void MessageManager::broadcastMessage (const String&) {}

bool detail::dispatchNextMessageOnSystemQueue (bool returnIfNoPendingMessages)
{
    MessageManager::MessageBase::Ptr message;
    {
        std::unique_lock lock(wasmMessagesMutex);
        if (! returnIfNoPendingMessages)
            wasmMessageAvailable.wait(lock, [] { return ! wasmMessagesOpen || ! wasmMessages.empty(); });
        if (wasmMessages.empty()) return false;
        message = std::move(wasmMessages.front());
        wasmMessages.pop_front();
    }
    message->messageCallback();
    return true;
}
}
