/* SPDX-License-Identifier: AGPL-3.0-only */
#include "job-current-v1.hpp"
#include <algorithm>
#include <cwchar>
#include <limits>

namespace lightscaper::managed_smoke {
namespace {
[[noreturn]] void refuse() { throw Failure{Stage::supervisor, ERROR_INVALID_PARAMETER}; }
DWORD number(const std::wstring &value, DWORD maximum)
{
	if (value.empty() || value.size() > 6u) refuse();
	DWORD output = 0;
	for (const wchar_t character : value) {
		if (character < L'0' || character > L'9') refuse();
		output = output * 10u + static_cast<DWORD>(character - L'0');
	}
	if (output == 0u || output > maximum || std::to_wstring(output) != value) refuse();
	return output;
}
void absolutePath(const std::wstring &value)
{
	if (value.empty() || value.size() > 32'700u) refuse();
	const bool drive = value.size() >= 3u && ((value[0] >= L'A' && value[0] <= L'Z')
		|| (value[0] >= L'a' && value[0] <= L'z')) && value[1] == L':' && value[2] == L'\\';
	const bool unc = value.size() >= 5u && value[0] == L'\\' && value[1] == L'\\'
		&& value[2] != L'.' && value[2] != L'?' && value.find(L'\\', 2u) != std::wstring::npos;
	if (!drive && !unc) refuse();
	std::vector<wchar_t> normalized(32'768u);
	const DWORD length = GetFullPathNameW(value.c_str(), static_cast<DWORD>(normalized.size()), normalized.data(), nullptr);
	if (length == 0u || length >= normalized.size() || std::wstring(normalized.data(), length) != value) refuse();
}
std::wstring quoted(const std::wstring &value)
{
	std::wstring output = L"\"";
	size_t slashes = 0u;
	for (const wchar_t character : value) {
		if (character == L'\\') { ++slashes; continue; }
		output.append(character == L'\"' ? slashes * 2u + 1u : slashes, L'\\');
		slashes = 0u; output.push_back(character);
	}
	output.append(slashes * 2u, L'\\'); output.push_back(L'\"');
	return output;
}
}
Plan readPlan(int argc, wchar_t **argv)
{
	Plan output;
	unsigned int admitted = 0u;
	int separator = 0;
	for (int index = 1; index < argc; ++index) {
		const std::wstring argument(argv[index]);
		if (argument == L"--") { separator = index; break; }
		const auto assign = [&](const wchar_t *prefix, unsigned int bit, auto consumer) {
			const size_t length = std::wcslen(prefix);
			if (argument.rfind(prefix, 0u) != 0u) return false;
			if ((admitted & bit) != 0u) refuse();
			admitted |= bit; consumer(argument.substr(length)); return true;
		};
		if (assign(L"--receipt=", 1u, [&](const std::wstring &value) { absolutePath(value); output.receiptPath = value; })
			|| assign(L"--nonce=", 2u, [&](const std::wstring &value) {
				if (value.size() != 32u || !std::all_of(value.begin(), value.end(), [](wchar_t character) {
					return (character >= L'0' && character <= L'9') || (character >= L'a' && character <= L'f');
				})) refuse();
				for (const wchar_t character : value) output.nonce.push_back(static_cast<char>(character));
			})
			|| assign(L"--stage=", 4u, [&](const std::wstring &value) { output.stage = number(value, 3u); })
			|| assign(L"--deadline-ms=", 8u, [&](const std::wstring &value) { output.deadlineMs = number(value, 210'000u); })
			|| assign(L"--grace-ms=", 16u, [&](const std::wstring &value) { output.graceMs = number(value, 5'000u); })) continue;
		refuse();
	}
	if (admitted != 31u || separator == 0 || separator + 1 >= argc) refuse();
	output.executable = argv[separator + 1]; absolutePath(output.executable);
	for (int index = separator + 1; index < argc; ++index) {
		if (!output.commandLine.empty()) output.commandLine.push_back(L' ');
		output.commandLine += quoted(argv[index]);
		if (output.commandLine.size() >= 32'767u) refuse();
	}
	return output;
}
}
