# SPDX-License-Identifier: AGPL-3.0-only

# JUCE 9.0.1 sizes shared callbacks at the endpoint mix rate. Preserve the
# scheduling period in time units and convert it at the opened stream rate.
function(soundscaper_use_juce_wasapi_clock source_module build_module)
	set(backend native/juce_WASAPI_windows.cpp)
	set(source "${source_module}/${backend}")
	file(SHA256 "${source}" digest)
	if(NOT digest STREQUAL "fed232400736ec7a40b63e87c8d6a5be8c2a1df583a2f446ec3632f746414e0b")
		message(FATAL_ERROR "The authenticated JUCE WASAPI backend has changed. Requalify the shared clock patch.")
	endif()
	set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${source}")
	file(READ "${source}" code)
	string(REPLACE "int minBufferSize = 0, defaultBufferSize = 0, latencySamples = 0;"
		"int minBufferSize = 0, defaultBufferSize = 0, latencySamples = 0;\n    REFERENCE_TIME sharedDefaultPeriod = 0;"
		code "${code}")
	string(REPLACE "        minBufferSize = refTimeToSamples (minPeriod, defaultSampleRate);"
		"        sharedDefaultPeriod = defaultPeriod;\n        minBufferSize = refTimeToSamples (minPeriod, defaultSampleRate);"
		code "${code}")
	set(old_period [=[
            if (bufferSizeSamples <= 0)
                return defaultBufferSize;

            if (deviceMode == WASAPIDeviceMode::shared)
            {
                // In shared mode, the wakeup period is decided by the driver, frequently around 10ms
                return defaultBufferSize;
            }
]=])
	set(new_period [=[
            if (deviceMode == WASAPIDeviceMode::shared)
            {
                const auto defaultPeriod = jmax (inputDevice  != nullptr ? inputDevice ->sharedDefaultPeriod : 0,
                                                 outputDevice != nullptr ? outputDevice->sharedDefaultPeriod : 0);
                if (defaultPeriod > 0)
                    return jmax (1, refTimeToSamples (defaultPeriod, currentSampleRate));

                return defaultBufferSize;
            }

            if (bufferSizeSamples <= 0)
                return defaultBufferSize;
]=])
	string(FIND "${code}" "${old_period}" period_position)
	if(period_position LESS 0)
		message(FATAL_ERROR "The authenticated JUCE WASAPI scheduling code does not match the build patch")
	endif()
	string(REPLACE "${old_period}" "${new_period}" code "${code}")
	# A conversion burst can leave another complete capture callback ready.
	# Drain it immediately instead of waiting for a second device wakeup.
	set(old_capture [=[
                if (outputDevice == nullptr)
                {
                    if (WaitForSingleObject (inputDevice->clientEvent, 1000) == WAIT_TIMEOUT)
                        break;

                    inputDevice->handleDeviceBuffer();

                    if (inputDevice->getNumSamplesInReservoir() < bufferSize)
                        continue;
                }
]=])
	set(new_capture [=[
                if (outputDevice == nullptr)
                {
                    if (deviceMode != WASAPIDeviceMode::shared || inputDevice->getNumSamplesInReservoir() < bufferSize)
                    {
                        if (WaitForSingleObject (inputDevice->clientEvent, 1000) == WAIT_TIMEOUT)
                            break;

                        inputDevice->handleDeviceBuffer();

                        if (inputDevice->getNumSamplesInReservoir() < bufferSize)
                            continue;
                    }
                }
]=])
	string(FIND "${code}" "${old_capture}" capture_position)
	if(capture_position LESS 0)
		message(FATAL_ERROR "The authenticated JUCE WASAPI capture loop does not match the build patch")
	endif()
	string(REPLACE "${old_capture}" "${new_capture}" code "${code}")

	set(module juce_audio_devices.cpp)
	get_target_property(sources juce_audio_devices INTERFACE_SOURCES)
	if(NOT "${source_module}/${module}" IN_LIST sources)
		message(FATAL_ERROR "The authenticated JUCE audio device module has an unexpected build source")
	endif()
	configure_file("${source_module}/${module}" "${build_module}/${module}" COPYONLY)
	file(GENERATE OUTPUT "${build_module}/${backend}" CONTENT "${code}")
	list(REMOVE_ITEM sources "${source_module}/${module}")
	list(APPEND sources "${build_module}/${module}")
	set_property(TARGET juce_audio_devices PROPERTY INTERFACE_SOURCES "${sources}")
	target_include_directories(juce_audio_devices INTERFACE "${source_module}")
endfunction()
