/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef SOUNDSCAPER_WINDOWS_CHILD_POINTER_WIDTH_H
#define SOUNDSCAPER_WINDOWS_CHILD_POINTER_WIDTH_H
#include <windows.h>
#include <array>
#include <cstddef>
#include <cstring>
namespace soundscaper {
inline size_t childPointerWidth(HANDLE executable, bool trustedPlugin)
{
	LARGE_INTEGER zero{}, position{};
	if (!SetFilePointerEx(executable, zero, &position, FILE_CURRENT)
		|| !SetFilePointerEx(executable, zero, nullptr, FILE_BEGIN)) return 0u;
	IMAGE_DOS_HEADER dos{}; DWORD count = 0;
	const bool dosRead = ReadFile(executable, &dos, sizeof(dos), &count, nullptr) && count == sizeof(dos);
	std::array<unsigned char, 26> pe{};
	LARGE_INTEGER offset{}; offset.QuadPart = dos.e_lfanew;
	const bool peRead = dosRead && dos.e_magic == IMAGE_DOS_SIGNATURE && dos.e_lfanew >= 64 && dos.e_lfanew <= 65536
		&& SetFilePointerEx(executable, offset, nullptr, FILE_BEGIN)
		&& ReadFile(executable, pe.data(), static_cast<DWORD>(pe.size()), &count, nullptr) && count == pe.size();
	const bool restored = SetFilePointerEx(executable, position, nullptr, FILE_BEGIN) != FALSE;
	if (!peRead || !restored || std::memcmp(pe.data(), "PE\0\0", 4u) != 0) return 0u;
	const unsigned machine = pe[4] | static_cast<unsigned>(pe[5]) << 8u;
	const unsigned magic = pe[24] | static_cast<unsigned>(pe[25]) << 8u;
#if defined(_M_X64) || defined(__x86_64__)
	if (machine == IMAGE_FILE_MACHINE_I386 && magic == IMAGE_NT_OPTIONAL_HDR32_MAGIC && trustedPlugin) return 4u;
	if (machine == IMAGE_FILE_MACHINE_AMD64 && magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC) return 8u;
#elif defined(_M_ARM64) || defined(__aarch64__)
	(void)trustedPlugin;
	if (machine == IMAGE_FILE_MACHINE_ARM64 && magic == IMAGE_NT_OPTIONAL_HDR64_MAGIC) return 8u;
#else
	(void)trustedPlugin;
#endif
	return 0u;
}
}
#endif
