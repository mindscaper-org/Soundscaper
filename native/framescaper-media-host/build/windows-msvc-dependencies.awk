# SPDX-License-Identifier: AGPL-3.0-only

# Preserve the pinned FFmpeg MSVC /showIncludes dependency filter.
/including/ {
	sub(/^.*file: */, "");
	gsub(/\\/, "/");
	if (!match($0, / /)) print target ":", $0;
}
