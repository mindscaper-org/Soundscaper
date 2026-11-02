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
	# Legacy plug-ins may write the complete 128-byte pin-properties record.
	# FST omits its reserved tail, which otherwise leaves JUCE's stack allocation
	# too small (including for its own short-label terminator).
	set(pin_tail "  char shortLabel[8];\n} FST_UNKNOWN(t_fstPinProperties);")
	string(FIND "${source}" "${pin_tail}" pin_position)
	if(pin_position LESS 0)
		message(FATAL_ERROR "The authenticated FST pin-properties declaration changed")
	endif()
	string(REPLACE "${pin_tail}"
		"  char shortLabel[8];\n  char reserved[48];\n} FST_UNKNOWN(t_fstPinProperties);" source "${source}")
	file(WRITE "${output}" "${source}")
endfunction()
