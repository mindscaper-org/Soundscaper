/* SPDX-License-Identifier: AGPL-3.0-only */

// The host already pumps the macOS main queue. A separately loaded CLAP library
// owns its JUCE runtime, but must create and destroy Cocoa objects on that queue.
#include "juce_message_dispatcher.h"
#include <juce_gui_basics/juce_gui_basics.h>
#include <dispatch/dispatch.h>
#include <pthread.h>
#include <memory>

namespace soundscaper {
namespace {
std::unique_ptr<juce::ScopedJuceInitialiser_GUI> runtime;
void invoke(void *context) { (*static_cast<std::function<void()> *>(context))(); }
void onMain(std::function<void()> task)
{
	if (pthread_main_np()) task();
	else dispatch_sync_f(dispatch_get_main_queue(), &task, invoke);
}
}
soundscaper_pro_status dispatchJuceMessageTask(const std::function<soundscaper_pro_status()> &task)
{
	soundscaper_pro_status result = SOUNDSCAPER_PRO_UNSUPPORTED;
	onMain([&]() {
		try {
			if (!runtime) runtime = std::make_unique<juce::ScopedJuceInitialiser_GUI>();
			if (task) result = task();
		} catch (...) { result = SOUNDSCAPER_PRO_UNSUPPORTED; }
	});
	return result;
}
void shutdownJuceMessageDispatcher() { onMain([]() { runtime.reset(); }); }
}
