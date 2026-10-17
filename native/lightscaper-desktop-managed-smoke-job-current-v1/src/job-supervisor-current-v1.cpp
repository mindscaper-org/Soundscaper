/* SPDX-License-Identifier: AGPL-3.0-only */
#include "job-current-v1.hpp"
#include <algorithm>
#include <new>

namespace lightscaper::managed_smoke {
void Receipt::cleanup(Failure value) noexcept
{
	// One run performs at most twelve checked cleanup calls. Retain a fence
	// rather than claim success if a future extension exceeds this bound.
	if (cleanupCount < cleanupFailures.size()) cleanupFailures[cleanupCount++] = value;
	else { readersRetired = false; cleanupFailures.back() = {Stage::supervisor, ERROR_BUFFER_OVERFLOW}; }
}
namespace {
[[noreturn]] void fail(Stage stage) { throw Failure{stage, GetLastError()}; }
void require(bool okay, Stage stage) { if (!okay) fail(stage); }
class Context {
public:
	HANDLE job = nullptr;
	PROCESS_INFORMATION process{};
	std::array<HANDLE, 3> streams{};
	std::vector<unsigned char> attributeBytes;
	PPROC_THREAD_ATTRIBUTE_LIST attributes = nullptr;
	bool initialized = false, created = false, assigned = false, mainEnded = false;
	~Context() {
		// Exception-only containment never substitutes for terminal evidence.
		if (initialized) DeleteProcThreadAttributeList(attributes);
		for (const HANDLE handle : streams) if (handle != nullptr) (void)CloseHandle(handle);
		if (process.hThread != nullptr) (void)CloseHandle(process.hThread);
		if (process.hProcess != nullptr) (void)CloseHandle(process.hProcess);
		if (job != nullptr) (void)CloseHandle(job);
	}
	void duplicate(size_t index, DWORD selector, Stage stage) {
		const HANDLE input = GetStdHandle(selector);
		if (input == nullptr || input == INVALID_HANDLE_VALUE) throw Failure{stage, ERROR_INVALID_HANDLE};
		require(DuplicateHandle(GetCurrentProcess(), input, GetCurrentProcess(), &streams[index],
			0u, TRUE, DUPLICATE_SAME_ACCESS) != FALSE, stage);
	}
	DWORD active(Receipt &receipt) {
		JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting{};
		DWORD returned = 0u;
		require(QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &accounting,
			static_cast<DWORD>(sizeof(accounting)), &returned) != FALSE, Stage::queryJob);
		if (returned != sizeof(accounting)) throw Failure{Stage::queryJob, ERROR_INVALID_DATA};
		receipt.activeProcesses = accounting.ActiveProcesses;
		return accounting.ActiveProcesses;
	}
	bool empty(Receipt &receipt, DWORD milliseconds) {
		const ULONGLONG began = GetTickCount64();
		for (;;) {
			if (active(receipt) == 0u) return true;
			const ULONGLONG elapsed = GetTickCount64() - began;
			if (elapsed >= milliseconds) return false;
			Sleep(static_cast<DWORD>(std::min<ULONGLONG>(25u, milliseconds - elapsed)));
		}
	}
	bool waitMain(DWORD milliseconds, Stage stage) {
		if (mainEnded) return true;
		const DWORD result = WaitForSingleObject(process.hProcess, milliseconds);
		if (result == WAIT_OBJECT_0) { mainEnded = true; return true; }
		if (result == WAIT_TIMEOUT) return false;
		if (result == WAIT_FAILED) fail(stage);
		throw Failure{stage, ERROR_INVALID_DATA};
	}
	void exitCode(Receipt &receipt) {
		if (!mainEnded || receipt.exitCode) return;
		DWORD code = 0u;
		require(GetExitCodeProcess(process.hProcess, &code) != FALSE, Stage::getExitCode);
		receipt.exitCode = code;
	}
	void closeEndedMain() {
		if (!mainEnded) throw Failure{Stage::closeProcess, ERROR_INVALID_STATE};
		if (process.hThread != nullptr) {
			require(CloseHandle(process.hThread) != FALSE, Stage::closeThread); process.hThread = nullptr;
		}
		if (process.hProcess != nullptr) {
			require(CloseHandle(process.hProcess) != FALSE, Stage::closeProcess); process.hProcess = nullptr;
		}
	}
	void terminate(Receipt &receipt) {
		receipt.forcedTermination = true;
		require(TerminateJobObject(job, 125u) != FALSE, Stage::terminateJob);
	}
	void closeHandles(Receipt &receipt) noexcept {
		if (initialized) { DeleteProcThreadAttributeList(attributes); initialized = false; }
		const auto close = [&](HANDLE &handle, Stage stage) {
			if (handle == nullptr) return;
			if (CloseHandle(handle)) handle = nullptr;
			else receipt.cleanup({stage, GetLastError()});
		};
		close(process.hThread, Stage::closeThread); close(process.hProcess, Stage::closeProcess);
		close(streams[0], Stage::closeStdin); close(streams[1], Stage::closeStdout); close(streams[2], Stage::closeStderr);
		close(job, Stage::closeJob);
	}
};
void setup(Context &context)
{
	context.job = CreateJobObjectW(nullptr, nullptr);
	require(context.job != nullptr, Stage::createJob);
	require(SetHandleInformation(context.job, HANDLE_FLAG_INHERIT, 0u) != FALSE, Stage::configureJob);
	JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
	limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
	require(SetInformationJobObject(context.job, JobObjectExtendedLimitInformation, &limits,
		static_cast<DWORD>(sizeof(limits))) != FALSE, Stage::configureJob);
	context.duplicate(0u, STD_INPUT_HANDLE, Stage::duplicateStdin);
	context.duplicate(1u, STD_OUTPUT_HANDLE, Stage::duplicateStdout);
	context.duplicate(2u, STD_ERROR_HANDLE, Stage::duplicateStderr);
	SIZE_T size = 0u;
	SetLastError(ERROR_SUCCESS);
	const BOOL initial = InitializeProcThreadAttributeList(nullptr, 2u, 0u, &size);
	if (initial || GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0u) throw Failure{Stage::initializeAttributes, ERROR_INVALID_DATA};
	context.attributeBytes.resize(size);
	context.attributes = reinterpret_cast<PPROC_THREAD_ATTRIBUTE_LIST>(context.attributeBytes.data());
	require(InitializeProcThreadAttributeList(context.attributes, 2u, 0u, &size) != FALSE, Stage::initializeAttributes);
	context.initialized = true;
	require(UpdateProcThreadAttribute(context.attributes, 0u, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
		context.streams.data(), context.streams.size() * sizeof(HANDLE), nullptr, nullptr) != FALSE, Stage::inheritHandles);
	// Windows 10+ assigns this private job atomically with process creation.
	// A launcher death cannot strand an unassigned suspended app in between
	// CreateProcessW and a later AssignProcessToJobObject call. No fallback.
	require(UpdateProcThreadAttribute(context.attributes, 0u, PROC_THREAD_ATTRIBUTE_JOB_LIST,
		&context.job, sizeof(context.job), nullptr, nullptr) != FALSE, Stage::jobList);
}
void cleanupProcesses(Context &context, const Plan &plan, Receipt &receipt) noexcept
{
	if (!context.created) return; // No application process ever existed.
	const auto checked = [&](auto operation) {
		try { operation(); }
		catch (const Failure &error) { receipt.cleanup(error); }
		catch (...) { receipt.cleanup({Stage::supervisor, ERROR_GEN_FAILURE}); }
	};
	if (context.assigned) {
		// A prior query/wait failure may have hidden an already empty job. Try
		// again before forcing; every failure stays in the terminal receipt.
		bool empty = false;
		checked([&] { empty = context.empty(receipt, 1u); });
		if (!empty) checked([&] { context.terminate(receipt); });
	} else {
		bool ended = false;
		checked([&] { ended = context.waitMain(0u, Stage::waitTerminatedMain); });
		if (!ended) {
			receipt.forcedTermination = true;
			checked([&] { require(TerminateProcess(context.process.hProcess, 125u) != FALSE, Stage::terminateProcess); });
		}
	}
	checked([&] {
		if (!context.waitMain(plan.graceMs, Stage::waitTerminatedMain)) throw Failure{Stage::waitTerminatedMain, ERROR_TIMEOUT};
	});
	checked([&] { context.exitCode(receipt); });
	if (context.mainEnded) checked([&] { context.closeEndedMain(); });
	bool empty = false;
	checked([&] {
		empty = context.empty(receipt, plan.graceMs);
		if (!empty) throw Failure{Stage::queryJob, ERROR_TIMEOUT};
	});
	receipt.readersRetired = context.mainEnded && empty;
}
}
Receipt run(const Plan &plan)
{
	Receipt receipt;
	receipt.nonce = plan.nonce; receipt.stage = plan.stage;
	Context context;
	try {
		setup(context);
		STARTUPINFOEXW startup{};
		startup.StartupInfo.cb = static_cast<DWORD>(sizeof(startup)); startup.lpAttributeList = context.attributes;
		startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
		startup.StartupInfo.hStdInput = context.streams[0]; startup.StartupInfo.hStdOutput = context.streams[1];
		startup.StartupInfo.hStdError = context.streams[2];
		std::wstring command = plan.commandLine;
		const std::wstring directory = plan.executable.substr(0u, plan.executable.find_last_of(L'\\') + 1u);
		require(CreateProcessW(plan.executable.c_str(), command.data(), nullptr, nullptr, TRUE,
			CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT,
			nullptr, directory.c_str(), &startup.StartupInfo, &context.process) != FALSE, Stage::createProcess);
		context.created = true; receipt.processId = context.process.dwProcessId; receipt.readersRetired = false;
		context.assigned = true; // Successful creation already applied JOB_LIST.
		BOOL member = FALSE;
		require(IsProcessInJob(context.process.hProcess, context.job, &member) != FALSE, Stage::verifyJob);
		if (!member) { context.assigned = false; throw Failure{Stage::verifyJob, ERROR_INVALID_DATA}; }
		if (ResumeThread(context.process.hThread) == static_cast<DWORD>(-1)) fail(Stage::resumeThread);
		if (!context.waitMain(plan.deadlineMs, Stage::waitMain)) {
			receipt.expired = true; context.terminate(receipt);
			if (!context.waitMain(plan.graceMs, Stage::waitTerminatedMain)) throw Failure{Stage::waitTerminatedMain, ERROR_TIMEOUT};
		}
		context.exitCode(receipt);
		context.closeEndedMain();
		if (!context.empty(receipt, plan.graceMs)) {
			context.terminate(receipt);
			if (!context.empty(receipt, plan.graceMs)) throw Failure{Stage::queryJob, ERROR_TIMEOUT};
		}
		receipt.readersRetired = context.mainEnded && receipt.activeProcesses == 0u;
	} catch (const Failure &error) { receipt.failure = error; }
	catch (const std::bad_alloc &) { receipt.failure = Failure{Stage::supervisor, ERROR_NOT_ENOUGH_MEMORY}; }
	catch (...) { receipt.failure = Failure{Stage::supervisor, ERROR_GEN_FAILURE}; }
	if (!receipt.readersRetired) cleanupProcesses(context, plan, receipt);
	context.closeHandles(receipt);
	return receipt;
}
}
