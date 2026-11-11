# SPDX-License-Identifier: AGPL-3.0-only
set(midi_formats VST VST3)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
	list(APPEND midi_formats LV2)
endif()
juce_add_plugin(SoundscaperMidiFixture
	COMPANY_NAME Soundscaper PLUGIN_MANUFACTURER_CODE Scpr PLUGIN_CODE MiFx
	IS_SYNTH TRUE NEEDS_MIDI_INPUT TRUE
	FORMATS ${midi_formats} PRODUCT_NAME SoundscaperMidiFixture VERSION 1.0.0
	LV2URI "https://soundscaper.org/test/midi-fixture"
	COPY_PLUGIN_AFTER_BUILD FALSE)
target_sources(SoundscaperMidiFixture PRIVATE tests/professional_midi_fixture.cpp)
target_compile_features(SoundscaperMidiFixture PRIVATE cxx_std_20)
target_compile_definitions(SoundscaperMidiFixture PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
target_link_libraries(SoundscaperMidiFixture PRIVATE juce::juce_audio_processors juce_vst2_sdk)
add_executable(soundscaper_midi_host_self_test tests/midi_host_self_test.cpp)
target_compile_features(soundscaper_midi_host_self_test PRIVATE cxx_std_20)
target_link_libraries(soundscaper_midi_host_self_test PRIVATE soundscaper_professional_plugin)
foreach(format ${midi_formats})
	get_target_property(bundle SoundscaperMidiFixture_${format} JUCE_PLUGIN_ARTEFACT_FILE)
	if(format STREQUAL "VST")
		set(host_format vst2)
	else()
		string(TOLOWER "${format}" host_format)
	endif()
	add_dependencies(soundscaper_midi_host_self_test SoundscaperMidiFixture_${format})
	add_test(NAME soundscaper_midi_${host_format}_self_test COMMAND soundscaper_midi_host_self_test "${bundle}" "${host_format}")
	set_tests_properties(soundscaper_midi_${host_format}_self_test PROPERTIES TIMEOUT 30)
endforeach()
