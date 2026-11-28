#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
set -euo pipefail

modules=(
	juce_audio_basics/juce_audio_basics.cpp
	juce_audio_devices/juce_audio_devices.cpp
	juce_audio_formats/juce_audio_formats.cpp
	juce_audio_processors_headless/juce_audio_processors_headless.cpp
	juce_audio_processors/juce_audio_processors.cpp
	juce_audio_utils/juce_audio_utils.cpp
	juce_core/juce_core.cpp
	juce_core/juce_core_CompilationTime.cpp
	juce_data_structures/juce_data_structures.cpp
	juce_dsp/juce_dsp.cpp
	juce_events/juce_events.cpp
	juce_graphics/juce_graphics.cpp
	juce_graphics/juce_graphics_Harfbuzz.cpp
	juce_gui_basics/juce_gui_basics.cpp
	juce_gui_basics/juce_gui_basics_2.cpp
	juce_gui_basics/juce_gui_basics_3.cpp
	juce_gui_basics/juce_gui_basics_4.cpp
	juce_gui_basics/juce_gui_basics_5.cpp
	juce_gui_extra/juce_gui_extra.cpp
	juce_osc/juce_osc.cpp
)
flags=(-O2 -DNDEBUG -pthread -fexceptions -ffunction-sections -fdata-sections
	-DJUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1 -DJUCE_STANDALONE_APPLICATION=1
	-DJUCE_WEB_BROWSER=0 -DJUCE_USE_CURL=0 -DTRACKTION_LOG_ENABLED=0
	-I/source/juce/modules -I/source/tracktion/modules -I/project)

sources=("${modules[@]/#/\/source\/juce\/modules\/}"
	/source/tracktion/modules/tracktion_engine/tracktion_engine_*.cpp
	/source/tracktion/modules/tracktion_core/tracktion_core.cpp
	/source/tracktion/modules/tracktion_graph/tracktion_graph.cpp
	/project/session.cpp /project/session_paging.cpp /project/session_automation.cpp /project/session_range.cpp
	/project/session_clipboard.cpp /project/session_transport.cpp /project/session_recording.cpp
	/project/session_device.cpp /project/session_effects.cpp /project/session_media.cpp /project/project_archive.cpp
	/source/juce/modules/juce_core/juce_core_zlib.c
	/source/juce/modules/juce_audio_formats/juce_audio_formats_*.c
	/source/juce/modules/juce_graphics/juce_graphics_*.c)
objects=()
for source in "${sources[@]}"; do
	objects+=("${source##*/}.o")
done

compile_object() {
	local source="$1"
	local object="${source##*/}.o"
	shift
	if [[ "$source" == *.cpp ]]; then
		exec em++ -std=c++20 "$@" -c "$source" -o "$object"
	fi
	exec emcc "$@" -c "$source" -o "$object"
}
export -f compile_object

# Match the probe container's two CPUs while keeping the original link order.
printf '%s\0' "${sources[@]}" | xargs -0 -P 2 -I '{}' bash -c 'compile_object "$@"' bash '{}' "${flags[@]}"

# Keep JUCE file reads and recording writes in Wasm across pthreads.
# The JavaScript worker can continue serving editor and hosted audio requests.
link() {
	em++ -O2 -pthread -fexceptions "${objects[@]}" -sINITIAL_MEMORY=134217728 \
		-sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 \
		-sWASMFS=1 -sFORCE_FILESYSTEM=1 \
		-sPTHREAD_POOL_SIZE=16 -sPTHREAD_POOL_SIZE_STRICT=2 -sPROXY_TO_PTHREAD=1 -sSTACK_SIZE=524288 "$@"
}

em++ -std=c++20 "${flags[@]}" -c /project/tests/session_test.cpp -o session_test.o
link session_test.o -sEXIT_RUNTIME=1 -o /output/edit-test.js
result=$(timeout 40s node /output/edit-test.js)
printf '%s\n' "$result"
[[ "$result" == *'Tracktion session editing, rendering and hosted playback passed.'* ]]

if [[ "${1:-}" == --browser ]]; then
	em++ -std=c++20 "${flags[@]}" -c /project/wasm/command_main.cpp -o command_main.o
	em++ -std=c++20 "${flags[@]}" -c /project/peer_commands.cpp -o peer_commands.o
	link command_main.o peer_commands.o -sENVIRONMENT=web,worker \
		-sEXPORTED_FUNCTIONS=_main,_malloc,_free -sEXPORTED_RUNTIME_METHODS=FS,UTF8ToString \
		-o /output/edit-core.js
fi
