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
		PATTERN "tracktion_AudioClipBase.cpp" EXCLUDE
		PATTERN "tracktion_AudioFileUtils.cpp" EXCLUDE
		PATTERN "tracktion_AudioFileUtils.h" EXCLUDE
		PATTERN "tracktion_AutomatableEditItem.cpp" EXCLUDE
		PATTERN "tracktion_ClipOwner.cpp" EXCLUDE
		PATTERN "tracktion_ClipOwner.h" EXCLUDE
		PATTERN "tracktion_ClipTrack.cpp" EXCLUDE
		PATTERN "tracktion_TrackUtils.h" EXCLUDE
		PATTERN "tracktion_TransportControl.cpp" EXCLUDE
		PATTERN "tracktion_NodeRenderContext.cpp" EXCLUDE
		PATTERN "tracktion_SourceFileReference.cpp" EXCLUDE
		PATTERN "tracktion_EditFileOperations.cpp" EXCLUDE
		PATTERN "tracktion_EditFileOperations.h" EXCLUDE
		PATTERN "tracktion_InputDevice.h" EXCLUDE
		PATTERN "tracktion_EngineBehaviour.h" EXCLUDE
		PATTERN "tracktion_DeviceManager.cpp" EXCLUDE
		PATTERN "tracktion_WaveAudioClip.cpp" EXCLUDE
		PATTERN "tracktion_WaveDeviceDescription.cpp" EXCLUDE)

	# An ordinary wave already plays from its source. Reserve the proxy timer
	# for derived audio, unresolved media and retiring a previous proxy.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/clips/tracktion_AudioClipBase.cpp"
		"f69e557d299545f93428e7259d1965b742cebf3277b516b295d1655cfb2d3fe0"
		[=[
void AudioClipBase::createNewProxyAsync()
{
    if (canUseProxy() || requiresRenderingSource())
        startTimer (600);
}
]=] [=[
void AudioClipBase::createNewProxyAsync()
{
    const bool renderSource = requiresRenderingSource();
    if (! renderSource && ! canUseProxy())
        return;

    if (! renderSource && state.hasType (IDs::AUDIOCLIP) && ! needsRender() && ! usesTimeStretchedProxy())
    {
        const auto original = getAudioFile();
        if (lastProxy.isNull() || lastProxy == original)
        {
            const auto info = original.getInfo();
            if (info.wasParsedOk && ! info.needsCachedProxy)
                return;
        }
    }

    startTimer (600);
}
]=])

	# The device-less render Edit still needs reversed WAV sources. Its caller
	# prepares them synchronously because queued jobs need the message thread.
	set(wave_clip "modules/tracktion_engine/model/clips/tracktion_WaveAudioClip.cpp")
	soundscaper_read_tracktion_source("${source}" "${wave_clip}"
		"986e047c6dd091186c118bfe3970e26e9f8c10f38324976963dbcfe4275b66ad" code)
	string(REPLACE "    if (! edit.shouldPlay())\n        return false;"
		"    if (! edit.shouldPlay() && (edit.getEditRole() != Edit::forRendering || ! getIsReversed()))\n        return false;"
		code "${code}")
	string(REPLACE "    // do this here so we don't end up creating a multiple copies of a File"
		"    if (edit.getEditRole() == Edit::forRendering && getIsReversed())\n        return {};\n\n    // do this here so we don't end up creating a multiple copies of a File"
		code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${wave_clip}" CONTENT "${code}" @ONLY)

	# Let the same engine routine that drives live reverse jobs also honor
	# cancellation while it prepares a source on the offline message thread.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/audio_files/tracktion_AudioFileUtils.h"
		"83a01152e0888fc3dd23634ecec5e4edb1b8e453bf5ee296fa16beaaaf1462cd"
		"                         bool canCreateWavIntermediate = true);"
		"                         bool canCreateWavIntermediate = true, const std::atomic_bool* cancelled = nullptr);")
	set(audio_file_utils "modules/tracktion_engine/audio_files/tracktion_AudioFileUtils.cpp")
	soundscaper_read_tracktion_source("${source}" "${audio_file_utils}"
		"b51b2e5c3443b89e9e2782644d48cb3ba7d3e4612505e9acb13abf6fa0de60b2" code)
	string(REPLACE "std::atomic<float>& progress, juce::ThreadPoolJob* job, bool canCreateWavIntermediate)"
		"std::atomic<float>& progress, juce::ThreadPoolJob* job, bool canCreateWavIntermediate,\n                              const std::atomic_bool* cancelled)" code "${code}")
	string(REPLACE "return reverse (engine, tempFile.getFile(), destination, progress, job, false);"
		"return reverse (engine, tempFile.getFile(), destination, progress, job, false, cancelled);" code "${code}")
	string(REPLACE "    bool shouldExit = false;\n\n    while (! shouldExit)"
		"    bool shouldExit = false;\n\n    while (! shouldExit && ! (cancelled != nullptr && cancelled->load()))" code "${code}")
	string(REPLACE "        sampleNum -= numThisTime;\n        reader->read (buffers, numChans, sampleNum, numThisTime, true);"
		"        sampleNum -= numThisTime;\n        if (! reader->read (buffers, numChans, sampleNum, numThisTime, true))\n            return false;"
		code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${audio_file_utils}" CONTENT "${code}" @ONLY)

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
	# JUCE notifies each individual child move. The clip projection can follow
	# that move without sorting every clip after every notification.
	string(REPLACE
		[=[    void objectOrderChanged() override          { objectAddedOrRemoved (nullptr); }]=]
		[=[    void objectOrderChanged() override          { objectAddedOrRemoved (nullptr); }

    void valueTreeChildOrderChanged (juce::ValueTree& tree, int oldIndex, int newIndex) override
    {
        if (tree != parent)
            return;

        if (! juce::isPositiveAndBelow (newIndex, tree.getNumChildren()))
        {
            ValueTreeObjectList<Clip>::valueTreeChildOrderChanged (tree, oldIndex, newIndex);
            return;
        }

        {
            const ScopedLockType sl (arrayLock);
            const auto from = indexOf (tree.getChild (newIndex));
            if (from >= 0)
            {
                auto to = from;
                const auto direction = oldIndex < newIndex ? 1 : -1;
                // The crossed siblings keep their relative order in both lists.
                for (auto index = oldIndex; index != newIndex; index += direction)
                {
                    const auto next = to + direction;
                    if (! juce::isPositiveAndBelow (next, objects.size()))
                        break;
                    if (objects.getUnchecked (next)->state == tree.getChild (index))
                        to = next;
                }
                if (from != to)
                    objects.move (from, to);
            }
        }

        objectOrderChanged();
    }]=]
		code "${code}")
	string(REPLACE "const juce::Array<Clip*>& ClipOwner::getClips() const"
		"void ClipOwner::dispatchPendingClipOrdering()\n{\n    if (clipList)\n        clipList->dispatchPendingOrdering();\n}\n\nconst juce::Array<Clip*>& ClipOwner::getClips() const"
		code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${clip_owner}" CONTENT "${code}" @ONLY)

	# The collection listener only updates grouped clips. Skip lookups when a
	# position change has no collection to update or an added clip has no group.
	set(clip_track "modules/tracktion_engine/model/tracks/tracktion_ClipTrack.cpp")
	soundscaper_read_tracktion_source("${source}" "${clip_track}"
		"874eaf51596858248829319955581c096e011cea29894e84e0ddf743557017c2" code)
	string(REPLACE "        else if (id == IDs::start || id == IDs::length)"
		"        else if ((id == IDs::start || id == IDs::length) && ! collectionClips.isEmpty())" code "${code}")
	string(REPLACE
		"    void valueTreeChildAdded (juce::ValueTree&, juce::ValueTree& child) override\n    {\n        if (Clip::isClipState (child))"
		"    void valueTreeChildAdded (juce::ValueTree&, juce::ValueTree& child) override\n    {\n        if (Clip::isClipState (child) && child.hasProperty (IDs::groupID))"
		code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${clip_track}" CONTENT "${code}" @ONLY)

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

	# Check host admission before staging XML, then verify every byte before
	# replacing the Edit. JUCE's buffered XML writer can miss a short write.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/model/edit/tracktion_EditFileOperations.h"
		"80a60b815aa6a02bbfe38c8d1a6507508cb24e86bbdb058551b730968f7c01f9"
		"    bool writeToFile (const juce::File&, bool writeQuickBinaryVersion);"
		"    bool writeToFile (const juce::File&, bool writeQuickBinaryVersion,\n                      const std::function<void (juce::int64)>& checkXmlSize = {});")
	set(edit_file "modules/tracktion_engine/model/edit/tracktion_EditFileOperations.cpp")
	soundscaper_read_tracktion_source("${source}" "${edit_file}"
		"35d860cf315935251fd132ee094d0cdac3bdee26cb5063f872890c85b6778305" code)
	string(REPLACE "bool EditFileOperations::writeToFile (const juce::File& file, bool writeQuickBinaryVersion)"
		"bool EditFileOperations::writeToFile (const juce::File& file, bool writeQuickBinaryVersion,\n                                      const std::function<void (juce::int64)>& checkXmlSize)"
		code "${code}")
	string(REPLACE
		[=[
            if (auto xml = edit.state.createXml())
                ok = xml->writeTo (file);

            jassert (ok);
]=] [=[
            if (auto xml = edit.state.createXml())
            {
                juce::MemoryOutputStream bytes;
                xml->writeTo (bytes, {});
                const auto byteCount = static_cast<juce::int64> (bytes.getDataSize());
                if (checkXmlSize)
                    checkXmlSize (byteCount);
                juce::TemporaryFile staging (file);
                const auto& path = staging.getFile();
                {
                    juce::FileOutputStream out (path, 0);
                    ok = out.openedOk() && out.write (bytes.getData(), bytes.getDataSize());
                    out.flush();
                    ok = ok && out.getStatus().wasOk() && path.getSize() == byteCount;
                }
                ok = ok && staging.overwriteTargetFileWithTemporary();
            }
]=] code "${code}")
	file(CONFIGURE OUTPUT "${destination}/${edit_file}" CONTENT "${code}" @ONLY)

	# Completing the render loop after a failed audio write must report failure.
	soundscaper_patch_tracktion_source("${source}" "${destination}"
		"modules/tracktion_engine/playback/graph/tracktion_NodeRenderContext.cpp"
		"40f8e18c146c05e93dc40a54602a6af674ca81a6253120e4782e9a59ae5af6a2"
		[=[
         && ! writer->appendBuffer (buffer, blockSizeSamples))
        return WriteResult::failed;
]=] [=[
         && ! writer->appendBuffer (buffer, blockSizeSamples))
    {
        owner.errorMessage = TRANS("Couldn't write to target file");
        return WriteResult::failed;
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
