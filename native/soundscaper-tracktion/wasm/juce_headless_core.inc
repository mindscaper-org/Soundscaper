// SPDX-License-Identifier: AGPL-3.0-only

namespace juce
{
File File::getSpecialLocation (SpecialLocationType type)
{
    switch (type)
    {
        case tempDirectory: return File ("/tmp");
        case userHomeDirectory:
        case userApplicationDataDirectory: return File ("/home/web_user");
        case currentExecutableFile:
        case currentApplicationFile:
        case invokedExecutableFile: return File ("/soundscaper");
        default: return {};
    }
}
int64 File::getBytesFreeOnVolume() const
{
    struct statvfs info {};
    return statvfs (getFullPathName().toRawUTF8(), &info) == 0
        ? static_cast<int64> (info.f_bavail) * info.f_frsize : 0;
}
bool File::moveToTrash() const { return false; }
bool Thread::createNativeThread (Priority)
{
    PosixThreadAttribute attr { threadStackSize };
    threadId = threadHandle = makeThreadHandle (attr, this, [] (void* self) -> void*
    {
        juce_threadEntryPoint (static_cast<Thread*> (self));
        return nullptr;
    });
    return threadId != nullptr;
}
void Thread::killThread()
{
    if (threadHandle != nullptr)
        pthread_cancel ((pthread_t) threadHandle.load());
}
class ChildProcess::ActiveProcess {};
ChildProcess::ChildProcess() = default;
ChildProcess::~ChildProcess() = default;
bool ChildProcess::start (const StringArray&, int) { return false; }
bool ChildProcess::isRunning() const { return false; }
class NamedPipe::Pimpl {};
NamedPipe::NamedPipe() = default;
NamedPipe::~NamedPipe() = default;
void NamedPipe::close() { pimpl.reset(); }
bool NamedPipe::createNewPipe (const String&, bool) { return false; }
bool NamedPipe::isOpen() const { return false; }
int NamedPipe::read (void*, int, int) { return -1; }
int NamedPipe::write (const void*, int, int) { return -1; }
StreamingSocket::~StreamingSocket() = default;
void StreamingSocket::close() {}
int StreamingSocket::read (void*, int, bool) { return -1; }
int StreamingSocket::write (const void*, int) { return -1; }
int StreamingSocket::waitUntilReady (bool, int) { return -1; }
}
