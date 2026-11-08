/* SPDX-License-Identifier: AGPL-3.0-only */

// Linux link-time test seam only. The shipping role gets no test commands.
// Actually closes the first regular-file handle, then reports EINTR: retrying
// that numeric descriptor could close a newly reused descriptor.
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
extern "C" int __real_close(int);
namespace {
bool failed = false;
const bool directory_fault = [] { const auto* value = std::getenv("SCAPE_GRANTED_CLOSE_FAULT_DIRECTORY"); return value && value[0] == '1' && value[1] == '\0'; }();
int replaced = -1;
unsigned retries = 0;
void receipt() {
	std::fprintf(stderr, "SCAPE_CLOSE_FAULT actual=1 replacement=%d retries=%u\n", replaced >= 0 ? 1 : 0, retries);
}
}
extern "C" int __wrap_close(int descriptor) {
	if (failed && descriptor == replaced) ++retries;
	struct stat value{};
	if (!failed && ::fstat(descriptor, &value) == 0 && (directory_fault ? S_ISDIR(value.st_mode) : S_ISREG(value.st_mode))) {
		failed = true;
		const auto result = __real_close(descriptor);
		if (result != 0) return result;
		replaced = ::open("/dev/null", O_RDONLY | O_CLOEXEC);
		(void)std::atexit(receipt);
		errno = EINTR; return -1;
	}
	return __real_close(descriptor);
}
