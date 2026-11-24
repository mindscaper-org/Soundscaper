cmake_minimum_required(VERSION 3.22)
project(SoundscaperTracktion VERSION 0.1.0 LANGUAGES C CXX)

if(NOT EXISTS "${SOUNDSCAPER_TRACKTION_SOURCE}/CMakeLists.txt")
	message(FATAL_ERROR "SOUNDSCAPER_TRACKTION_SOURCE must name the provisioned Tracktion source")
endif()
if(NOT EXISTS "${SOUNDSCAPER_TRACKTION_JUCE_SOURCE}/CMakeLists.txt")
	message(FATAL_ERROR "SOUNDSCAPER_TRACKTION_JUCE_SOURCE must name the provisioned JUCE source")
endif()

set(TE_ADD_EXAMPLES OFF CACHE BOOL "" FORCE)
add_subdirectory("${SOUNDSCAPER_TRACKTION_JUCE_SOURCE}" juce EXCLUDE_FROM_ALL)
add_subdirectory("${SOUNDSCAPER_TRACKTION_SOURCE}" tracktion EXCLUDE_FROM_ALL)

# Keep Tracktion's JUCE build independent of the production device and plug-in peer.
juce_add_console_app(soundscaper_tracktion_session_test NEEDS_CURL FALSE NEEDS_WEB_BROWSER FALSE)
target_sources(soundscaper_tracktion_session_test PRIVATE
	session.cpp
	tests/session_test.cpp)
target_compile_features(soundscaper_tracktion_session_test PRIVATE cxx_std_20)
target_compile_definitions(soundscaper_tracktion_session_test PRIVATE
	JUCE_USE_CURL=0
	JUCE_WEB_BROWSER=0
	JUCE_MODAL_LOOPS_PERMITTED=0)
target_include_directories(soundscaper_tracktion_session_test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(soundscaper_tracktion_session_test PRIVATE tracktion::tracktion_engine)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	target_link_libraries(soundscaper_tracktion_session_test PRIVATE atomic)
endif()

enable_testing()
add_test(NAME soundscaper_tracktion_session COMMAND soundscaper_tracktion_session_test)
