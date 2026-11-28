# SPDX-License-Identifier: AGPL-3.0-only

function(soundscaper_patch_juce_wave_reader source destination)
	set(codec "modules/juce_audio_formats/codecs/juce_WavAudioFormat.cpp")
	soundscaper_read_tracktion_source("${source}" "${codec}"
		"2e7b424a2c24c670fd996ccd28a3212858480b999c3c16c7957e7f7ef1bac973" original)
	string(REPLACE "uint64 len = 0, end = 0;" "uint64 len = 0, end = 0, rf64DataLength = 0;\n        uint32 rf64RiffLength = 0;"
		code "${original}")
	string(REPLACE "input->skipNextBytes (4); // size is -1 for RF64"
		"rf64RiffLength = (uint32) input->readInt();" code "${code}")
	string(REPLACE [=[
            if (isRF64 && input->readInt() == chunkName ("ds64"))
            {
                auto length = (uint32) input->readInt();

                if (length < 28)
                    return;

                auto chunkEnd = input->getPosition() + length + (length & 1);
                len = (uint64) input->readInt64();
                end = len + (uint64) startOfRIFFChunk;
                dataLength = input->readInt64();
                input->setPosition (chunkEnd);
            }

            while ((uint64) input->getPosition() < end && ! input->isExhausted())
            {
                auto chunkType = input->readInt();
                auto length = (uint32) input->readInt();
                const auto numBytesAvailable = input->getNumBytesRemaining();

                auto chunkEnd = input->getPosition() + length + (length & 1);

                if (numBytesAvailable >= 0)
                {
                    if ((int64) length > numBytesAvailable)
                        return;
]=] [=[
            if (isRF64)
            {
                if (input->readInt() != chunkName ("ds64"))
                    return;

                const auto length = (uint32) input->readInt();
                if (length < 28)
                    return;

                const auto chunkEnd = input->getPosition() + length + (length & 1);
                const auto riff64 = (uint64) input->readInt64();
                rf64DataLength = (uint64) input->readInt64();
                len = rf64RiffLength == 0xffffffffu ? riff64 : rf64RiffLength;
                const auto start = (uint64) startOfRIFFChunk;
                const auto available = input->getTotalLength();
                if (len < (uint64) (chunkEnd - startOfRIFFChunk)
                    || len > (uint64) std::numeric_limits<int64>::max() - start
                    || (available >= 0 && start + len > (uint64) available))
                    return;

                end = start + len;
                if (! input->setPosition (chunkEnd))
                    return;
            }

            while ((uint64) input->getPosition() < end && ! input->isExhausted())
            {
                auto chunkType = input->readInt();
                auto length = (uint32) input->readInt();
                const auto numBytesAvailable = input->getNumBytesRemaining();
                const auto position = (uint64) input->getPosition();
                const auto payloadLength = (isRF64 && chunkType == chunkName ("data") && length == 0xffffffffu)
                    ? rf64DataLength : length;

                if (isRF64 && (position > end || payloadLength > end - position
                               || (numBytesAvailable >= 0 && payloadLength > (uint64) numBytesAvailable)))
                {
                    sampleRate = 0;
                    lengthInSamples = 0;
                    return;
                }

                auto chunkEnd = input->getPosition() + (int64) payloadLength;
                if (! isRF64 || (uint64) chunkEnd < end)
                    chunkEnd += (int64) (payloadLength & 1);

                if (numBytesAvailable >= 0)
                {
                    if (payloadLength > (uint64) numBytesAvailable)
                        return;
]=] changed "${code}")
	if(changed STREQUAL code)
		message(FATAL_ERROR "The RF64 size parsing patch no longer matches")
	endif()
	string(REPLACE [=[
                    if (isRF64)
                    {
                        if (dataLength > 0)
                            chunkEnd = input->getPosition() + dataLength + (dataLength & 1);
                    }
                    else
                    {
                        dataLength = length;
                    }
]=] "                    dataLength = (int64) payloadLength;\n" code "${changed}")
	if(code STREQUAL changed)
		message(FATAL_ERROR "The RF64 data-length patch no longer matches")
	endif()
	file(CONFIGURE OUTPUT "${destination}/${codec}" CONTENT "${code}" @ONLY)
endfunction()

function(soundscaper_use_juce_wave_reader source destination)
	# Keep the other JUCE modules at their authenticated locations. The audio
	# format module's unity files include the patched codec from this copy.
	file(COPY "${source}/modules/juce_audio_formats" DESTINATION "${destination}/modules"
		PATTERN "juce_WavAudioFormat.cpp" EXCLUDE)
	soundscaper_patch_juce_wave_reader("${source}" "${destination}")
	get_target_property(sources juce_audio_formats INTERFACE_SOURCES)
	string(REPLACE "${source}/modules/juce_audio_formats/" "${destination}/modules/juce_audio_formats/"
		patched "${sources}")
	if(patched STREQUAL sources)
		message(FATAL_ERROR "The JUCE audio format target no longer uses its pinned module sources")
	endif()
	set_property(TARGET juce_audio_formats PROPERTY INTERFACE_SOURCES "${patched}")
endfunction()
