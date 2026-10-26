#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only

# Native Windows Make truncates the generated project's source arguments.
# GNU Make writes the complete list directly; source the pinned generator in
# this interpreter so the recovered list never crosses a command-line limit.
set -euo pipefail
if [[ $# -lt 2 || ! -f $1 || ! -r $2 ]]; then exit 64; fi
generator=$1
response=$2
shift 2
IFS= read -r source_line < "$response"
source_line=${source_line%$'\r'}
read -r -a source_files <<< "$source_line"
if [[ ${#source_files[@]} -eq 0 ]]; then exit 64; fi
options=()
for argument in "$@"; do
	if [[ $argument == -* ]]; then options+=("$argument"); fi
done
# Match direct execution's script path and shell options. The upstream helper
# sources adjacent files relative to $0 and does not enable nounset/errexit.
BASH_ARGV0=$generator
set +e +u
set +o pipefail
# shellcheck source=/dev/null
source "$generator" "${options[@]}" "${source_files[@]}"
