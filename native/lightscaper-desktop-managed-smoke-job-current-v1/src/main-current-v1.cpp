/* SPDX-License-Identifier: AGPL-3.0-only */
#include "job-current-v1.hpp"

namespace {
class ReceiptFile {
public:
	HANDLE handle = INVALID_HANDLE_VALUE;
	~ReceiptFile() { if (handle != INVALID_HANDLE_VALUE) (void)CloseHandle(handle); }
};
bool writeReceipt(ReceiptFile &file, const std::string &bytes)
{
	using lightscaper::managed_smoke::reportFailure;
	if (bytes.empty() || bytes.size() > 16'384u) { reportFailure("receipt-length", ERROR_BUFFER_OVERFLOW); return false; }
	size_t offset = 0u;
	while (offset < bytes.size()) {
		DWORD written = 0u;
		if (!WriteFile(file.handle, bytes.data() + offset, static_cast<DWORD>(bytes.size() - offset), &written, nullptr)) {
			reportFailure("receipt-write", GetLastError()); return false;
		}
		if (written == 0u) { reportFailure("receipt-write", ERROR_WRITE_FAULT); return false; }
		offset += written;
	}
	if (!FlushFileBuffers(file.handle)) { reportFailure("receipt-flush", GetLastError()); return false; }
	if (!CloseHandle(file.handle)) { reportFailure("receipt-close", GetLastError()); return false; }
	file.handle = INVALID_HANDLE_VALUE;
	return true;
}
}
int wmain(int argc, wchar_t **argv)
{
	using namespace lightscaper::managed_smoke;
	try {
		const Plan plan = readPlan(argc, argv);
		ReceiptFile file;
		// Reserve a fresh non-inherited receipt before any app process exists.
		// The parent admits the private directory; existing files/reparse entries
		// cannot be overwritten. Only checked retirement can authorize cleanup.
		file.handle = CreateFileW(plan.receiptPath.c_str(), GENERIC_WRITE, 0u, nullptr, CREATE_NEW,
			FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_WRITE_THROUGH, nullptr);
		if (file.handle == INVALID_HANDLE_VALUE) { reportFailure("receipt-open", GetLastError()); return 125; }
		const Receipt receipt = run(plan);
		return writeReceipt(file, receiptJson(receipt)) ? 0 : 125;
	} catch (const Failure &error) { reportFailure(stageName(error.stage), error.code); }
	catch (...) { reportFailure("supervisor", ERROR_GEN_FAILURE); }
	return 125;
}
