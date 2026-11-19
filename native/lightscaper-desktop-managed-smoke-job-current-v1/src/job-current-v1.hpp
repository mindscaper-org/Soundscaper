/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace lightscaper::managed_smoke {
enum class Stage {
	createJob, configureJob, duplicateStdin, duplicateStdout, duplicateStderr,
	initializeAttributes, inheritHandles, jobList, createProcess, assignJob, verifyJob, resumeThread,
	waitMain, queryJob, terminateJob, terminateProcess, waitTerminatedMain,
	getExitCode, closeThread, closeProcess, closeStdin, closeStdout, closeStderr,
	closeJob, supervisor
};
struct Failure { Stage stage; DWORD code; };
struct Plan {
	std::wstring receiptPath, executable, commandLine;
	std::string nonce;
	DWORD stage = 0, deadlineMs = 0, graceMs = 0;
};
struct Receipt {
	std::string nonce;
	DWORD stage = 0, processId = 0;
	std::optional<DWORD> exitCode, activeProcesses;
	bool expired = false, forcedTermination = false, readersRetired = true;
	std::optional<Failure> failure;
	std::array<Failure, 16> cleanupFailures{};
	size_t cleanupCount = 0;
	void cleanup(Failure value) noexcept;
};
Plan readPlan(int argc, wchar_t **argv);
const char *stageName(Stage stage) noexcept;
Receipt run(const Plan &plan);
std::string receiptJson(const Receipt &receipt);
void reportFailure(const char *stage, DWORD code) noexcept;
}
