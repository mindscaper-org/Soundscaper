#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only

# Keep the pinned MSVC showIncludes grammar out of native Make command quoting.
# A failed compiler/filter never replaces an existing complete dependency file.
set -euo pipefail
if [[ $# -lt 3 || -z $1 || -z $2 ]]; then exit 64; fi
target=$1
destination=$2
shift 2
pending=$(mktemp "${destination}.pending.XXXXXX")
trap 'rm -f -- "$pending"' EXIT
"$@" 2>&1 | awk -v target="$target" '
/including/ {
	sub(/^.*file: */, ""); sub(/\r$/, ""); gsub(/\\/, "/");
	if (!match($0, / /)) print target ":", $0;
}' > "$pending"
mv -f -- "$pending" "$destination"
