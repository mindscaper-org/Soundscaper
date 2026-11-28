# SPDX-License-Identifier: AGPL-3.0-only

include("${CMAKE_CURRENT_LIST_DIR}/../tracktion-source.cmake")
include("${CMAKE_CURRENT_LIST_DIR}/../juce-wave-source.cmake")
soundscaper_prepare_tracktion_source("${SOUNDSCAPER_TRACKTION_SOURCE}" "${SOUNDSCAPER_TRACKTION_WORKSPACE}")
soundscaper_patch_juce_wave_reader("${SOUNDSCAPER_TRACKTION_JUCE_SOURCE}" "${SOUNDSCAPER_TRACKTION_JUCE_WORKSPACE}")
