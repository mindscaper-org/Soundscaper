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
		PATTERN "tracktion_AutomatableEditItem.cpp" EXCLUDE
		PATTERN "tracktion_ClipOwner.cpp" EXCLUDE
		PATTERN "tracktion_ClipOwner.h" EXCLUDE
		PATTERN "tracktion_TrackUtils.h" EXCLUDE
		PATTERN "tracktion_TransportControl.cpp" EXCLUDE
		PATTERN "tracktion_SourceFileReference.cpp" EXCLUDE
		PATTERN "tracktion_EditFileOperations.cpp" EXCLUDE
		PATTERN "tracktion_InputDevice.h" EXCLUDE
		PATTERN "tracktion_EngineBehaviour.h" EXCLUDE
		PATTERN "tracktion_DeviceManager.cpp" EXCLUDE
		PATTERN "tracktion_WaveDeviceDescription.cpp" EXCLUDE)

	# Serializing explicit parameter values must preserve undo and redo history.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/automation/tracktion_AutomatableEditItem.cpp"
		"3f39f3ac76fe9b43eb65d608035c589a6347d5bea540ee6fcbd2e1899913b161"
		[=[
    auto um = &edit.getUndoManager();

    if (stream.getDataSize() > 0)
        elementState.setProperty (IDs::parameters, stream.getMemoryBlock(), um);
    else
        elementState.removeProperty (IDs::parameters, um);
]=] [=[

    if (stream.getDataSize() > 0)
        elementState.setProperty (IDs::parameters, stream.getMemoryBlock(), nullptr);
    else
        elementState.removeProperty (IDs::parameters, nullptr);
]=])

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

	# An asynchronous track sort uses the Edit's UndoManager. Expose the
	# pending update so the host can finish it in the track edit transaction.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/tracks/tracktion_TrackUtils.h"
		"fcad3688f77edb794f819be0e8a070d249a1396bc32278b979a4095a68a541e3"
		"    static void sortTracksByType (juce::ValueTree& editState, juce::UndoManager*);"
		"    static void sortTracksByType (juce::ValueTree& editState, juce::UndoManager*);\n    void dispatchPendingOrdering() { handleUpdateNowIfNeeded(); }")

	# Use the Edit's directory even before the first save. JUCE would treat the
	# nonexistent Edit file as a directory, putting the wrong path in clip undo.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/edit/tracktion_SourceFileReference.cpp"
		"9d13160775f14680a86b9925f9208c2b286b6a25abc655a7c976e34645b64ad3"
		"return newFile.getRelativePathFrom (editFile);"
		"return newFile.getRelativePathFrom (editFile.getParentDirectory()).replaceCharacter (juce::File::getSeparatorChar(), '/');")

	# JUCE's buffered XML writer can miss a positive short write. Preserve
	# Tracktion's save bookkeeping and verify every byte before replacing the Edit.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/edit/tracktion_EditFileOperations.cpp"
		"35d860cf315935251fd132ee094d0cdac3bdee26cb5063f872890c85b6778305"
		[=[
            if (auto xml = edit.state.createXml())
                ok = xml->writeTo (file);

            jassert (ok);
]=] [=[
            if (auto xml = edit.state.createXml())
            {
                juce::MemoryOutputStream bytes;
                xml->writeTo (bytes, {});
                juce::TemporaryFile staging (file);
                const auto& path = staging.getFile();
                {
                    juce::FileOutputStream out (path, 0);
                    ok = out.openedOk() && out.write (bytes.getData(), bytes.getDataSize());
                    out.flush();
                    ok = ok && out.getStatus().wasOk() && path.getSize() == static_cast<juce::int64> (bytes.getDataSize());
                }
                ok = ok && staging.overwriteTargetFileWithTemporary();
            }
]=])

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

	# Let the host register platform devices through Tracktion's JUCE manager.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/utilities/tracktion_EngineBehaviour.h"
		"fdea5d391c1bd6d5d2deb1b6950bb74bdb1ab9233797d2a2e3520a4110c5b6ee"
		"    /// In plugin builds, you might want to avoid adding the system audio devices"
		"    virtual void addHostAudioIODeviceTypes (juce::OwnedArray<juce::AudioIODeviceType>&) {}

    /// In plugin builds, you might want to avoid adding the system audio devices")
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/playback/tracktion_DeviceManager.cpp"
		"28f900c36a68f768706bad72ef7d65cac7ff2adc313f7aa0c2b047cab398696e"
		"    if (engine.getEngineBehaviour().addSystemAudioIODeviceTypes())"
		"    engine.getEngineBehaviour().addHostAudioIODeviceTypes (types);

    if (engine.getEngineBehaviour().addSystemAudioIODeviceTypes())")
endfunction()
