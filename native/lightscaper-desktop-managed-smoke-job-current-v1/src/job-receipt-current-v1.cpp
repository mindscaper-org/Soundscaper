/* SPDX-License-Identifier: AGPL-3.0-only */
#include "job-current-v1.hpp"
#include <cstdio>
#include <sstream>

namespace lightscaper::managed_smoke {
const char *stageName(Stage stage) noexcept
{
	switch (stage) {
	case Stage::createJob: return "create-job";
	case Stage::configureJob: return "configure-job";
	case Stage::duplicateStdin: return "duplicate-stdin";
	case Stage::duplicateStdout: return "duplicate-stdout";
	case Stage::duplicateStderr: return "duplicate-stderr";
	case Stage::initializeAttributes: return "initialize-attributes";
	case Stage::inheritHandles: return "inherit-handles";
	case Stage::jobList: return "job-list";
	case Stage::createProcess: return "create-process";
	case Stage::assignJob: return "assign-job";
	case Stage::verifyJob: return "verify-job";
	case Stage::resumeThread: return "resume-thread";
	case Stage::waitMain: return "wait-main";
	case Stage::queryJob: return "query-job";
	case Stage::terminateJob: return "terminate-job";
	case Stage::terminateProcess: return "terminate-process";
	case Stage::waitTerminatedMain: return "wait-terminated-main";
	case Stage::getExitCode: return "get-exit-code";
	case Stage::closeThread: return "close-thread";
	case Stage::closeProcess: return "close-process";
	case Stage::closeStdin: return "close-stdin";
	case Stage::closeStdout: return "close-stdout";
	case Stage::closeStderr: return "close-stderr";
	case Stage::closeJob: return "close-job";
	case Stage::supervisor: return "supervisor";
	}
	return "supervisor";
}
std::string receiptJson(const Receipt &receipt)
{
	std::ostringstream output;
	output << std::boolalpha << "{\"schemaVersion\":1,\"nonce\":\"" << receipt.nonce << "\",\"stage\":" << receipt.stage
		<< ",\"processId\":" << receipt.processId << ",\"exitCode\":";
	if (receipt.exitCode) output << *receipt.exitCode; else output << "null";
	output << ",\"expired\":" << receipt.expired << ",\"forcedTermination\":" << receipt.forcedTermination
		<< ",\"readersRetired\":" << receipt.readersRetired << ",\"activeProcesses\":";
	if (receipt.activeProcesses) output << *receipt.activeProcesses; else output << "null";
	const auto error = [&](Failure value) {
		output << "{\"stage\":\"" << stageName(value.stage) << "\",\"code\":" << value.code << '}';
	};
	output << ",\"failure\":";
	if (receipt.failure) error(*receipt.failure); else output << "null";
	output << ",\"cleanupFailures\":[";
	for (size_t index = 0u; index < receipt.cleanupCount; ++index) {
		if (index != 0u) output << ',';
		error(receipt.cleanupFailures[index]);
	}
	output << "]}\n";
	return output.str();
}
void reportFailure(const char *stage, DWORD code) noexcept
{
	std::array<char, 192> bytes{};
	const int length = std::snprintf(bytes.data(), bytes.size(), "LIGHTSCAPER_MANAGED_JOB_FAILURE_V1 %s %lu\n", stage, static_cast<unsigned long>(code));
	const HANDLE handle = GetStdHandle(STD_ERROR_HANDLE);
	if (length > 0 && static_cast<size_t>(length) < bytes.size() && handle != nullptr && handle != INVALID_HANDLE_VALUE) {
		DWORD written = 0u;
		(void)WriteFile(handle, bytes.data(), static_cast<DWORD>(length), &written, nullptr);
	}
}
}
