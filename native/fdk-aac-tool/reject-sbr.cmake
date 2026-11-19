# SPDX-License-Identifier: MIT
# Soundscaper modification, November 19, 2026. Refuse implicit SBR when this
# decoder encounters it in an AAC fill element. The stripped upstream build
# otherwise consumes the fill data and returns only the AAC-LC core.
file(READ "${FDK_AAC_SOURCE}/libAACdec/src/aacdecoder.cpp" decoder)
set(anchor "  *count -= 4;\n\n  /* For ELD, the SBR signaling")
set(replacement "  *count -= 4;\n  if (extension_type == EXT_SBR_DATA || extension_type == EXT_SBR_DATA_CRC) {\n    return AAC_DEC_UNSUPPORTED_EXTENSION_PAYLOAD;\n  }\n\n  /* For ELD, the SBR signaling")
string(FIND "${decoder}" "${anchor}" offset)
if(offset EQUAL -1)
    message(FATAL_ERROR "The pinned FDK decoder source no longer matches the SBR check")
endif()
string(REPLACE "${anchor}" "${replacement}" decoder "${decoder}")
set(patched_decoder "${CMAKE_CURRENT_BINARY_DIR}/aacdecoder.cpp")
file(CONFIGURE OUTPUT "${patched_decoder}" CONTENT "${decoder}" @ONLY)
