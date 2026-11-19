# SPDX-License-Identifier: AGPL-3.0-only
cmake_minimum_required(VERSION 3.25)
project(soundscaper_midi_benchmark LANGUAGES C CXX)
set(BUILD_TESTING OFF CACHE BOOL "Build only the MIDI benchmark" FORCE)
add_subdirectory("${CMAKE_CURRENT_LIST_DIR}/../../../native/soundscaper-professional-host" professional)
add_executable(soundscaper_midi_benchmark midi-benchmark.cpp)
target_compile_features(soundscaper_midi_benchmark PRIVATE cxx_std_20)
target_link_libraries(soundscaper_midi_benchmark PRIVATE soundscaper_professional_plugin)
