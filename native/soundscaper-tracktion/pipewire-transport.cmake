# SPDX-License-Identifier: AGPL-3.0-only

function(soundscaper_add_pipewire target)
	set(origin "${CMAKE_CURRENT_SOURCE_DIR}/../soundscaper-helper-addon/src")
	set(staged "${CMAKE_CURRENT_BINARY_DIR}/pipewire-transport")
	file(MAKE_DIRECTORY "${staged}")

	# The helper's blocking packet API is built into other payloads. Compile this
	# pinned copy with a nonblocking interface for Tracktion's audio device.
	soundscaper_read_tracktion_source("${origin}" "pipewire_session.c"
		"9430902a7867886d5e779834561a1251ff2233d821640af3682917fe0d409eec" code)
	string(REPLACE [=[
	const char *target_key = direction == SOUNDSCAPER_DEVICE_INPUT
		&& strcmp(device_handle, SOUNDSCAPER_PIPEWIRE_DEFAULT_SOURCE) == 0 ? NULL : PW_KEY_TARGET_OBJECT;
]=] [=[
	const char *target_key = strcmp(device_handle, SOUNDSCAPER_PIPEWIRE_DEFAULT_SOURCE) == 0
		|| strcmp(device_handle, "@DEFAULT_SINK@") == 0 ? NULL : PW_KEY_TARGET_OBJECT;
]=] configured "${code}")
	if(configured STREQUAL code)
		message(FATAL_ERROR "Requalify the default PipeWire target")
	endif()
	string(REPLACE "if (direction == SOUNDSCAPER_DEVICE_INPUT) flags |= PW_STREAM_FLAG_DONT_RECONNECT;"
		"flags |= PW_STREAM_FLAG_DONT_RECONNECT;" code "${configured}")
	if(code STREQUAL configured)
		message(FATAL_ERROR "Requalify the Tracktion PipeWire reconnect policy")
	endif()
	string(REPLACE "PW_KEY_NODE_NAME, \"Soundscaper\"," "PW_KEY_NODE_NAME, \"Soundscaper Tracktion\"," code "${code}")
	# Admit whole PipeWire quanta independently of the Tracktion processing block.
	string(REPLACE "atomic_uint_least64_t frames;" "atomic_uint_least64_t frames;
	atomic_uint_least32_t quantum;" code "${code}")
	string(REPLACE "atomic_init(&session->frames, 0u);" "atomic_init(&session->frames, 0u);
	atomic_init(&session->quantum, 0u);" code "${code}")
	string(REPLACE "const uint32_t wanted = frames * session->channel_count;"
		"atomic_store_explicit(&session->quantum, frames, memory_order_relaxed);
		const uint32_t wanted = frames * session->channel_count;" code "${code}")
	string(REPLACE "soundscaper_ring_init(&session->ring, period_frames, channel_count)"
		"soundscaper_ring_init(&session->ring, period_frames < 256u ? 256u : period_frames, channel_count)" code "${code}")

	string(APPEND code [=[

uint32_t soundscaper_pipewire_buffered_frames(const soundscaper_pipewire_session *session)
{
	const uint32_t samples = session->direction == SOUNDSCAPER_DEVICE_OUTPUT
		? session->ring.capacity - soundscaper_ring_space(&session->ring)
		: soundscaper_ring_available(&session->ring);
	return samples / session->channel_count;
}

uint32_t soundscaper_pipewire_capacity_frames(const soundscaper_pipewire_session *session)
{
	return session->ring.capacity / session->channel_count;
}

uint32_t soundscaper_pipewire_quantum(const soundscaper_pipewire_session *session)
{
	return (uint32_t)atomic_load_explicit(&session->quantum, memory_order_relaxed);
}

int soundscaper_pipewire_disconnected(const soundscaper_pipewire_session *session)
{
	return atomic_load_explicit(&session->lost_device, memory_order_acquire);
}

uint32_t soundscaper_pipewire_read_interleaved(soundscaper_pipewire_session *session, float *samples, uint32_t frames)
{
	return soundscaper_ring_pop(&session->ring, samples, frames * session->channel_count) / session->channel_count;
}
]=])
	set(DEFAULT_SOURCE "@DEFAULT_SOURCE@")
	set(DEFAULT_SINK "@DEFAULT_SINK@")
	file(CONFIGURE OUTPUT "${staged}/pipewire_session.c" CONTENT "${code}" @ONLY)

	# A producer must acquire the consumer cursor before reusing published samples.
	soundscaper_patch_tracktion_source("${origin}" "${staged}" "audio_ring.c"
		"39b1382131d9825301d5c393acf40484e3d7b3585340c3eb3b264e781d63ae89"
		"return ring->capacity - soundscaper_ring_available(ring);"
		"const uint32_t read = atomic_load_explicit(&ring->read, memory_order_acquire);\n\tconst uint32_t write = atomic_load_explicit(&ring->write, memory_order_relaxed);\n\treturn ring->capacity - (write - read);")

	add_library(soundscaper_tracktion_pipewire_transport STATIC
		"${staged}/pipewire_session.c" "${staged}/audio_ring.c" pipewire_inventory.c)
	target_compile_features(soundscaper_tracktion_pipewire_transport PRIVATE c_std_11)
	target_include_directories(soundscaper_tracktion_pipewire_transport PRIVATE "${origin}")
	target_include_directories(soundscaper_tracktion_pipewire_transport SYSTEM PRIVATE
		"${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/pipewire-headers/pipewire-0.3"
		"${CMAKE_CURRENT_SOURCE_DIR}/../../vendor/pipewire-headers/spa-0.2")
	target_link_libraries(soundscaper_tracktion_pipewire_transport PRIVATE ${CMAKE_DL_LIBS})
	target_sources(${target} PRIVATE pipewire_device.cpp)
	target_include_directories(${target} PRIVATE "${origin}")
	target_compile_definitions(${target} PRIVATE SOUNDSCAPER_TRACKTION_PIPEWIRE=1)
	target_link_libraries(${target} PRIVATE soundscaper_tracktion_pipewire_transport)
endfunction()
