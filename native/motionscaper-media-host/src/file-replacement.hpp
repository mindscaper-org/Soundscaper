/* SPDX-License-Identifier: AGPL-3.0-only */
#pragma once
#include <span>
#include <string_view>

namespace motionscaper::files {
// source, destination, parent dev/ino, source dev/ino, destination dev/ino.
// Only the destination pair may be "-", denoting an expected absent name.
void replace_file(std::span<const std::string_view> fields);
}
