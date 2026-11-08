/* SPDX-License-Identifier: AGPL-3.0-only */
#include "job-current-v1.hpp"
#include <algorithm>
#include <new>
#include <cstdio>
#include <cstddef>
#include <sstream>

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
// Point-in-time diagnostics only. Never use this snapshot as retirement proof.
void timeoutSnapshot(HANDLE job, DWORD primaryPid) noexcept
{
	try {
		constexpr size_t maximumMembers = 32u;
		struct ProcessIds { DWORD assigned, listed; ULONG_PTR ids[maximumMembers]; } ids{};
		static_assert(offsetof(ProcessIds, ids) == offsetof(JOBOBJECT_BASIC_PROCESS_ID_LIST, ProcessIdList));
		const BOOL queried = QueryInformationJobObject(job, JobObjectBasicProcessIdList, &ids,
			static_cast<DWORD>(sizeof(ids)), nullptr);
		const DWORD queryError = queried ? ERROR_SUCCESS : GetLastError();
		const size_t count = queried ? std::min<size_t>(ids.listed, maximumMembers) : 0u;
		std::ostringstream out;
		out << "LIGHTSCAPER_MANAGED_JOB_SNAPSHOT_V1 {\"primaryPid\":" << primaryPid << ",\"queryError\":" << queryError
			<< ",\"enumerationTruncated\":" << ((!queried || ids.assigned > ids.listed || ids.listed > maximumMembers) ? "true" : "false")
			<< ",\"numberAssigned\":";
		if (queried) out << ids.assigned; else out << "null";
		out << ",\"members\":[";
		std::array<wchar_t, 32768> image{};
		for (size_t index = 0u; index < count; ++index) {
			if (index != 0u) out << ',';
			struct Held { HANDLE value; ~Held() { if (value != nullptr) (void)CloseHandle(value); } } held{nullptr};
			DWORD openError = ERROR_SUCCESS, memberError = ERROR_SUCCESS, timeError = ERROR_SUCCESS;
			DWORD imageError = ERROR_SUCCESS, archError = ERROR_SUCCESS, waitError = ERROR_SUCCESS, exitError = ERROR_SUCCESS, closeError = ERROR_SUCCESS;
			BOOL member = FALSE; bool memberKnown = false, timesKnown = false, imageKnown = false, archKnown = false, exitKnown = false;
			FILETIME created{}, ended{}, kernel{}, user{}; USHORT processMachine = 0u, nativeMachine = 0u;
			DWORD chars = static_cast<DWORD>(image.size()), waitResult = WAIT_FAILED, exitCode = 0u;
			if (ids.ids[index] > MAXDWORD) openError = ERROR_INVALID_PARAMETER;
			else {
				held.value = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, static_cast<DWORD>(ids.ids[index]));
				if (held.value == nullptr) openError = GetLastError();
			}
			if (held.value != nullptr) {
				memberKnown = IsProcessInJob(held.value, job, &member) != FALSE;
				if (!memberKnown) memberError = GetLastError();
				if (memberKnown && member) {
					timesKnown = GetProcessTimes(held.value, &created, &ended, &kernel, &user) != FALSE;
					if (!timesKnown) timeError = GetLastError();
					imageKnown = QueryFullProcessImageNameW(held.value, 0u, image.data(), &chars) != FALSE;
					if (!imageKnown) imageError = GetLastError();
					archKnown = IsWow64Process2(held.value, &processMachine, &nativeMachine) != FALSE;
					if (!archKnown) archError = GetLastError();
					waitResult = WaitForSingleObject(held.value, 0u); if (waitResult == WAIT_FAILED) waitError = GetLastError();
					exitKnown = GetExitCodeProcess(held.value, &exitCode) != FALSE; if (!exitKnown) exitError = GetLastError();
				}
				if (CloseHandle(held.value)) held.value = nullptr; else closeError = GetLastError();
			}
			out << "{\"processId\":" << ids.ids[index] << ",\"sameJob\":";
			if (memberKnown) out << (member ? "true" : "false"); else out << "null";
			out << ",\"creationTimeHex\":";
			if (timesKnown) {
				std::array<char, 17> text{};
				(void)std::snprintf(text.data(), text.size(), "%08lx%08lx", static_cast<unsigned long>(created.dwHighDateTime), static_cast<unsigned long>(created.dwLowDateTime));
				out << '"' << text.data() << '"';
			} else out << "null";
			size_t start = 0u; if (imageKnown) for (size_t i = 0u; i < chars; ++i) if (image[i] == L'\\' || image[i] == L'/') start = i + 1u;
			out << ",\"imageBasenameUtf16Hex\":";
			if (imageKnown) {
				out << '"';
				for (size_t i = start; i < std::min<size_t>(chars, start + 48u); ++i) {
					std::array<char, 5> text{}; const auto unit = static_cast<unsigned int>(image[i]);
					(void)std::snprintf(text.data(), text.size(), "%02x%02x", unit & 255u, (unit >> 8u) & 255u); out << text.data();
				}
				out << '"';
			} else out << "null";
			out << ",\"imageTruncated\":" << ((imageKnown && chars - start > 48u) ? "true" : "false") << ",\"processMachine\":";
			if (archKnown) out << processMachine; else out << "null";
			out << ",\"nativeMachine\":"; if (archKnown) out << nativeMachine; else out << "null";
			out << ",\"waitResult\":"; if (memberKnown && member) out << waitResult; else out << "null";
			out << ",\"exitCode\":"; if (exitKnown) out << exitCode; else out << "null";
			out << ",\"errors\":{\"open\":" << openError << ",\"membership\":" << memberError << ",\"times\":" << timeError
				<< ",\"image\":" << imageError << ",\"architecture\":" << archError << ",\"wait\":" << waitError
				<< ",\"exit\":" << exitError << ",\"close\":" << closeError << "}}";
		}
		out << "]}\n";
		const std::string bytes = out.str(); if (bytes.size() > 16u * 1024u) return;
		const HANDLE stderrHandle = GetStdHandle(STD_ERROR_HANDLE); DWORD mode = PIPE_NOWAIT;
		// No synchronous blocking fallback: saturated/unavailable stderr is unknown evidence.
		if (stderrHandle == nullptr || stderrHandle == INVALID_HANDLE_VALUE || GetFileType(stderrHandle) != FILE_TYPE_PIPE
			|| !SetNamedPipeHandleState(stderrHandle, &mode, nullptr, nullptr)) return;
		DWORD written = 0u; (void)WriteFile(stderrHandle, bytes.data(), static_cast<DWORD>(bytes.size()), &written, nullptr);
	} catch (...) {} // Diagnostics cannot mask or postpone the existing timeout cleanup with an exception.
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
			receipt.expired = true; timeoutSnapshot(context.job, receipt.processId); context.terminate(receipt);
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
