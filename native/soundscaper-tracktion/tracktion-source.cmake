# SPDX-License-Identifier: AGPL-3.0-only

function(soundscaper_read_tracktion_source source relative expected output)
	set(input "${source}/${relative}")
	file(SHA256 "${input}" digest)
	if(NOT digest STREQUAL expected)
		message(FATAL_ERROR "Requalify the Tracktion source patch for ${relative}")
	endif()
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${input}")
	file(READ "${input}" code)
	set(${output} "${code}" PARENT_SCOPE)
endfunction()

function(soundscaper_patch_tracktion_source source destination relative expected before after)
	soundscaper_read_tracktion_source("${source}" "${relative}" "${expected}" original)
	string(REPLACE "${before}" "${after}" code "${original}")
	if(code STREQUAL original)
		message(FATAL_ERROR "The Tracktion source patch no longer matches ${relative}")
	endif()
	file(CONFIGURE OUTPUT "${destination}/${relative}" CONTENT "${code}" @ONLY)
endfunction()

function(soundscaper_prepare_tracktion_source source destination)
	file(COPY "${source}/" DESTINATION "${destination}"
		PATTERN "tracktion_ClipOwner.cpp" EXCLUDE
		PATTERN "tracktion_ClipOwner.h" EXCLUDE
		PATTERN "tracktion_TransportControl.cpp" EXCLUDE
		PATTERN "tracktion_InputDevice.h" EXCLUDE
		PATTERN "tracktion_WaveDeviceDescription.cpp" EXCLUDE)

	# Keep the original split margin for other clip types. Audio clips can
	# split at any valid project sample.
	set(clip_owner "modules/tracktion_engine/model/clips/tracktion_ClipOwner.cpp")
	soundscaper_read_tracktion_source("${source}" "${clip_owner}"
		"3f93361a6f6dec903aae05fa2e37c9a58e1cf38aa24c20dedda00428f25275ee" code)
	string(REPLACE "if (clip.getPosition().time.reduced (0.001s).contains (time)"
		"const auto margin = dynamic_cast<WaveAudioClip*> (&clip) != nullptr ? Clip::minimumLength : 0.001s;\n    if (clip.getPosition().time.reduced (margin).contains (time)"
		code "${code}")

	# Clip order is part of the same transaction as clip insertion. JUCE's
	# undo uses child indexes, so the sort must remain undoable.
	# Empty notifications queued by the sort must also finish before undo.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/clips/tracktion_ClipOwner.h"
		"cc332f9847996d75c8af0f20c04557692a22bd1c341afb94ac5aacabaed549db"
		"    const juce::Array<Clip*>& getClips() const;"
		"    const juce::Array<Clip*>& getClips() const;\n    void dispatchPendingClipOrdering();")
	string(REPLACE "    void handleAsyncUpdate() override"
		"    void dispatchPendingOrdering() { while (isUpdatePending()) handleUpdateNowIfNeeded(); }\n\n    void handleAsyncUpdate() override"
		code "${code}")
	string(REPLACE "const juce::Array<Clip*>& ClipOwner::getClips() const"
		"void ClipOwner::dispatchPendingClipOrdering()\n{\n    if (clipList)\n        clipList->dispatchPendingOrdering();\n}\n\nconst juce::Array<Clip*>& ClipOwner::getClips() const"
		code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${clip_owner}" CONTENT "${code}" @ONLY)

	# Preserve an explicitly chosen start sample even within the first 5 ms.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/playback/tracktion_TransportControl.cpp"
		"07f46651b67377e32bd962204c27e3f1fe57e819f21cde4e65e1f884d35eb6c0"
		[=[
                else
                {
                    if (abs (transportState->startTime) < 0.005s)
                        transportState->startTime = 0s;
                }
]=] "")

	# Complete the route change before recording. Otherwise its queued update
	# can stop and re-punch the very take that used the new route.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/playback/devices/tracktion_InputDevice.h"
		"9e3041acdd4712ce40f4b0701b74e43ed83f091d4fc2435422b5eed73e795ad7"
		"    void setRecordingEnabled (EditItemID, bool);"
		"    void setRecordingEnabled (EditItemID, bool);\n    void dispatchPendingRecordingRouting() { recordStatusUpdater.handleUpdateNowIfNeeded(); }")

	# A host can describe the enabled JUCE callback channels independently
	# of the names and indices of all physical inputs and outputs.
	set(wave_layout "modules/tracktion_engine/playback/devices/tracktion_WaveDeviceDescription.cpp")
	soundscaper_read_tracktion_source("${source}" "${wave_layout}"
		"6bd283d750704a1fa225e3f6239fc99595e7732a691878e1479305bac730d86d" code)
	string(REPLACE [=[
    if (initialiseFromCustomBehaviour (device, engine.getEngineBehaviour()))
    {
        // The host's describeWaveDevices result is authoritative — don't run
        // ensureFullChannelCoverage over it. Just refresh display names.
        refreshNamesInList (inputs,  deviceInputChannelNames,  true);
        refreshNamesInList (outputs, deviceOutputChannelNames, false);
        return;
    }
]=] [=[
    if (initialiseFromCustomBehaviour (device, engine.getEngineBehaviour()))
        return;
]=] changed "${code}")
	if(changed STREQUAL code)
		message(FATAL_ERROR "The Tracktion custom wave layout patch no longer matches")
	endif()
	string(REPLACE [=[
    if (wasInitialisedFromCustomBehaviour)
    {
        refreshNamesInList (inputs,  deviceInputChannelNames,  true);
        refreshNamesInList (outputs, deviceOutputChannelNames, false);
    }
    else
    {
        sanityCheckList();
    }
]=] [=[
    if (wasInitialisedFromCustomBehaviour)
        return false; // Rebuild the host layout when its active channel mask changes.

    sanityCheckList();
]=] code "${changed}")
	if(code STREQUAL changed)
		message(FATAL_ERROR "The Tracktion wave layout rescan patch no longer matches")
	endif()
	file(CONFIGURE OUTPUT "${destination}/${wave_layout}" CONTENT "${code}" @ONLY)
endfunction()
