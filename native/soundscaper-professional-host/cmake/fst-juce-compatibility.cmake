# SPDX-License-Identifier: AGPL-3.0-only

# JUCE allocates legacy ABI records using sizeof, including the original inline
# array floors. FST describes their trailing arrays as flexible arrays instead.
# In particular, JUCE's speaker holder subtracts eight elements before allocating
# extra channels, so using FST's eight-byte sizeof corrupts the heap on stereo
# opens. Adapt only the build copy; the authenticated source remains unchanged.
function(soundscaper_write_fst_juce_header input output)
	file(READ "${input}" source)
	foreach(pair
		"t_fstSpeakerProperties speakers[]|t_fstSpeakerProperties speakers[8]"
		"t_fstEvent*events[]|t_fstEvent*events[2]"
		"char keyName[]|char keyName[64]")
		string(REPLACE "|" ";" parts "${pair}")
		list(GET parts 0 before)
		list(GET parts 1 after)
		string(FIND "${source}" "${before}" position)
		if(position LESS 0)
			message(FATAL_ERROR "The authenticated FST header has an unexpected trailing-array declaration")
		endif()
		string(REPLACE "${before}" "${after}" source "${source}")
	endforeach()
	file(WRITE "${output}" "${source}")
endfunction()
