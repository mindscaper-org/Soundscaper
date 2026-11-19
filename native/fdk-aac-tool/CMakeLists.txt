# SPDX-License-Identifier: MIT
cmake_minimum_required(VERSION 3.20)
project(fdk_aac_tool LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")

# Use the shipped portable translation units. The fork's upstream CMake list
# still references several files removed by Fedora.
set(libraries libAACdec libAACenc libArithCoding libDRCdec libFDK
    libMpegTPDec libMpegTPEnc libPCMutils libSYS)
include(reject-sbr.cmake)
add_executable(fdk-aac-tool main.cpp "${patched_decoder}")
foreach(library IN LISTS libraries)
    file(GLOB units "${FDK_AAC_SOURCE}/${library}/src/*.cpp")
    list(REMOVE_ITEM units "${FDK_AAC_SOURCE}/libAACdec/src/aacdecoder.cpp")
    target_sources(fdk-aac-tool PRIVATE ${units})
    target_include_directories(fdk-aac-tool PRIVATE "${FDK_AAC_SOURCE}/${library}/include")
endforeach()
target_include_directories(fdk-aac-tool PRIVATE "${FDK_AAC_SOURCE}/libAACdec/src")
if(MSVC)
    target_compile_definitions(fdk-aac-tool PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()
install(TARGETS fdk-aac-tool RUNTIME DESTINATION .)
