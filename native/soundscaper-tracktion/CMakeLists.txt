cmake_minimum_required(VERSION 3.22)
project(SoundscaperTracktion VERSION 0.1.0 LANGUAGES C CXX)

if(NOT EXISTS "${SOUNDSCAPER_TRACKTION_SOURCE}/CMakeLists.txt")
	message(FATAL_ERROR "SOUNDSCAPER_TRACKTION_SOURCE must name the provisioned Tracktion source")
endif()
if(NOT EXISTS "${SOUNDSCAPER_TRACKTION_JUCE_SOURCE}/CMakeLists.txt")
	message(FATAL_ERROR "SOUNDSCAPER_TRACKTION_JUCE_SOURCE must name the provisioned JUCE source")
endif()
if(WIN32 AND (NOT SOUNDSCAPER_ASIO_ROOT OR NOT EXISTS "${SOUNDSCAPER_ASIO_ROOT}/common/iasiodrv.h"
		OR NOT EXISTS "${SOUNDSCAPER_ASIO_ROOT}/common/asio.h" OR NOT EXISTS "${SOUNDSCAPER_ASIO_ROOT}/common/asiosys.h"))
	message(FATAL_ERROR "Windows Tracktion builds require SOUNDSCAPER_ASIO_ROOT to name the authenticated ASIO SDK")
endif()

set(TE_ADD_EXAMPLES OFF CACHE BOOL "" FORCE)
add_subdirectory("${SOUNDSCAPER_TRACKTION_JUCE_SOURCE}" juce EXCLUDE_FROM_ALL)
include(tracktion-source.cmake)
set(tracktion_build_source "${CMAKE_CURRENT_BINARY_DIR}/tracktion-source")
soundscaper_prepare_tracktion_source("${SOUNDSCAPER_TRACKTION_SOURCE}" "${tracktion_build_source}")
add_subdirectory("${tracktion_build_source}" tracktion EXCLUDE_FROM_ALL)

# Link the pinned engine once for the native peer and the C++ session test.
add_library(soundscaper_tracktion_session STATIC
	session.cpp session_transport.cpp session_recording.cpp session_device.cpp session_effects.cpp project_archive.cpp)
target_compile_features(soundscaper_tracktion_session PUBLIC cxx_std_20)
target_compile_definitions(soundscaper_tracktion_session PUBLIC
	JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
	JUCE_STANDALONE_APPLICATION=1
	JUCE_USE_CURL=0
	JUCE_WEB_BROWSER=0
	JUCE_MODAL_LOOPS_PERMITTED=0)
target_include_directories(soundscaper_tracktion_session PUBLIC
	"${CMAKE_CURRENT_SOURCE_DIR}"
	"${SOUNDSCAPER_TRACKTION_JUCE_SOURCE}/modules")
target_link_libraries(soundscaper_tracktion_session PRIVATE tracktion::tracktion_engine)
if(WIN32)
	target_compile_definitions(soundscaper_tracktion_session PUBLIC JUCE_ASIO=1 JUCE_ASIO_USE_EXTERNAL_SDK=1)
	target_include_directories(soundscaper_tracktion_session PRIVATE "${SOUNDSCAPER_ASIO_ROOT}/common")
elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	target_link_libraries(soundscaper_tracktion_session PRIVATE atomic)
	include(pipewire-transport.cmake)
	soundscaper_add_pipewire(soundscaper_tracktion_session)
endif()

add_executable(soundscaper_tracktion_peer peer_main.cpp peer_commands.cpp peer_effects.cpp)
target_link_libraries(soundscaper_tracktion_peer PRIVATE soundscaper_tracktion_session)

include(CTest)
if(BUILD_TESTING)
	add_executable(soundscaper_tracktion_session_test tests/session_test.cpp)
	target_link_libraries(soundscaper_tracktion_session_test PRIVATE soundscaper_tracktion_session)
	add_test(NAME soundscaper_tracktion_session COMMAND soundscaper_tracktion_session_test)

	find_program(SOUNDSCAPER_TRACKTION_NODE node REQUIRED)
	add_test(NAME soundscaper_tracktion_peer
		COMMAND "${CMAKE_COMMAND}" -E env "SOUNDSCAPER_TRACKTION_TEST_PEER=$<TARGET_FILE:soundscaper_tracktion_peer>"
			"${SOUNDSCAPER_TRACKTION_NODE}" --import tsx --test --test-concurrency=1
			native/soundscaper-tracktion/tests/peer_test.ts native/soundscaper-tracktion/tests/pipewire_output_test.ts
			native/soundscaper-tracktion/tests/offline_effect_peer_test.ts native/soundscaper-tracktion/tests/plugin_library_test.ts)
	add_test(NAME soundscaper_tracktion_audio_queue
		COMMAND "${SOUNDSCAPER_TRACKTION_NODE}" --import tsx --test native/soundscaper-tracktion/tests/audio_queue_test.ts)
	set_tests_properties(soundscaper_tracktion_peer soundscaper_tracktion_audio_queue PROPERTIES
		WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../.." TIMEOUT 30)
endif()
