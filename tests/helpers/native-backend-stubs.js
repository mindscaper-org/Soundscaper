/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Stub backend libraries for the native helper's session suites.
 *
 * No build host has a card that refuses a rate on demand, and a container has
 * no audio server at all, so the device side of these suites is built here: a
 * libasound and a libpipewire exporting exactly the symbols the addon binds,
 * answering exactly what the test tells them to. The addon reaches them through
 * the same `dlopen` it uses in production, so nothing about the code under test
 * is mocked — only the hardware and the graph behind it.
 *
 * Both stubs read their behaviour from the environment, because the process
 * that loads them has to be a child: the dynamic loader reads `LD_LIBRARY_PATH`
 * once, at start.
 */

import { join } from 'node:path';

import { VENDORED_INCLUDES, compileSharedLibrary, temporaryDirectory } from './native-helper-c-harness.js';

export const ALSA_STUB_SOURCE = `
#include <stdlib.h>
#include <string.h>

typedef struct { unsigned int rate; unsigned long period; unsigned int channels; } stub_params;

static unsigned int stub_channels = 2u;

static unsigned long stub_value(const char *name, unsigned long requested)
{
	const char *forced = getenv(name);
	return forced == NULL ? requested : strtoul(forced, NULL, 10);
}

int snd_pcm_open(void **pcm, const char *name, int stream, int mode)
{
	(void)name;
	(void)stream;
	(void)mode;
	int *handle = calloc(1u, sizeof(*handle));
	if (handle == NULL) return -12;
	*pcm = handle;
	return 0;
}

int snd_pcm_close(void *pcm) { free(pcm); return 0; }
int snd_pcm_prepare(void *pcm) { (void)pcm; return 0; }
int snd_pcm_recover(void *pcm, int code, int silent) { (void)pcm; (void)code; (void)silent; return 0; }

long snd_pcm_writei(void *pcm, const void *buffer, unsigned long frames)
{
	(void)pcm;
	(void)buffer;
	return (long)frames;
}

long snd_pcm_readi(void *pcm, void *buffer, unsigned long frames)
{
	(void)pcm;
	memset(buffer, 0, (size_t)frames * stub_channels * sizeof(float));
	return (long)frames;
}

int snd_pcm_hw_params_malloc(void **params)
{
	*params = calloc(1u, sizeof(stub_params));
	return *params == NULL ? -12 : 0;
}

void snd_pcm_hw_params_free(void *params) { free(params); }
int snd_pcm_hw_params_any(void *pcm, void *params) { (void)pcm; (void)params; return 0; }
int snd_pcm_hw_params_set_access(void *pcm, void *params, int access) { (void)pcm; (void)params; (void)access; return 0; }
int snd_pcm_hw_params_set_format(void *pcm, void *params, int format) { (void)pcm; (void)params; (void)format; return 0; }

int snd_pcm_hw_params_set_channels(void *pcm, void *params, unsigned int channels)
{
	(void)pcm;
	((stub_params *)params)->channels = channels;
	stub_channels = channels;
	return 0;
}

int snd_pcm_hw_params_set_rate_near(void *pcm, void *params, unsigned int *rate, int *direction)
{
	(void)pcm;
	*rate = (unsigned int)stub_value("SOUNDSCAPER_STUB_ALSA_RATE", *rate);
	((stub_params *)params)->rate = *rate;
	if (direction != NULL) *direction = 0;
	return 0;
}

int snd_pcm_hw_params_set_period_size_near(void *pcm, void *params, unsigned long *period, int *direction)
{
	(void)pcm;
	*period = stub_value("SOUNDSCAPER_STUB_ALSA_PERIOD", *period);
	((stub_params *)params)->period = *period;
	if (direction != NULL) *direction = 0;
	return 0;
}

int snd_pcm_hw_params(void *pcm, void *params) { (void)pcm; (void)params; return 0; }

int snd_pcm_hw_params_get_rate(const void *params, unsigned int *rate, int *direction)
{
	*rate = ((const stub_params *)params)->rate;
	if (direction != NULL) *direction = 0;
	return 0;
}

int snd_pcm_hw_params_get_period_size(const void *params, unsigned long *period, int *direction)
{
	*period = ((const stub_params *)params)->period;
	if (direction != NULL) *direction = 0;
	return 0;
}

const char *snd_strerror(int code) { (void)code; return "the stub card refused the call"; }
`;

/**
 * `SOUNDSCAPER_STUB_PIPEWIRE` selects what the graph does after the connect
 * request is queued: `silent` never answers, `error` fails the node, and
 * `negotiated` completes with the requested format unless
 * `SOUNDSCAPER_STUB_PIPEWIRE_RATE` or `_CHANNELS` says otherwise.
 * `capture-delayed`, `capture-stalled` and `capture-lost` send half an input
 * packet before delivering the rest, stalling, or disconnecting.
 * A capture-relink substitute source can fill the rest of the packet.
 * `capture-overrun` exceeds a one-frame period's 32-frame ring at startup.
 */
export const PIPEWIRE_STUB_SOURCE = `
#include <pthread.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <pipewire/pipewire.h>
#include <spa/param/audio/format-utils.h>

static const struct pw_stream_events *stub_events;
static void *stub_data;
static uint8_t stub_requested[1024];
static int stub_has_requested;
static enum pw_stream_flags stub_flags;
static int stub_literal_default;
static char stub_loop_object;
static char stub_stream_object;
static char stub_context_object;
static char stub_core_object;
static pthread_t stub_capture_thread;
static int stub_capture_started;
static struct pw_buffer *stub_capture;

static const char *stub_mode(void)
{
	const char *mode = getenv("SOUNDSCAPER_STUB_PIPEWIRE");
	return mode == NULL ? "negotiated" : mode;
}

static unsigned int stub_override(const char *name, unsigned int negotiated)
{
	const char *forced = getenv(name);
	return forced == NULL ? negotiated : (unsigned int)strtoul(forced, NULL, 10);
}

void pw_init(int *argc, char ***argv) { (void)argc; (void)argv; }
void pw_deinit(void) { }

struct pw_thread_loop *pw_thread_loop_new(const char *name, const struct spa_dict *props)
{
	(void)name;
	(void)props;
	return (struct pw_thread_loop *)&stub_loop_object;
}

void pw_thread_loop_destroy(struct pw_thread_loop *loop) { (void)loop; }
void pw_thread_loop_stop(struct pw_thread_loop *loop)
{
	(void)loop;
	if (stub_capture_started) {
		pthread_join(stub_capture_thread, NULL);
		stub_capture_started = 0;
	}
}
void pw_thread_loop_lock(struct pw_thread_loop *loop) { (void)loop; }
void pw_thread_loop_unlock(struct pw_thread_loop *loop) { (void)loop; }

struct pw_loop *pw_thread_loop_get_loop(struct pw_thread_loop *loop)
{
	(void)loop;
	return (struct pw_loop *)&stub_loop_object;
}

struct pw_properties *pw_properties_new(const char *key, ...)
{
	stub_literal_default = 0;
	va_list args;
	va_start(args, key);
	for (; key != NULL; key = va_arg(args, const char *)) {
		const char *value = va_arg(args, const char *);
		if (strcmp(key, PW_KEY_TARGET_OBJECT) == 0 && strcmp(value, "@DEFAULT_SOURCE@") == 0) stub_literal_default = 1;
	}
	va_end(args);
	return (struct pw_properties *)calloc(1u, sizeof(void *));
}

struct pw_stream *pw_stream_new_simple(
	struct pw_loop *loop,
	const char *name,
	struct pw_properties *props,
	const struct pw_stream_events *events,
	void *data)
{
	(void)loop;
	(void)name;
	(void)props;
	stub_events = events;
	stub_data = data;
	return (struct pw_stream *)&stub_stream_object;
}

void pw_stream_destroy(struct pw_stream *stream) { (void)stream; }

int pw_stream_connect(
	struct pw_stream *stream,
	enum pw_direction direction,
	uint32_t target_id,
	enum pw_stream_flags flags,
	const struct spa_pod **params,
	uint32_t n_params)
{
	(void)stream;
	(void)direction;
	(void)target_id;
	stub_flags = flags;
	stub_has_requested = 0;
	if (params != NULL && n_params > 0u && params[0] != NULL) {
		const size_t size = SPA_POD_SIZE(params[0]);
		if (size <= sizeof(stub_requested)) {
			memcpy(stub_requested, params[0], size);
			stub_has_requested = 1;
		}
	}
	/* The real call only queues the request: whatever the graph decides arrives
	 * later, on the loop thread, which is the whole point of this stub. */
	return 0;
}

static void stub_capture_frames(float first, unsigned int frame_count)
{
	float samples[frame_count * 2u];
	for (unsigned int sample = 0; sample < frame_count * 2u; ++sample) {
		samples[sample] = first + 0.25f * (float)sample;
	}
	struct spa_chunk chunk = { .size = sizeof(samples), .stride = 2 * sizeof(float) };
	struct spa_data data = { .maxsize = sizeof(samples), .data = samples, .chunk = &chunk };
	struct spa_buffer buffer = { .n_datas = 1, .datas = &data };
	struct pw_buffer wrapped = { .buffer = &buffer };
	stub_capture = &wrapped;
	stub_events->process(stub_data);
	stub_capture = NULL;
}

static void *stub_finish_capture(void *data)
{
	const char *mode = data;
	const struct timespec delay = { .tv_nsec = 50000000L };
	nanosleep(&delay, NULL);
	if (strcmp(mode, "capture-lost") == 0
		|| (strcmp(mode, "capture-relink") == 0 && (stub_flags & PW_STREAM_FLAG_DONT_RECONNECT))) {
		stub_events->state_changed(stub_data, PW_STREAM_STATE_STREAMING, PW_STREAM_STATE_UNCONNECTED, NULL);
	} else if (strcmp(mode, "capture-overrun") == 0) {
		stub_capture_frames(18.25f, 32u);
	} else {
		stub_capture_frames(1.25f, 2u);
	}
	return NULL;
}

int pw_thread_loop_start(struct pw_thread_loop *loop)
{
	(void)loop;
	const char *mode = stub_mode();
	if (stub_events == NULL || strcmp(mode, "silent") == 0) return 0;
	if (strcmp(mode, "error") == 0
		|| (stub_literal_default && (stub_flags & PW_STREAM_FLAG_DONT_RECONNECT))) {
		if (stub_events->state_changed != NULL) {
			stub_events->state_changed(stub_data, PW_STREAM_STATE_CONNECTING, PW_STREAM_STATE_ERROR,
				"the stub graph refused the node");
		}
		return 0;
	}
	struct spa_audio_info_raw requested;
	memset(&requested, 0, sizeof(requested));
	if (stub_has_requested) {
		spa_format_audio_raw_parse((const struct spa_pod *)stub_requested, &requested);
	}
	uint8_t pod_buffer[1024];
	struct spa_pod_builder builder = SPA_POD_BUILDER_INIT(pod_buffer, sizeof(pod_buffer));
	struct spa_audio_info_raw negotiated;
	memset(&negotiated, 0, sizeof(negotiated));
	negotiated.format = SPA_AUDIO_FORMAT_F32;
	negotiated.rate = stub_override("SOUNDSCAPER_STUB_PIPEWIRE_RATE", requested.rate);
	negotiated.channels = stub_override("SOUNDSCAPER_STUB_PIPEWIRE_CHANNELS", requested.channels);
	const struct spa_pod *format = spa_format_audio_raw_build(&builder, SPA_PARAM_Format, &negotiated);
	/* A listener that registers no callback is not an error here: the stub
	 * answers whatever the addon actually asked to hear. */
	if (stub_events->param_changed != NULL) {
		stub_events->param_changed(stub_data, SPA_PARAM_Format, format);
	}
	if (stub_events->state_changed != NULL) {
		stub_events->state_changed(stub_data, PW_STREAM_STATE_CONNECTING, PW_STREAM_STATE_STREAMING, NULL);
	}
	if (strncmp(mode, "capture-", 8u) == 0) {
		stub_capture_frames(0.25f, strcmp(mode, "capture-overrun") == 0 ? 36u : 2u);
		if (strcmp(mode, "capture-stalled") != 0) {
			if (pthread_create(&stub_capture_thread, NULL, stub_finish_capture, (void *)mode) != 0) return -1;
			stub_capture_started = 1;
		}
	}
	return 0;
}

struct pw_buffer *pw_stream_dequeue_buffer(struct pw_stream *stream) { (void)stream; return stub_capture; }
int pw_stream_queue_buffer(struct pw_stream *stream, struct pw_buffer *buffer) { (void)stream; (void)buffer; return 0; }

struct pw_context *pw_context_new(struct pw_loop *loop, struct pw_properties *props, size_t user_data_size)
{
	(void)loop;
	(void)props;
	(void)user_data_size;
	return (struct pw_context *)&stub_context_object;
}

void pw_context_destroy(struct pw_context *context) { (void)context; }

struct pw_core *pw_context_connect(struct pw_context *context, struct pw_properties *props, size_t user_data_size)
{
	(void)context;
	(void)props;
	(void)user_data_size;
	return (struct pw_core *)&stub_core_object;
}

int pw_core_disconnect(struct pw_core *core) { (void)core; return 0; }
`;

/**
 * Builds the named stubs into one directory, which is what the child's
 * `LD_LIBRARY_PATH` points at. Returns null when there is no compiler here.
 */
export function buildBackendStubs(names) {
	const root = temporaryDirectory('native-backend-stubs');
	for (const name of names) {
		if (name === 'alsa') {
			compileSharedLibrary({ source: ALSA_STUB_SOURCE, outputPath: join(root, 'libasound.so.2') });
		} else {
			compileSharedLibrary({
				source: PIPEWIRE_STUB_SOURCE,
				outputPath: join(root, 'libpipewire-0.3.so.0'),
				includes: VENDORED_INCLUDES,
				flags: ['-pthread'],
			});
		}
	}
	return root;
}
