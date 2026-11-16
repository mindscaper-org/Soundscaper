# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.25)
if(CMAKE_SOURCE_DIR STREQUAL CMAKE_CURRENT_SOURCE_DIR)
	project(soundscaper_juce_effects LANGUAGES C CXX)
	if(APPLE)
		enable_language(OBJCXX)
	endif()
	add_subdirectory("${SOUNDSCAPER_JUCE_ROOT}" "${CMAKE_CURRENT_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)
	include(CTest)
endif()

include(cmake/effect-catalog.cmake)
add_library(soundscaper_juce_effect_core STATIC src/processor.cpp src/processor_state.cpp src/standard_processors.cpp src/filter_processors.cpp)
target_compile_features(soundscaper_juce_effect_core PUBLIC cxx_std_20)
target_include_directories(soundscaper_juce_effect_core PUBLIC src "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_compile_definitions(soundscaper_juce_effect_core PUBLIC
	JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_USE_FLAC=0 JUCE_USE_OGGVORBIS=0
	JUCE_USE_MP3AUDIOFORMAT=0 JUCE_USE_WINDOWS_MEDIA_FORMAT=0)
target_link_libraries(soundscaper_juce_effect_core PUBLIC juce::juce_dsp)
set_target_properties(soundscaper_juce_effect_core PROPERTIES POSITION_INDEPENDENT_CODE YES
	CXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN YES)

add_library(soundscaper_juce_effects MODULE src/clap_plugin.cpp src/editor.cpp)
if(APPLE)
	target_sources(soundscaper_juce_effects PRIVATE src/editor_dispatch_mac.cpp)
else()
	target_sources(soundscaper_juce_effects PRIVATE
		../soundscaper-professional-host/src/juce_message_dispatcher.cpp)
endif()
target_include_directories(soundscaper_juce_effects PRIVATE "${SOUNDSCAPER_CLAP_ROOT}/include"
	../soundscaper-professional-host/src)
target_link_libraries(soundscaper_juce_effects PRIVATE soundscaper_juce_effect_core juce::juce_gui_extra)
set_target_properties(soundscaper_juce_effects PROPERTIES PREFIX "" SUFFIX ".clap"
	CXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN YES)
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU")
	# GNU unique exports pin a CLAP DSO after deinit, leaving its GUI dispatcher
	# stopped on the next init. Permit the last reference to unload it completely.
	target_compile_options(soundscaper_juce_effect_core PRIVATE -fno-gnu-unique)
	target_compile_options(soundscaper_juce_effects PRIVATE -fno-gnu-unique)
endif()
install(TARGETS soundscaper_juce_effects LIBRARY DESTINATION runtime/effects RUNTIME DESTINATION runtime/effects)

if(BUILD_TESTING)
	add_executable(soundscaper_juce_effect_catalog_test tests/catalog_test.cpp)
	target_link_libraries(soundscaper_juce_effect_catalog_test PRIVATE soundscaper_juce_effect_core)
	add_test(NAME soundscaper_juce_effect_catalog_test COMMAND soundscaper_juce_effect_catalog_test)
	add_executable(soundscaper_juce_effect_clap_test tests/clap_test.cpp)
	target_include_directories(soundscaper_juce_effect_clap_test PRIVATE "${SOUNDSCAPER_CLAP_ROOT}/include")
	target_link_libraries(soundscaper_juce_effect_clap_test PRIVATE soundscaper_juce_effect_core)
	add_dependencies(soundscaper_juce_effect_clap_test soundscaper_juce_effects)
	add_test(NAME soundscaper_juce_effect_clap_test COMMAND soundscaper_juce_effect_clap_test
		$<TARGET_FILE:soundscaper_juce_effects>)
	add_executable(soundscaper_juce_effect_processor_test tests/processor_test.cpp)
	target_link_libraries(soundscaper_juce_effect_processor_test PRIVATE soundscaper_juce_effect_core)
	add_test(NAME soundscaper_juce_effect_processor_test COMMAND soundscaper_juce_effect_processor_test)
	if(TARGET soundscaper_professional_plugin)
		add_executable(soundscaper_juce_effect_host_test tests/host_test.cpp)
		target_include_directories(soundscaper_juce_effect_host_test PRIVATE ../soundscaper-professional-host/src)
		target_link_libraries(soundscaper_juce_effect_host_test PRIVATE soundscaper_professional_plugin)
		add_dependencies(soundscaper_juce_effect_host_test soundscaper_juce_effects)
		add_test(NAME soundscaper_juce_effect_host_test COMMAND soundscaper_juce_effect_host_test
			$<TARGET_FILE:soundscaper_juce_effects>)
		set_tests_properties(soundscaper_juce_effect_host_test PROPERTIES TIMEOUT 30)
	endif()
endif()
