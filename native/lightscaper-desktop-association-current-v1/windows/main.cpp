/* SPDX-License-Identifier: AGPL-3.0-only */
#include "association.hpp"
#include <cstdio>
#include <new>

namespace lightscaper::association {
struct Receipt {
	Request input; Process primary, opened; Association selected;
	Registry userChoice, userClasses, userCommand;
	std::array<Association, 3> foreignBefore{}, foreignAfter{};
	std::vector<DWORD> jobBefore, jobAtDispatch, jobAfter;
	bool observedForeign = false, observedForeignAfter = false, foreignUnchanged = false, dispatched = false, processHandleReturned = false;
	bool sameCallingJob = false, returnedJoined = false, naturalExit = false, archiveStable = false, primaryStillLive = false;
	bool processHandleClosed = false, complete = false; DWORD exitCode = STILL_ACTIVE; uint64_t archiveBytes = 0u;
	Failure failure{"none", ERROR_SUCCESS};
};
void observeForeign(std::array<Association, 3> &result) {
	const std::array<const wchar_t *, 3> extensions{{L".sscape", L".fscape", L".scape"}};
	for (size_t i = 0u; i < extensions.size(); ++i) result[i] = association(extensions[i]);
}
void execute(Receipt &out, Cleanup &cleanup) {
	require(cleanup.okay, "request-handle-close");
	Handle expected(cleanup), archive(cleanup), primary(cleanup), opened(cleanup);
	openFile(expected, out.input.executable); openFile(archive, out.input.archive);
	require(out.input.archive.size() >= 8u && equal(out.input.archive.substr(out.input.archive.size() - 8u), L".liscape"), "archive-extension");
	const auto before = info(archive.get()); out.archiveBytes = size(before); require(out.archiveBytes > 0u && out.archiveBytes <= 268435456u, "archive-byte-limit");
	require(digest(archive.get(), cleanup) == out.input.digest, "archive-digest");
	primary.set(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, out.input.primary));
	require(primary.get() != nullptr, "open-primary"); out.primary = process(primary.get());
	require(equal(out.primary.executable, finalPath(expected.get())) && WaitForSingleObject(primary.get(), 0u) == WAIT_TIMEOUT, "primary-identity-or-liveness");
	out.jobBefore = jobProcesses(); require(out.jobBefore.size() == 1u, "calling-job-not-fresh");
	Com com; // Physical archive/primary and exact calling Job admission precede COM/default lookup.
	out.selected = association(L".liscape"); const auto resolved = required(out.selected.executable);
	require(equal(resolved, finalPath(expected.get())), "default-executable-mismatch"); const auto progId = required(out.selected.progId); safeProgId(progId);
	(void)required(out.selected.command);
	out.userChoice = registry(L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.liscape\\UserChoice", L"ProgId", cleanup);
	out.userClasses = registry(L"Software\\Classes\\.liscape", nullptr, cleanup);
	out.userCommand = registry(L"Software\\Classes\\" + progId + L"\\shell\\open\\command", nullptr, cleanup);
	require(equal(required(out.userClasses), progId) && required(out.userCommand) == required(out.selected.command), "per-user-default-command-mismatch");
	if (out.userChoice.code != ERROR_FILE_NOT_FOUND && out.userChoice.code != ERROR_PATH_NOT_FOUND) require(equal(required(out.userChoice), progId), "user-choice-mismatch");
	observeForeign(out.foreignBefore); out.observedForeign = true;
	SHELLEXECUTEINFOW launch{}; launch.cbSize = static_cast<DWORD>(sizeof(launch));
	launch.fMask = SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI;
	launch.lpVerb = L"open"; launch.lpFile = out.input.archive.c_str(); launch.nShow = SW_SHOWNORMAL;
	// The Shell resolves its real default. No lpClass, hkeyClass, lpParameters,
	// selected application, command rewrite, CreateProcess or smoke argv exists.
	FILETIME began{}; GetSystemTimeAsFileTime(&began); const uint64_t dispatchTime = (static_cast<uint64_t>(began.dwHighDateTime) << 32u) | began.dwLowDateTime;
	++operations.shell; const BOOL accepted = ShellExecuteExW(&launch); const DWORD shellError = accepted ? ERROR_SUCCESS : GetLastError();
	if (launch.hProcess != nullptr && launch.hProcess != INVALID_HANDLE_VALUE) { opened.set(launch.hProcess); out.processHandleReturned = true; }
	if (!accepted) throw Failure{"shell-execute-default", shellError}; out.dispatched = true;
	require(launch.hProcess != nullptr && launch.hProcess != INVALID_HANDLE_VALUE, "shell-returned-no-process-handle");
	out.opened = process(opened.get());
	require(out.opened.pid != out.primary.pid && out.opened.created >= dispatchTime && equal(out.opened.executable, resolved), "shell-process-identity-mismatch");
	BOOL inJob = FALSE; checked(IsProcessInJob(opened.get(), nullptr, &inJob), "returned-process-job-query");
	out.jobAtDispatch = jobProcesses(); out.sameCallingJob = inJob != FALSE && std::binary_search(out.jobAtDispatch.begin(), out.jobAtDispatch.end(), out.opened.pid);
	require(out.sameCallingJob, "returned-process-outside-calling-job");
	const DWORD wait = WaitForSingleObject(opened.get(), 30000u);
	if (wait != WAIT_OBJECT_0) throw Failure{"returned-process-unretired", wait == WAIT_FAILED ? GetLastError() : ERROR_TIMEOUT};
	out.returnedJoined = true; checked(GetExitCodeProcess(opened.get(), &out.exitCode), "returned-process-exit-code");
	out.naturalExit = out.exitCode == 0u; require(out.naturalExit, "returned-process-nonzero-exit");
	opened.close(); out.processHandleClosed = cleanup.okay; out.jobAfter = joinedChildren(5000u);
	observeForeign(out.foreignAfter); out.observedForeignAfter = true; out.foreignUnchanged = true;
	for (size_t i = 0u; i < out.foreignBefore.size(); ++i) out.foreignUnchanged = out.foreignUnchanged && same(out.foreignBefore[i], out.foreignAfter[i]);
	require(out.foreignUnchanged, "foreign-default-drift");
	out.archiveStable = same(before, info(archive.get())) && equal(finalPath(archive.get()), out.input.archive); require(out.archiveStable, "archive-changed");
	out.primaryStillLive = WaitForSingleObject(primary.get(), 0u) == WAIT_TIMEOUT && process(primary.get()).created == out.primary.created;
	require(out.primaryStillLive, "primary-ended-or-changed"); out.complete = true;
}
std::string foreignJson(const Receipt &out) {
	if (!out.observedForeign) return "null"; const std::array<const char *, 3> extensions{{".sscape", ".fscape", ".scape"}};
	std::string result = "[";
	for (size_t i = 0u; i < extensions.size(); ++i) { if (i) result += ',';
		result += "{\"extension\":" + quote(extensions[i]) + ",\"before\":" + associationJson(out.foreignBefore[i])
			+ ",\"after\":" + (out.observedForeignAfter ? associationJson(out.foreignAfter[i]) : "null") + '}'; }
	return result + ']';
}
std::string receipt(const Receipt &out, const Cleanup &cleanup) {
	const auto boolean = [](bool value) { return std::string(value ? "true" : "false"); };
	return "{\"schemaVersion\":1,\"kind\":\"lightscaper-windows-default-association-current-v1\",\"nonce\":" + quote(out.input.nonce)
		+ ",\"target\":" + quote(out.input.target) + ",\"sourceRevision\":" + quote(out.input.revision) + ",\"operation\":\"open\",\"status\":"
		+ quote(out.complete && cleanup.okay ? "passed" : "refused") + ",\"executablePath\":" + quote(utf8(out.input.executable))
		+ ",\"archivePath\":" + quote(utf8(out.input.archive)) + ",\"archiveSha256\":" + quote(out.input.digest)
		+ ",\"archiveByteLength\":" + std::to_string(out.archiveBytes) + ",\"archiveStable\":" + boolean(out.archiveStable)
		+ ",\"association\":" + associationJson(out.selected) + ",\"perUser\":{\"userChoiceProgId\":" + registryJson(out.userChoice)
		+ ",\"classesProgId\":" + registryJson(out.userClasses) + ",\"openCommand\":" + registryJson(out.userCommand) + ",\"mutated\":false},\"foreignDefaults\":" + foreignJson(out)
		+ ",\"foreignDefaultsUnchanged\":" + boolean(out.foreignUnchanged) + ",\"primary\":" + processJson(out.primary) + ",\"primaryStillLive\":" + boolean(out.primaryStillLive)
		+ ",\"dispatch\":{\"api\":\"ShellExecuteExW\",\"verb\":\"open\",\"file\":" + quote(utf8(out.input.archive))
		+ ",\"parameters\":null,\"classOverride\":false,\"noAsync\":true,\"noCloseProcess\":true,\"noUi\":true,\"accepted\":" + boolean(out.dispatched)
		+ ",\"processHandleReturned\":" + boolean(out.processHandleReturned) + "},\"returnedProcess\":" + processJson(out.opened)
		+ ",\"sameCallingJob\":" + boolean(out.sameCallingJob) + ",\"returnedProcessJoined\":" + boolean(out.returnedJoined)
		+ ",\"returnedProcessExitCode\":" + (out.returnedJoined ? std::to_string(out.exitCode) : "null") + ",\"returnedProcessNaturalExit\":" + boolean(out.naturalExit)
		+ ",\"returnedProcessHandleClosed\":" + boolean(out.processHandleClosed) + ",\"callingJob\":{\"helperPid\":" + std::to_string(GetCurrentProcessId())
		+ ",\"before\":" + pidsJson(out.jobBefore) + ",\"atDispatch\":" + pidsJson(out.jobAtDispatch) + ",\"after\":" + pidsJson(out.jobAfter)
		+ ",\"childrenRetired\":" + boolean(out.complete && out.jobAfter.size() == 1u) + "},\"nativeHandlesClosed\":" + boolean(cleanup.okay)
		+ ",\"operationCounts\":" + operationsJson()
		+ ",\"failure\":{\"stage\":" + quote(out.failure.stage) + ",\"win32\":" + std::to_string(out.failure.code) + "}}\n";
}
}
int wmain(int argc, wchar_t **argv) {
	using namespace lightscaper::association; Cleanup cleanup; Receipt out;
	try {
		require(argc == 5 && std::wstring(argv[1]) == L"--request" && std::wstring(argv[3]) == L"--result", "arguments");
		const std::wstring inputPath(argv[2]), outputPath(argv[4]);
		absolute(inputPath); absolute(outputPath);
		const auto parent = inputPath.substr(0u, inputPath.find_last_of(L'\\') + 1u);
		const auto name = inputPath.substr(parent.size());
		const std::wstring suffix = L".windows-association-request.json";
		require(name.size() == 32u + suffix.size() && name.substr(32u) == suffix, "request-file-name");
		const auto nonce = utf8(name.substr(0u, 32u)); require(hex(nonce, 32u), "request-file-nonce");
		require(outputPath == parent + wide(nonce) + L".windows-association-result.json", "private-request-result-paths");
		out.input.nonce = nonce; out.input.target = LIGHTSCAPER_ASSOCIATION_TARGET;
		Result output(outputPath, cleanup); // Reserve before any COM/default resolver/Shell operation.
		try {
			{ Handle input(cleanup); openFile(input, inputPath); out.input = request(readFile(input.get())); }
			require(out.input.nonce == nonce, "request-file-nonce-mismatch"); execute(out, cleanup);
		}
		catch (const Failure &failure) { out.failure = failure; }
		catch (const std::bad_alloc &) { out.failure = {"allocation", ERROR_NOT_ENOUGH_MEMORY}; }
		catch (...) { out.failure = {"unexpected", ERROR_GEN_FAILURE}; }
		out.processHandleClosed = out.processHandleReturned && cleanup.okay;
		output.publish(receipt(out, cleanup));
		return out.complete && cleanup.okay ? 0 : 1;
	} catch (...) {
		const std::string failure = "{\"kind\":\"lightscaper-windows-association-preflight-refusal-current-v1\",\"operationCounts\":" + operationsJson() + "}\n";
		std::fputs(failure.c_str(), stderr); return 2;
	}
}
