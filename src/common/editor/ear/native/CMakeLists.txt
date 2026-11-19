cmake_minimum_required(VERSION 3.16)
project(soundscaper_ear LANGUAGES CXX)
set(EAR_UNIT_TESTS OFF CACHE BOOL "" FORCE)
set(EAR_EXAMPLES OFF CACHE BOOL "" FORCE)
set(EAR_PACKAGE_AND_INSTALL OFF CACHE BOOL "" FORCE)
set(EAR_SIMD OFF CACHE BOOL "" FORCE)
add_compile_options(-O2 -fwasm-exceptions -ffp-contract=off)
add_subdirectory("${EAR_SOURCE}" libear)
add_executable(ear-wasm ear-wasm.cpp)
target_link_libraries(ear-wasm PRIVATE ear)
set_target_properties(ear-wasm PROPERTIES SUFFIX ".wasm")
target_link_options(ear-wasm PRIVATE
  -O2 -fwasm-exceptions --no-entry -Wl,--strip-all
  -sSTANDALONE_WASM=1 -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=0
  -sINITIAL_MEMORY=33554432 -sSTACK_SIZE=1048576
  "-sEXPORTED_FUNCTIONS=['_ear_initialize','_ear_speaker_name','_ear_label_pointer','_ear_pack_pointer','_ear_gains_pointer','_ear_direct','_ear_object','_ear_error','_ear_close']")
