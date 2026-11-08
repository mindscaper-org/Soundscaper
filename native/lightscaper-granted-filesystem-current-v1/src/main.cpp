/* SPDX-License-Identifier: AGPL-3.0-only */
#include "granted_filesystem_protocol.hpp"
#include <cstdio>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
int main() {
#ifdef _WIN32
	if (_setmode(_fileno(stdin), _O_BINARY) < 0 || _setmode(_fileno(stdout), _O_BINARY) < 0) return 2;
#endif
	return scape::granted_files::run_granted_filesystem();
}
