/* SPDX-License-Identifier: AGPL-3.0-only */
#include "canary-windows-support.hpp"
#include <sstream>

using namespace lightscaper::canary;
namespace {
struct Plan { std::wstring scenario, helper, fixture, root, nonce; };
struct Evidence {
	DWORD supervisorPid = 0u, rootPid = 0u, readerPid = 0u, supervisorExit = 0u, finalActive = 0u, total = 0u;
	bool supervisorEnded = false, finalKnown = false, outerEmpty = false, denied = false, deleteDenied = false;
	bool reopened = false, deleted = false, natural = false, first = false, nativeReceipt = false;
	bool supervisorKilled = false, cleanupForced = false;
	std::vector<Failure> failures, cleanupFailures;
};
std::string ascii(const std::wstring &value) {
	std::string result; for (wchar_t c : value) result += static_cast<char>(c); return result;
}
bool absoluteDrive(const std::wstring &value) {
	return value.size() > 3u && ((value[0] >= L'A' && value[0] <= L'Z') || (value[0] >= L'a' && value[0] <= L'z'))
		&& value[1] == L':' && value[2] == L'\\';
}
Plan readPlan(int argc, wchar_t **argv) {
	expect(argc == 11, "canary-arguments");
	expect(std::wstring(argv[1]) == L"--case" && std::wstring(argv[3]) == L"--helper"
		&& std::wstring(argv[5]) == L"--fixture" && std::wstring(argv[7]) == L"--root"
		&& std::wstring(argv[9]) == L"--nonce", "closed-canary-arguments");
	Plan plan{argv[2], argv[4], argv[6], argv[8], argv[10]};
	expect(plan.scenario == L"clean" || plan.scenario == L"nonzero" || plan.scenario == L"closed-stdio"
		|| plan.scenario == L"timeout" || plan.scenario == L"assignment-failure" || plan.scenario == L"supervisor-death", "known-canary-case");
	expect(plan.nonce.size() == 32u && std::all_of(plan.nonce.begin(), plan.nonce.end(), [](wchar_t c) {
		return (c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'); }), "canary-nonce");
	expect(absoluteDrive(plan.helper) && absoluteDrive(plan.fixture) && absoluteDrive(plan.root), "local-absolute-canary-paths");
	expect(exists(plan.helper) && exists(plan.fixture), "canary-binaries-exist"); return plan;
}
void validateEmptyRoot(const std::wstring &root) {
	const DWORD attributes = GetFileAttributesW(root.c_str());
	require(attributes != INVALID_FILE_ATTRIBUTES, "owned-root-attributes");
	expect((attributes & FILE_ATTRIBUTE_DIRECTORY) != 0u && (attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0u, "owned-root-directory");
	WIN32_FIND_DATAW entry{}; const HANDLE search = FindFirstFileW(path(root, L"*").c_str(), &entry);
	require(search != INVALID_HANDLE_VALUE, "enumerate-owned-root");
	bool empty = true; DWORD failure = ERROR_SUCCESS;
	do {
		const std::wstring name(entry.cFileName);
		if (name != L"." && name != L"..") empty = false;
	} while (FindNextFileW(search, &entry));
	if (GetLastError() != ERROR_NO_MORE_FILES) failure = GetLastError();
	require(FindClose(search) != FALSE, "close-owned-root-enumeration");
	if (failure != ERROR_SUCCESS) throw Failure{"enumerate-owned-root", failure};
	expect(empty, "owned-root-initially-empty");
}
void configureGuard(Handle &job, bool restricted) {
	job.set(CreateJobObjectW(nullptr, nullptr)); require(job.valid(), "create-outer-job");
	require(SetHandleInformation(job.get(), HANDLE_FLAG_INHERIT, 0u) != FALSE, "noninherited-outer-job");
	JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
	limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
	if (restricted) {
		// The supervisor occupies the only slot. Its atomic payload admission
		// must fail before the payload can execute its first instruction.
		limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
		limits.BasicLimitInformation.ActiveProcessLimit = 1u;
	}
	require(SetInformationJobObject(job.get(), JobObjectExtendedLimitInformation, &limits,
		static_cast<DWORD>(sizeof(limits))) != FALSE, "configure-outer-job");
}
class Attributes {
	bool initialized_ = false;
public:
	std::vector<unsigned char> bytes; PPROC_THREAD_ATTRIBUTE_LIST list = nullptr;
	~Attributes() { if (initialized_) DeleteProcThreadAttributeList(list); }
	void initialize() {
		SIZE_T size = 0u; SetLastError(ERROR_SUCCESS);
		const BOOL result = InitializeProcThreadAttributeList(nullptr, 2u, 0u, &size);
		expect(!result && GetLastError() == ERROR_INSUFFICIENT_BUFFER && size > 0u, "size-canary-attributes");
		bytes.resize(size); list = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(bytes.data());
		require(InitializeProcThreadAttributeList(list, 2u, 0u, &size) != FALSE, "initialize-canary-attributes"); initialized_ = true;
	}
};
void launch(const Plan &plan, HANDLE guard, Handle &process, Handle &thread, Evidence &evidence) {
	std::array<Handle, 3> streams{}; std::array<HANDLE, 3> inherited{};
	SECURITY_ATTRIBUTES security{static_cast<DWORD>(sizeof(security)), nullptr, TRUE};
	for (size_t index = 0u; index < streams.size(); ++index) {
		streams[index].set(CreateFileW(L"NUL", index == 0u ? GENERIC_READ : GENERIC_WRITE,
			FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
		require(streams[index].valid(), "create-canary-stdio"); inherited[index] = streams[index].get();
	}
	Attributes attributes; attributes.initialize();
	require(UpdateProcThreadAttribute(attributes.list, 0u, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
		inherited.data(), inherited.size() * sizeof(HANDLE), nullptr, nullptr) != FALSE, "canary-handle-list");
	require(UpdateProcThreadAttribute(attributes.list, 0u, PROC_THREAD_ATTRIBUTE_JOB_LIST,
		&guard, sizeof(guard), nullptr, nullptr) != FALSE, "canary-atomic-job-list");
	const DWORD deadline = plan.scenario == L"timeout" ? 3000u : plan.scenario == L"supervisor-death" ? 60000u : 15000u;
	const DWORD grace = plan.scenario == L"clean" || plan.scenario == L"nonzero" ? 5000u : 1500u;
	std::wstring line = command(plan.helper, {L"--receipt=" + path(plan.root, L"native-receipt.json"),
		L"--nonce=" + plan.nonce, L"--stage=1", L"--deadline-ms=" + std::to_wstring(deadline),
		L"--grace-ms=" + std::to_wstring(grace), L"--", plan.fixture, L"root", plan.root, plan.scenario});
	STARTUPINFOEXW startup{}; startup.StartupInfo.cb = static_cast<DWORD>(sizeof(startup));
	startup.lpAttributeList = attributes.list; startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
	startup.StartupInfo.hStdInput = inherited[0]; startup.StartupInfo.hStdOutput = inherited[1]; startup.StartupInfo.hStdError = inherited[2];
	PROCESS_INFORMATION created{};
	require(CreateProcessW(plan.helper.c_str(), line.data(), nullptr, nullptr, TRUE,
		CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
		nullptr, nullptr, &startup.StartupInfo, &created) != FALSE, "create-canary-supervisor");
	process.set(created.hProcess); thread.set(created.hThread); evidence.supervisorPid = created.dwProcessId;
	BOOL member = FALSE; require(IsProcessInJob(process.get(), guard, &member) != FALSE, "verify-outer-membership");
	expect(member != FALSE, "supervisor-owned-before-resume");
	require(ResumeThread(thread.get()) != static_cast<DWORD>(-1), "resume-canary-supervisor"); thread.close("close-supervisor-thread");
	for (auto &stream : streams) stream.close("close-canary-stdio");
}
DWORD markerPid(const std::wstring &name, bool ready) {
	std::string bytes;
	for (size_t attempt = 0u;; ++attempt) {
		try { bytes = readSmall(name); break; }
		catch (const Failure &error) {
			if (error.code != ERROR_SHARING_VIOLATION || attempt >= 100u) throw;
			Sleep(10u);
		}
	}
	std::istringstream input(bytes); unsigned long value = 0u; int closed = 0;
	expect(static_cast<bool>(input >> value), "marker-process-id");
	if (ready) expect(static_cast<bool>(input >> closed) && closed == 1, "reader-closed-stdio");
	input >> std::ws; expect(input.eof() && value > 0u, "closed-marker");
	return static_cast<DWORD>(value);
}
void proveLiveReader(const Plan &plan, HANDLE guard, HANDLE supervisor, Handle &reader, Evidence &evidence) {
	const ULONGLONG began = GetTickCount64();
	while (!exists(path(plan.root, L"reader-ready.txt"))) {
		expect(!ended(supervisor, 0u), "supervisor-alive-until-reader");
		if (GetTickCount64() - began >= 10000u) throw Failure{"canary-reader-ready", ERROR_TIMEOUT}; Sleep(10u);
	}
	evidence.readerPid = markerPid(path(plan.root, L"reader-ready.txt"), true);
	reader.set(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, evidence.readerPid));
	require(reader.valid(), "own-actual-reader-handle"); BOOL member = FALSE;
	require(IsProcessInJob(reader.get(), guard, &member) != FALSE, "query-reader-membership");
	expect(member != FALSE && !ended(reader.get(), 0u), "live-reader-in-owned-job");
	Handle exclusive(CreateFileW(path(plan.root, L"seed.bin").c_str(), GENERIC_READ | GENERIC_WRITE | DELETE,
		0u, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
	const DWORD openError = GetLastError();
	evidence.denied = !exclusive.valid() && openError == ERROR_SHARING_VIOLATION;
	exclusive.close("close-unexpected-live-open"); expect(evidence.denied, "live-reader-blocks-exclusive-open");
	const BOOL deleted = DeleteFileW(path(plan.root, L"seed.bin").c_str()); const DWORD deleteError = GetLastError();
	evidence.deleteDenied = !deleted && deleteError == ERROR_SHARING_VIOLATION;
	expect(evidence.deleteDenied, "no-delete-share-blocks-live-delete");
	expect(accounting(guard).TotalProcesses >= 4u, "real-root-child-grandchild-chain");
	if (plan.scenario == L"clean" || plan.scenario == L"nonzero") writeNew(path(plan.root, L"release-reader.txt"), "release");
}
void reopenAndDelete(const Plan &plan, Evidence &evidence) {
	Handle file(CreateFileW(path(plan.root, L"seed.bin").c_str(), GENERIC_READ | GENERIC_WRITE | DELETE,
		0u, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr));
	require(file.valid(), "exclusive-reopen-after-empty"); evidence.reopened = true;
	file.close("close-exclusive-after-empty");
	require(DeleteFileW(path(plan.root, L"seed.bin").c_str()) != FALSE, "delete-after-empty"); evidence.deleted = true;
}
void observe(const Plan &plan, HANDLE job, HANDLE supervisor, Handle &reader, Evidence &evidence) {
	const bool assignment = plan.scenario == L"assignment-failure";
	if (!assignment) proveLiveReader(plan, job, supervisor, reader, evidence);
	if (plan.scenario == L"supervisor-death") {
		require(TerminateProcess(supervisor, 137u) != FALSE, "kill-owned-supervisor"); evidence.supervisorKilled = true;
	}
	expect(ended(supervisor, 25000u), "join-actual-supervisor"); evidence.supervisorEnded = true;
	evidence.supervisorExit = exitCode(supervisor);
	expect(waitEmpty(job, 5000u), "outer-job-empty-before-test-cleanup"); evidence.outerEmpty = true;
	const auto counts = accounting(job); evidence.finalActive = counts.ActiveProcesses; evidence.finalKnown = true; evidence.total = counts.TotalProcesses;
	if (reader.valid()) expect(ended(reader.get(), 0u), "join-known-reader-after-empty");
	evidence.first = exists(path(plan.root, L"root-first.txt"));
	if (evidence.first) evidence.rootPid = markerPid(path(plan.root, L"root-first.txt"), false);
	evidence.natural = exists(path(plan.root, L"reader-natural.txt")); evidence.nativeReceipt = exists(path(plan.root, L"native-receipt.json"));
	if (assignment) expect(!evidence.first && !exists(path(plan.root, L"reader-ready.txt")), "assignment-refused-before-first-instruction");
	else expect(evidence.first && evidence.rootPid != evidence.readerPid, "actual-distinct-root-and-reader");
	expect(evidence.natural == (plan.scenario == L"clean" || plan.scenario == L"nonzero"), "natural-versus-forced-retirement");
	// The helper reserves its CREATE_NEW receipt before launching. Killing it
	// may leave an empty/truncated file; only the strict validator can admit
	// completed terminal evidence, never this file-existence flag.
	if (plan.scenario != L"supervisor-death") expect(evidence.nativeReceipt, "surviving-helper-receipt-file");
	expect(evidence.supervisorExit == (plan.scenario == L"supervisor-death" ? 137u : 0u), "supervisor-publication-exit");
	reopenAndDelete(plan, evidence);
}
void cleanup(const Plan &plan, HANDLE job, Handle &process, Handle &thread, Handle &reader, Evidence &evidence) {
	const auto checked = [&](auto operation) {
		try { operation(); } catch (const Failure &failure) { evidence.cleanupFailures.push_back(failure); }
		catch (...) { evidence.cleanupFailures.push_back({"unexpected-canary-cleanup", ERROR_GEN_FAILURE}); }
	};
	if (job != nullptr) checked([&] {
		if (accounting(job).ActiveProcesses != 0u) {
			evidence.cleanupForced = true; require(TerminateJobObject(job, 126u) != FALSE, "terminate-owned-outer-job");
		}
		expect(waitEmpty(job, 5000u), "join-owned-outer-job-cleanup");
		const auto counts = accounting(job); evidence.finalActive = counts.ActiveProcesses; evidence.finalKnown = true; evidence.total = counts.TotalProcesses;
	});
	// An anomalous atomic-create/membership failure must also join the exact
	// process handle; neither PID enumeration nor taskkill is cleanup evidence.
	if (process.valid()) checked([&] {
		if (!ended(process.get(), 0u)) {
			evidence.cleanupForced = true; require(TerminateProcess(process.get(), 126u) != FALSE, "terminate-unjoined-supervisor");
		}
		expect(ended(process.get(), 5000u), "join-supervisor-cleanup");
		evidence.supervisorEnded = true; evidence.supervisorExit = exitCode(process.get());
	});
	if (reader.valid()) checked([&] { expect(ended(reader.get(), 5000u), "join-reader-cleanup"); });
	checked([&] { reader.close("close-reader-process"); }); checked([&] { thread.close("close-supervisor-thread-cleanup"); });
	checked([&] { process.close("close-supervisor-process"); });
	if (evidence.finalKnown && evidence.finalActive == 0u && !evidence.deleted) checked([&] {
		if (exists(path(plan.root, L"seed.bin"))) reopenAndDelete(plan, evidence);
	});
}
std::string failures(const std::vector<Failure> &values) {
	std::string result = "[";
	for (size_t index = 0u; index < values.size(); ++index) {
		if (index != 0u) result += ',';
		result += "{\"stage\":\"" + values[index].stage + "\",\"code\":" + std::to_string(values[index].code) + "}";
	}
	return result + ']';
}
std::string boolean(bool value) { return value ? "true" : "false"; }
std::string json(const Plan &plan, const Evidence &evidence, bool passed) {
	return "{\"schemaVersion\":1,\"caseName\":\"" + ascii(plan.scenario) + "\",\"nonce\":\"" + ascii(plan.nonce)
		+ "\",\"supervisorProcessId\":" + std::to_string(evidence.supervisorPid) + ",\"rootProcessId\":" + std::to_string(evidence.rootPid)
		+ ",\"readerProcessId\":" + std::to_string(evidence.readerPid) + ",\"supervisorExitCode\":" + (evidence.supervisorEnded ? std::to_string(evidence.supervisorExit) : "null")
		+ ",\"observedOuterEmptyBeforeCleanup\":" + boolean(evidence.outerEmpty)
		+ ",\"finalOuterActiveProcesses\":" + (evidence.finalKnown ? std::to_string(evidence.finalActive) : "null")
		+ ",\"totalProcesses\":" + std::to_string(evidence.total) + ",\"exclusiveDeniedWhileReaderLive\":" + boolean(evidence.denied)
		+ ",\"deleteDeniedWhileReaderLive\":" + boolean(evidence.deleteDenied) + ",\"exclusiveReopenAfterEmpty\":" + boolean(evidence.reopened)
		+ ",\"deletedAfterEmpty\":" + boolean(evidence.deleted) + ",\"naturalExitMarker\":" + boolean(evidence.natural)
		+ ",\"firstInstructionMarker\":" + boolean(evidence.first) + ",\"nativeReceiptPresent\":" + boolean(evidence.nativeReceipt)
		+ ",\"supervisorKilled\":" + boolean(evidence.supervisorKilled) + ",\"cleanupForced\":" + boolean(evidence.cleanupForced)
		+ ",\"casePassed\":" + boolean(passed) + ",\"failures\":" + failures(evidence.failures)
		+ ",\"cleanupFailures\":" + failures(evidence.cleanupFailures) + "}\n";
}
}
int wmain(int argc, wchar_t **argv) {
	try {
		const Plan plan = readPlan(argc, argv); validateEmptyRoot(plan.root);
		Evidence evidence; Handle job, process, thread, reader;
		try {
			writeNew(path(plan.root, L"seed.bin"), "Lightscaper real native reader canary\n");
			configureGuard(job, plan.scenario == L"assignment-failure"); launch(plan, job.get(), process, thread, evidence);
			observe(plan, job.get(), process.get(), reader, evidence);
		} catch (const Failure &failure) { evidence.failures.push_back(failure); }
		catch (...) { evidence.failures.push_back({"unexpected-canary", ERROR_GEN_FAILURE}); }
		cleanup(plan, job.valid() ? job.get() : nullptr, process, thread, reader, evidence);
		try { job.close("close-outer-job"); } catch (const Failure &failure) { evidence.cleanupFailures.push_back(failure); }
		const bool passed = evidence.failures.empty() && evidence.cleanupFailures.empty() && evidence.outerEmpty
			&& evidence.finalKnown && evidence.finalActive == 0u && !evidence.cleanupForced && evidence.reopened && evidence.deleted;
		writeNew(path(plan.root, L"canary.json"), json(plan, evidence, passed)); return passed ? 0 : 1;
	} catch (...) { return 92; }
}
