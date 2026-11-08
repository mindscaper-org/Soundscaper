/* SPDX-License-Identifier: AGPL-3.0-only */
#include "canary-windows-support.hpp"

using namespace lightscaper::canary;
namespace {
int run(const std::wstring &mode, const std::wstring &root, const std::wstring &scenario) {
	const bool natural = scenario == L"clean" || scenario == L"nonzero";
	if (mode == L"root") {
		// This is the payload's first external side effect. Suspended admission
		// failure must leave this absent, even if a process object was created.
		writeNew(path(root, L"root-first.txt"), std::to_string(GetCurrentProcessId()));
	}
	closeStandardStreams();
	if (mode == L"reader") {
		Handle reader(CreateFileW(path(root, L"seed.bin").c_str(), GENERIC_READ,
			FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
		require(reader.valid(), "open-no-delete-share-reader");
		writeNew(path(root, L"reader-ready.txt"), std::to_string(GetCurrentProcessId()) + " 1");
		if (natural) waitReady(path(root, L"release-reader.txt"), 10000u);
		else Sleep(60000u);
		writeNew(path(root, L"reader-natural.txt"), std::to_string(GetCurrentProcessId()));
		reader.close("close-reader"); return 0;
	}
	expect(mode == L"root" || mode == L"child", "known-fixture-role");
	const auto process = spawnDescendant(self(), {mode == L"root" ? L"child" : L"reader", root, scenario});
	Handle child(process.hProcess), thread(process.hThread); thread.close("close-child-thread");
	if (scenario == L"nonzero" || scenario == L"closed-stdio") {
		waitReady(path(root, L"reader-ready.txt"), 10000u);
		child.close("close-live-child-handle");
		return mode == L"root" && scenario == L"nonzero" ? 7 : 0;
	}
	expect(ended(child.get(), natural ? 10000u : 65000u), "join-fixture-descendant");
	const DWORD code = exitCode(child.get()); child.close("close-joined-child");
	return static_cast<int>(code);
}
}
int wmain(int argc, wchar_t **argv) {
	try {
		expect(argc == 4, "fixture-arguments");
		const std::wstring scenario = argv[3];
		expect(scenario == L"clean" || scenario == L"nonzero" || scenario == L"closed-stdio"
			|| scenario == L"timeout" || scenario == L"supervisor-death" || scenario == L"assignment-failure", "known-fixture-case");
		return run(argv[1], argv[2], scenario);
	} catch (...) { return 91; }
}
