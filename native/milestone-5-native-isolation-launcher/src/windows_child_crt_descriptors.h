/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef SOUNDSCAPER_WINDOWS_CHILD_CRT_DESCRIPTORS_H
#define SOUNDSCAPER_WINDOWS_CHILD_CRT_DESCRIPTORS_H
#include <cstddef>
#include <cstdint>
#include <vector>
namespace soundscaper {
/** STARTUPINFO's CRT record is interpreted using the child's pointer width. */
inline std::vector<unsigned char> childCrtDescriptors(const std::vector<uint64_t> &handles, size_t pointerBytes)
{
	if ((pointerBytes != 4u && pointerBytes != 8u) || handles.size() < 3u || handles.size() > 4u) return {};
	std::vector<unsigned char> bytes(4u + handles.size() * (1u + pointerBytes), 0u);
	bytes[0] = static_cast<unsigned char>(handles.size());
	for (size_t index = 0; index < handles.size(); ++index) {
		const auto handle = handles[index];
		if (pointerBytes == 4u && handle > UINT32_MAX && (handle >> 32u) != UINT32_MAX) return {};
		bytes[4u + index] = 0x09u;
		for (size_t octet = 0; octet < pointerBytes; ++octet) {
			bytes[4u + handles.size() + index * pointerBytes + octet] = static_cast<unsigned char>(handle >> (8u * octet));
		}
	}
	return bytes;
}
}
#endif
