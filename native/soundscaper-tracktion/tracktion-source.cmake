# SPDX-License-Identifier: AGPL-3.0-only

# Tracktion's one-millisecond split margin protects other clip types.
# Audio clips use the engine's existing minimum length so a one-frame
# edit remains possible at any Soundscaper project rate.
function(soundscaper_prepare_tracktion_source source destination)
	set(relative "modules/tracktion_engine/model/clips/tracktion_ClipOwner.cpp")
	set(clip_owner "${source}/${relative}")
	file(SHA256 "${clip_owner}" digest)
	if(NOT digest STREQUAL "3f93361a6f6dec903aae05fa2e37c9a58e1cf38aa24c20dedda00428f25275ee")
		message(FATAL_ERROR "Requalify the Tracktion audio-clip split patch for the new source")
	endif()

	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${clip_owner}")
	file(COPY "${source}/" DESTINATION "${destination}" PATTERN "tracktion_ClipOwner.cpp" EXCLUDE)
	file(READ "${clip_owner}" code)
	string(REPLACE "if (clip.getPosition().time.reduced (0.001s).contains (time)"
		"const auto margin = dynamic_cast<WaveAudioClip*> (&clip) != nullptr ? Clip::minimumLength : 0.001s;\n    if (clip.getPosition().time.reduced (margin).contains (time)"
		code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${relative}" CONTENT "${code}" @ONLY)
endfunction()
