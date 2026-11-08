#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only

# Keep the pinned MSVC showIncludes grammar out of native Make command quoting.
# A failed compiler/filter never replaces an existing complete dependency file.
set -euo pipefail
if [[ $# -lt 3 || -z $1 || -z $2 ]]; then exit 64; fi
target=$1
destination=$2
shift 2
# FFmpeg's common.mak decorates silent compiler commands with one Make prefix.
# It is argv here, so normalize only that executable, never flags or @responses.
compiler=${1#@}
shift
if [[ -z $compiler ]]; then exit 64; fi
pending=$(mktemp "${destination}.pending.XXXXXX")
trap 'rm -f -- "$pending"' EXIT
"$compiler" "$@" 2>&1 | LC_ALL=C awk -v target="$target" '
/including/ {
	sub(/^.*file: */, ""); sub(/\r$/, ""); gsub(/\\/, "/");
	if (!match($0, / /)) print target ":", $0;
	next;
}
{
	remaining = 16384 - diagnostics;
	if (remaining > 0) {
		message = substr($0, 1, remaining - 1);
		print message > "/dev/stderr";
		diagnostics += length(message) + 1;
	}
}' > "$pending"
mv -f -- "$pending" "$destination"
