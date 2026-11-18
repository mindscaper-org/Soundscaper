# SPDX-License-Identifier: AGPL-3.0-only

string(RANDOM LENGTH 12 reservation)
set(copy "${CMAKE_CURRENT_BINARY_DIR}/probe-${reservation}-映像 α.webm")
file(COPY_FILE "${FIXTURE}" "${copy}")
file(REAL_PATH "${copy}" canonical)
file(SHA256 "${canonical}" digest)
cmake_path(NATIVE_PATH canonical NORMALIZE source)
execute_process(
	COMMAND "${HOST}" --operation probe-video-source --source "${source}" --source-sha256 "${digest}"
	RESULT_VARIABLE status
	OUTPUT_VARIABLE output
	ERROR_VARIABLE error
)
file(REMOVE "${copy}")
if(NOT status EQUAL 0 OR NOT output MATCHES "\"width\":1280,\"height\":720")
	message(FATAL_ERROR "The native media host failed to probe a Unicode path (${status}): ${error}; ${output}")
endif()
